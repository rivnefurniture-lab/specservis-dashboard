import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { sessionAccount, sessionCookie } from "@/lib/auth";
import { buildAnalyticsV2, type AnalyticsDateLens, type AnalyticsV2Filters } from "@/lib/analytics-v2-engine";
import { ensureExpandedAnalyticsRequest, isExpandedDiscovery } from "@/lib/analytics-v2-expanded";
import { legacyAnalyticsMeta, legacyCompetitorAnalyticsInput } from "@/lib/analytics-v2-legacy";
import { loadAnalyticsV2Input } from "@/lib/analytics-v2-store";
import { monitoringAnalyticsSyncSummary } from "@/lib/analytics-v2-sync-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const dateLenses = new Set<AnalyticsDateLens>(["publication", "award", "contract"]);
const directions = new Set(["Капбудівництво", "Сервіс", "Кондиціонування"]);

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
  const cookieStore = await cookies();
  const account = sessionAccount(cookieStore.get(sessionCookie.name)?.value);
  if (!account) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (account.role === "employee") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const params = new URL(request.url).searchParams;
  const requestedLens = params.get("dateLens") as AnalyticsDateLens | null;
  const requestedDirections = values(params, "direction", 3, 40).filter((item) => directions.has(item));
  const permittedDirections = account.role === "owner"
    ? requestedDirections
    : account.direction
      ? [account.direction]
      : [];
  const from = isoDate(params.get("from"));
  const to = isoDate(params.get("to"));
  if (from && to && from > to) return NextResponse.json({ error: "Invalid period" }, { status: 400 });

  const defaults = defaultPeriod();
  const requestedScope = params.get("scope");
  const filters: AnalyticsV2Filters = {
    from: from ?? defaults.from,
    to: to ?? defaults.to,
    scope: requestedScope === "expanded" ? "expanded" : "monitoring",
    dateLens: requestedLens && dateLenses.has(requestedLens) ? requestedLens : "publication",
    directions: permittedDirections.length ? permittedDirections : undefined,
    cpvPrefixes: values(params, "cpv", 30, 12).map((value) => value.replace(/[^0-9-]/g, "")).filter(Boolean),
    buyerIds: values(params, "buyer", 30, 120),
    supplierIds: values(params, "supplier", 30, 120),
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
    lowestRejected: triState(params.get("lowestRejection")),
    winnerSupplierIds: values(params, "winner", 30, 120),
    contractPresence: triState(params.get("contract")),
    paidPresence: triState(params.get("paid")),
    changesPresence: triState(params.get("changes")),
    ourStatuses: values(params, "ourStatus", 20, 120),
  };
  if (filters.expectedAmountMin != null && filters.expectedAmountMax != null
    && filters.expectedAmountMin > filters.expectedAmountMax) {
    return NextResponse.json({ error: "Invalid value range" }, { status: 400 });
  }
  if (filters.minParticipants != null && filters.maxParticipants != null
    && filters.minParticipants > filters.maxParticipants) {
    return NextResponse.json({ error: "Invalid participant range" }, { status: 400 });
  }

  const expandedRequest = isExpandedDiscovery(filters)
    ? await ensureExpandedAnalyticsRequest(account.id, filters)
    : null;
  if (expandedRequest) filters.datasetId = expandedRequest.dataset_id;
  const stored = filters.scope === "expanded" && !expandedRequest ? null : await loadAnalyticsV2Input(filters);
  const monitoringSync = filters.scope === "monitoring" && stored ? await monitoringAnalyticsSyncSummary() : null;
  const input = stored?.input ?? (filters.scope === "monitoring" ? legacyCompetitorAnalyticsInput() : {
    tenders: [], lots: [], bids: [], awards: [], contracts: [],
  });
  const result = buildAnalyticsV2(input, filters);
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
  return NextResponse.json({
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
      directions: account.role === "owner" ? [...directions] : permittedDirections,
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
      suppliers: result.suppliers.slice(0, supplierLimit),
      buyers: result.buyers.slice(0, 500),
      matrix: result.matrix.slice(0, matrixLimit),
      drilldown: result.drilldown.slice(0, drilldownLimit),
    },
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
  }, { headers: { "Cache-Control": "private, no-store" } });
}
