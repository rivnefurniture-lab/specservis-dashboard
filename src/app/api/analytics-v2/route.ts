import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getCache, waitUntil } from "@vercel/functions";
import { sessionAccount, sessionCookie } from "@/lib/auth";
import { buildAnalyticsV2, type AnalyticsDateLens, type AnalyticsV2Filters } from "@/lib/analytics-v2-engine";
import { ensureExpandedAnalyticsRequest, isExpandedDiscovery } from "@/lib/analytics-v2-expanded";
import { legacyAnalyticsMeta, legacyCompetitorAnalyticsInput } from "@/lib/analytics-v2-legacy";
import { loadAnalyticsV2Input } from "@/lib/analytics-v2-store";
import { monitoringAnalyticsSyncSummary } from "@/lib/analytics-v2-sync-store";
import { analyticsWorkbook } from "@/lib/tender-excel";
import { directionsForAccount, expandDirectionGroups, TENDER_DIRECTION_GROUPS } from "@/lib/tender-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const dateLenses = new Set<AnalyticsDateLens>(["publication", "award", "contract"]);
const ownSupplierSelectors = ["30518990"];
const RESPONSE_CACHE_TTL_SECONDS = 60;
const RESPONSE_CACHE_PENDING_TTL_SECONDS = 300;
const responseCache = getCache({ namespace: "analytics-v2-responses" });

async function readResponseCache(key: string) {
  try {
    return await responseCache.get(key);
  } catch (error) {
    console.warn("[analytics-v2] cache read failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function writeResponseCache(key: string, payload: unknown, ttl: number) {
  try {
    await responseCache.set(key, payload, {
      ttl,
      tags: ["analytics-v2"],
      name: "Analytics response",
    });
  } catch (error) {
    console.warn("[analytics-v2] cache write failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function isoDate(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) return null;
  return value;
}

function values(params: URLSearchParams, key: string, maxItems = 30, maxLength = 120) {
  return params.getAll(key)
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, maxItems)
    .map((value) => value.slice(0, maxLength));
}

function boundedInteger(value: string | null, fallback: number, minimum: number, maximum: number) {
  if (!value || !/^\d+$/.test(value)) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? Math.min(Math.max(parsed, minimum), maximum) : fallback;
}

function optionalNumber(value: string | null, minimum = 0, maximum = 1_000_000_000_000_000) {
  if (value == null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

function triState(value: string | null) {
  return value === "yes" ? true : value === "no" ? false : null;
}

function defaultPeriod() {
  const to = new Date();
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - 89);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

export async function GET(request: Request) {
  const startedAt = performance.now();
  const cookieStore = await cookies();
  const account = sessionAccount(cookieStore.get(sessionCookie.name)?.value);
  if (!account) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (account.role === "employee") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const params = new URL(request.url).searchParams;
  const exportRequested = params.get("format") === "xlsx";
  const requestedLens = params.get("dateLens") as AnalyticsDateLens | null;
  const requestedDirections = expandDirectionGroups(values(params, "direction", 10, 60));
  const permittedDirections = account.role === "owner"
    ? requestedDirections.length ? requestedDirections : TENDER_DIRECTION_GROUPS.flatMap((group) => group.directions)
    : account.direction
      ? directionsForAccount(account.direction)
      : [];
  const from = isoDate(params.get("from"));
  const to = isoDate(params.get("to"));
  if (from && to && from > to) return NextResponse.json({ error: "Invalid period" }, { status: 400 });

  const defaults = defaultPeriod();
  const requestedScope = params.get("scope");
  const audience = params.get("audience");
  const selectedSuppliers = values(params, "supplier", 30, 120);
  const filters: AnalyticsV2Filters = {
    from: from ?? defaults.from,
    to: to ?? defaults.to,
    scope: requestedScope === "expanded" ? "expanded" : "monitoring",
    dateLens: requestedLens && dateLenses.has(requestedLens) ? requestedLens : "publication",
    directions: permittedDirections.length ? permittedDirections : undefined,
    cpvPrefixes: values(params, "cpv", 30, 12).map((value) => value.replace(/[^0-9-]/g, "")).filter(Boolean),
    buyerIds: values(params, "buyer", 30, 120),
    supplierIds: audience === "ours" ? ownSupplierSelectors : selectedSuppliers,
    excludedSupplierIds: audience === "competitors" ? ownSupplierSelectors : undefined,
    procedureTypes: values(params, "procedure", 30, 120),
    currencies: values(params, "currency", 10, 12).map((value) => value.toUpperCase()),
    subjectQuery: params.get("subject")?.slice(0, 200).trim() || null,
    categories: values(params, "category", 3, 30),
    statuses: values(params, "status", 30, 80),
    regions: values(params, "region", 30, 120),
    addressQuery: params.get("address")?.slice(0, 200).trim() || null,
    expectedAmountMin: optionalNumber(params.get("minValue")),
    expectedAmountMax: optionalNumber(params.get("maxValue")),
    minParticipants: optionalNumber(params.get("minParticipants"), 0, 10_000),
    maxParticipants: optionalNumber(params.get("maxParticipants"), 0, 10_000),
    lowestBidSupplierIds: values(params, "lowestSupplier", 30, 120),
    lowestBidAmountMin: optionalNumber(params.get("minLowestBid")),
    lowestBidAmountMax: optionalNumber(params.get("maxLowestBid")),
    lowestRejected: triState(params.get("lowestRejection")),
    rejectionReasonQuery: params.get("rejectionReason")?.slice(0, 300).trim() || null,
    winnerSupplierIds: values(params, "winner", 30, 120),
    awardAmountMin: optionalNumber(params.get("minAward")),
    awardAmountMax: optionalNumber(params.get("maxAward")),
    contractPresence: triState(params.get("contract")),
    originalContractAmountMin: optionalNumber(params.get("minOriginalContract")),
    originalContractAmountMax: optionalNumber(params.get("maxOriginalContract")),
    currentContractAmountMin: optionalNumber(params.get("minCurrentContract")),
    currentContractAmountMax: optionalNumber(params.get("maxCurrentContract")),
    completedContractAmountMin: optionalNumber(params.get("minCompletedAmount")),
    completedContractAmountMax: optionalNumber(params.get("maxCompletedAmount")),
    paidPresence: triState(params.get("paid")),
    changesPresence: triState(params.get("changes")),
    ourStatuses: values(params, "ourStatus", 20, 120),
  };
  const ranges: Array<[number | null | undefined, number | null | undefined, string]> = [
    [filters.expectedAmountMin, filters.expectedAmountMax, "expected value"],
    [filters.minParticipants, filters.maxParticipants, "participant count"],
    [filters.lowestBidAmountMin, filters.lowestBidAmountMax, "lowest bid"],
    [filters.awardAmountMin, filters.awardAmountMax, "award amount"],
    [filters.originalContractAmountMin, filters.originalContractAmountMax, "original contract amount"],
    [filters.currentContractAmountMin, filters.currentContractAmountMax, "current contract amount"],
    [filters.completedContractAmountMin, filters.completedContractAmountMax, "completed contract amount"],
  ];
  const invalidRange = ranges.find(([minimum, maximum]) => minimum != null && maximum != null && minimum > maximum);
  if (invalidRange) {
    return NextResponse.json({ error: `Invalid ${invalidRange[2]} range` }, { status: 400 });
  }
  const canonicalParams = new URLSearchParams(params);
  canonicalParams.sort();
  const responseCacheKey = `${account.role}:${account.direction ?? "all"}:${canonicalParams.toString()}`;
  const cachedPayload = exportRequested ? null : await readResponseCache(responseCacheKey);
  if (cachedPayload) {
    const response = NextResponse.json(cachedPayload, { headers: { "Cache-Control": "private, no-store" } });
    response.headers.set("Server-Timing", "cache;desc=hit;dur=0");
    return response;
  }

  const expansionStartedAt = performance.now();
  const expandedRequest = isExpandedDiscovery(filters)
    ? await ensureExpandedAnalyticsRequest(account.id, filters)
    : null;
  const expansionMs = performance.now() - expansionStartedAt;
  if (expandedRequest) filters.datasetId = expandedRequest.dataset_id;
  const storageStartedAt = performance.now();
  const stored = filters.scope === "expanded" && !expandedRequest ? null : await loadAnalyticsV2Input(filters);
  const storageMs = performance.now() - storageStartedAt;
  const syncStartedAt = performance.now();
  const monitoringSync = filters.scope === "monitoring" && stored ? await monitoringAnalyticsSyncSummary() : null;
  const syncMs = performance.now() - syncStartedAt;
  const input = stored?.input ?? (filters.scope === "monitoring" ? legacyCompetitorAnalyticsInput() : {
    tenders: [], lots: [], bids: [], awards: [], contracts: [],
  });
  const engineStartedAt = performance.now();
  const result = buildAnalyticsV2(input, filters);
  const yearly = [...new Set(result.drilldown.map((row) => {
    const value = filters.dateLens === "award" ? row.awardDate : filters.dateLens === "contract" ? row.contractDate : row.publishedAt;
    return value?.slice(0, 4) ?? null;
  }).filter((value): value is string => Boolean(value)))].sort().map((year) => {
    const rows = result.drilldown.filter((row) => {
      const value = filters.dateLens === "award" ? row.awardDate : filters.dateLens === "contract" ? row.contractDate : row.publishedAt;
      return value?.startsWith(year);
    });
    const tenderIds = new Set(rows.map((row) => row.tenderId));
    const lotIds = new Set(rows.flatMap((row) => row.lotId ? [row.lotId] : []));
    const participations = rows.filter((row) => row.participation).length;
    const wins = rows.filter((row) => row.won).length;
    const contractIds = new Set(rows.flatMap((row) => row.contractIds));
    const contractValueUah = rows.reduce((total, row) => total + row.currentAmount
      .filter((amount) => amount.currency === "UAH")
      .reduce((sum, amount) => sum + (amount.value ?? 0), 0), 0);
    return {
      year,
      tenders: tenderIds.size,
      lots: lotIds.size,
      participations,
      wins,
      contracts: contractIds.size,
      winRate: participations ? wins / participations : null,
      contractValueUah,
    };
  });
  const engineMs = performance.now() - engineStartedAt;
  const supplierLimit = boundedInteger(params.get("supplierLimit"), 100, 1, 500);
  const matrixLimit = boundedInteger(params.get("matrixLimit"), 200, 1, 1_000);
  const drilldownLimit = boundedInteger(params.get("drilldownLimit"), 300, 1, 1_000);
  const procedures = [...new Set(input.tenders.map((item) => item.procedureType).filter(Boolean))].sort((left, right) => left.localeCompare(right, "uk"));
  const buyers = [...new Map(input.tenders.map((item) => [item.buyerId, { id: item.buyerId, name: item.buyerName }])).values()]
    .sort((left, right) => left.name.localeCompare(right.name, "uk"));
  const facetValues = (items: Array<string | null | undefined>) => [...new Set(items.filter((item): item is string => Boolean(item)))].sort((left, right) => left.localeCompare(right, "uk"));

  const publicFilters = { ...filters };
  delete publicFilters.datasetId;
  const expandedPending = Boolean(expandedRequest && expandedRequest.status !== "ready");
  const monitoringPending = Boolean(monitoringSync && (!monitoringSync.backfillComplete || monitoringSync.queued > 0));
  const complete = Boolean(stored) && !expandedPending && !monitoringPending;
  const limitations = expandedPending
    ? ["Розширений набір синхронізується у фоні. Уже завантажені дні доступні; повнота буде підтверджена після завершення backfill."]
    : filters.scope === "expanded" && !expandedRequest
      ? ["Для розширеного пошуку вкажіть ДК-код або предметний термін."]
      : monitoringPending
        ? [`Історичний backfill триває; у durable queue зараз ${monitoringSync?.queued ?? 0} закупівель. Уже завантажені факти доступні, але набір ще не позначено повним.`]
        : undefined;
  const payload = {
    meta: {
      ...(stored
        ? { schemaVersion: "analytics-v2", generatedAt: stored.generatedAt, source: stored.sourceName }
        : filters.scope === "monitoring"
          ? legacyAnalyticsMeta
          : { schemaVersion: "analytics-v2", generatedAt: null, source: "Official Prozorro API · expanded search" }),
      storage: stored ? "database" : filters.scope === "monitoring" ? "bundled-fallback" : "database-building",
      complete,
      syncStatus: expandedRequest?.status
        ?? (monitoringSync?.degraded ? "degraded" : monitoringPending ? "backfilling" : stored ? "ready" : "fallback"),
      sync: monitoringSync ?? undefined,
      limitations,
      sourceStates: {
        exact: "Значення безпосередньо оприлюднене джерелом",
        calculated: "Детерміновано розраховано з первинних записів",
        unavailable: "Поле відсутнє у поточному джерелі",
      },
    },
    filters: publicFilters,
    facets: {
      directions: TENDER_DIRECTION_GROUPS.map((group) => group.id),
      procedures,
      buyers: buyers.slice(0, 500),
      categories: ["goods", "services", "works"],
      statuses: facetValues(input.tenders.map((item) => item.status)),
      regions: facetValues(input.tenders.map((item) => item.region)),
      ourStatuses: facetValues(input.tenders.map((item) => item.ourStatus)),
      suppliers: result.suppliers.slice(0, 500).map((item) => ({ id: item.id, name: item.name })),
      currencies: facetValues([
        ...input.bids.map((item) => item.currency),
        ...input.awards.map((item) => item.currency),
        ...input.contracts.map((item) => item.currency),
      ]),
    },
    result: {
      ...result,
      // The UI receives lightweight selector facets separately. Full party
      // metrics are recalculated when a supplier or buyer is selected.
      suppliers: [],
      buyers: [],
      mainBuyersByCount: result.mainBuyersByCount.slice(0, 1),
      mainBuyersBySum: result.mainBuyersBySum.map((group) => ({
        ...group,
        buyers: group.buyers.slice(0, 1),
      })),
      matrix: result.matrix.slice(0, matrixLimit),
      drilldown: result.drilldown.slice(0, drilldownLimit),
    },
    yearly,
    truncated: {
      suppliers: result.suppliers.length > supplierLimit,
      matrix: result.matrix.length > matrixLimit,
      drilldown: result.drilldown.length > drilldownLimit,
      totals: {
        suppliers: result.suppliers.length,
        matrix: result.matrix.length,
        drilldown: result.drilldown.length,
      },
    },
  };
  if (exportRequested) {
    const body = await analyticsWorkbook(result);
    return new NextResponse(body, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="analytics-${new Date().toISOString().slice(0, 10)}.xlsx"`,
        "Cache-Control": "private, no-store",
      },
    });
  }
  waitUntil(writeResponseCache(
    responseCacheKey,
    payload,
    complete ? RESPONSE_CACHE_TTL_SECONDS : RESPONSE_CACHE_PENDING_TTL_SECONDS,
  ));
  const serializationStartedAt = performance.now();
  const response = NextResponse.json(payload, { headers: { "Cache-Control": "private, no-store" } });
  const serializationMs = performance.now() - serializationStartedAt;
  response.headers.set("Server-Timing", [
    `expansion;dur=${expansionMs.toFixed(1)}`,
    `storage;dur=${storageMs.toFixed(1)}`,
    ...(stored ? [
      `dataset;dur=${stored.timings.datasetMs.toFixed(1)}`,
      `procurements;dur=${stored.timings.procurementsMs.toFixed(1)}`,
      `details;dur=${stored.timings.detailsMs.toFixed(1)}`,
      `lots;dur=${stored.timings.lotsMs.toFixed(1)}`,
      `bids;dur=${stored.timings.bidsMs.toFixed(1)}`,
      `awards;dur=${stored.timings.awardsMs.toFixed(1)}`,
      `contracts;dur=${stored.timings.contractsMs.toFixed(1)}`,
      `mapping;dur=${stored.timings.mappingMs.toFixed(1)}`,
    ] : []),
    `sync;dur=${syncMs.toFixed(1)}`,
    `engine;dur=${engineMs.toFixed(1)}`,
    `serialization;dur=${serializationMs.toFixed(1)}`,
  ].join(", "));
  console.info("[analytics-v2] request completed", {
    durationMs: Math.round(performance.now() - startedAt),
    storageMs: Math.round(storageMs),
    engineMs: Math.round(engineMs),
    serializationMs: Math.round(serializationMs),
    tenders: input.tenders.length,
    lots: input.lots.length,
    suppliers: result.suppliers.length,
    drilldown: result.drilldown.length,
  });
  return response;
}
