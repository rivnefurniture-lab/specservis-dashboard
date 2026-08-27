import "server-only";

import { discoverAnalyticsTenders, discoverMonitoringTenders } from "../../scripts/lib/analytics-discovery.mjs";
import {
  markExpandedAnalyticsRequest,
  nextExpandedAnalyticsRequest,
} from "@/lib/analytics-v2-expanded";
import { importProzorroAnalytics } from "@/lib/prozorro-analytics";
import { persistAnalyticsV2 } from "@/lib/analytics-v2-persist";
import { classifyMonitoringDataset } from "@/lib/monitoring-classification";
import { loadActiveMonitoringRuleSet } from "@/lib/monitoring-rule-store";
import { ensureAnalyticsV2Schema } from "@/lib/analytics-v2-migrate";
import { analyticsControlWindow, analyticsDiscoveryWindow, type AnalyticsControlWindow } from "@/lib/analytics-v2-schedule";
import type { ProzorroAnalyticsDataset } from "@/lib/analytics-v2-schema";
import {
  acquireAnalyticsSyncLease,
  analyticsTenderIdsForContracts,
  analyticsTenderIdsForControl,
  analyticsTenderIdsMissingPublication,
  completeAnalyticsQueueItems,
  enqueueAnalyticsTenders,
  ensureMonitoringDiscoveryVersion,
  failAnalyticsQueueItem,
  knownAnalyticsTenderIds,
  nextAnalyticsQueueItems,
  queuedAnalyticsCount,
} from "@/lib/analytics-v2-sync-store";
import { syncTenderWorkspace } from "@/lib/tender-workspace-store";

const API = "https://public-api.prozorro.gov.ua/api/2.5";
const DATASET_ID = "analytics-v2-monitoring";
const SOURCE_NAME = "Official Prozorro API · automatic monitoring sync";
const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

type FeedItem = { id: string; dateModified?: string };
type FeedPage = { data?: FeedItem[]; next_page?: { offset?: string } };
type DiscoveredTender = { id: string; direction: string | null };
type SyncPart = { stream: string; busy: boolean; processed: number; imported: number; cursor: string | null; errors: string[] };
type ImportTarget = {
  datasetId: string;
  scope: "monitoring" | "expanded";
  sourceName: string;
  filters: Record<string, unknown>;
};

const monitoringTarget: ImportTarget = {
  datasetId: DATASET_ID,
  scope: "monitoring",
  sourceName: SOURCE_NAME,
  filters: { source: "monitoring-rules" },
};

function integerEnv(name: string, fallback: number, minimum: number, maximum: number) {
  const raw = process.env[name]?.trim();
  if (!raw || !/^\d+$/.test(raw)) return fallback;
  return Math.min(Math.max(Number(raw), minimum), maximum);
}

async function fetchJson<T>(url: string, attempt = 1): Promise<T> {
  try {
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Prozorro request failed (${response.status})`);
    return await response.json() as T;
  } catch (error) {
    if (attempt >= 4) throw error;
    await wait(300 * attempt ** 2);
    return fetchJson<T>(url, attempt + 1);
  }
}

function mergeDatasets(datasets: ProzorroAnalyticsDataset[], importedAt: string): ProzorroAnalyticsDataset {
  const unique = <T extends { id: string }>(rows: T[]) => [...new Map(rows.map((row) => [row.id, row])).values()];
  return {
    schemaVersion: "analytics-v2",
    importedAt,
    procurements: unique(datasets.flatMap((item) => item.procurements)),
    lots: unique(datasets.flatMap((item) => item.lots)),
    items: unique(datasets.flatMap((item) => item.items)),
    bids: unique(datasets.flatMap((item) => item.bids)),
    awards: unique(datasets.flatMap((item) => item.awards)),
    contracts: unique(datasets.flatMap((item) => item.contracts)),
    changes: unique(datasets.flatMap((item) => item.changes)),
    payments: unique(datasets.flatMap((item) => item.payments)),
    warnings: datasets.flatMap((item) => item.warnings),
  };
}

async function importTenderIds(items: DiscoveredTender[], target: ImportTarget = monitoringTarget) {
  const importedAt = new Date().toISOString();
  const directions: Record<string, string | null> = {};
  const failureDetails: Array<{ id: string; error: string }> = [];
  const successfulIds: string[] = [];
  const datasets: ProzorroAnalyticsDataset[] = [];
  let cursor = 0;
  const concurrency = integerEnv("ANALYTICS_DETAIL_CONCURRENCY", 4, 1, 8);
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) || 1 }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      try {
        const tender = await fetchJson<unknown>(`${API}/tenders/${encodeURIComponent(item.id)}`);
        const raw = tender && typeof tender === "object" && "data" in tender ? (tender as { data?: { contracts?: Array<{ id?: string }> } }).data : null;
        const contractIds = (raw?.contracts ?? []).map((contract) => contract.id).filter((id): id is string => Boolean(id));
        const contracting = await Promise.all(contractIds.map((id) => fetchJson<unknown>(`${API}/contracts/${encodeURIComponent(id)}`)));
        const dataset = importProzorroAnalytics(tender, contracting, { importedAt, tenderFetchedAt: importedAt, contractingFetchedAt: importedAt });
        for (const procurement of dataset.procurements) directions[procurement.id] = item.direction;
        datasets.push(dataset);
        successfulIds.push(item.id);
      } catch (error) {
        failureDetails.push({ id: item.id, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }));
  if (datasets.length) {
    const merged = mergeDatasets(datasets, importedAt);
    const monitoring = target.scope === "monitoring"
      ? classifyMonitoringDataset(merged, await loadActiveMonitoringRuleSet())
      : undefined;
    await persistAnalyticsV2(merged, {
      datasetId: target.datasetId,
      scope: target.scope,
      sourceName: target.sourceName,
      filters: target.filters,
      directions,
      monitoring,
      replaceMembership: false,
    });
  }
  return { imported: datasets.length, successfulIds, failureDetails };
}

async function enqueue(items: DiscoveredTender[], target: ImportTarget, priority = 0) {
  return enqueueAnalyticsTenders(items.map((item) => ({
    datasetId: target.datasetId,
    tenderId: item.id,
    scope: target.scope,
    direction: item.direction,
    sourceName: target.sourceName,
    filters: target.filters,
    priority,
  })));
}

async function processImportQueue(): Promise<SyncPart> {
  const stream = "import-queue";
  const lease = await acquireAnalyticsSyncLease(stream);
  if (!lease) return { stream, busy: true, processed: 0, imported: 0, cursor: null, errors: [] };
  const errors: string[] = [];
  let processed = 0;
  let imported = 0;
  try {
    const started = Date.now();
    const budgetMs = integerEnv("ANALYTICS_QUEUE_BUDGET_MS", 70_000, 20_000, 120_000);
    const maxBatches = integerEnv("ANALYTICS_QUEUE_BATCHES", 8, 1, 20);
    const batchSize = integerEnv("ANALYTICS_IMPORT_BATCH", 100, 1, 150);
    for (let batch = 0; batch < maxBatches && Date.now() - started < budgetMs; batch += 1) {
      const rows = await nextAnalyticsQueueItems(batchSize);
      if (!rows.length) break;
      const importedBeforeBatch = imported;
      const groups = new Map<string, typeof rows>();
      for (const row of rows) groups.set(row.dataset_id, [...(groups.get(row.dataset_id) ?? []), row]);
      for (const group of groups.values()) {
        const first = group[0];
        const target: ImportTarget = {
          datasetId: first.dataset_id,
          scope: first.scope_mode,
          sourceName: first.source_name,
          filters: first.filter_definition,
        };
        try {
          const result = await importTenderIds(group.map((row) => ({ id: row.tender_id, direction: row.direction })), target);
          processed += group.length;
          imported += result.imported;
          await completeAnalyticsQueueItems(result.successfulIds.map((tenderId) => ({ datasetId: target.datasetId, tenderId })));
          for (const failure of result.failureDetails) {
            await failAnalyticsQueueItem(target.datasetId, failure.id, failure.error);
            errors.push(`${failure.id}: ${failure.error}`);
          }
        } catch (error) {
          const errorText = error instanceof Error ? error.message : String(error);
          for (const row of group) await failAnalyticsQueueItem(row.dataset_id, row.tender_id, error);
          errors.push(`${target.datasetId}: ${errorText}`);
        }
      }
      const remaining = await queuedAnalyticsCount();
      await lease.checkpoint(String(remaining), rows.length, imported - importedBeforeBatch, { remaining, batch: batch + 1 });
    }
    const remaining = await queuedAnalyticsCount();
    await lease.succeed(0, 0, { remaining, lastRunErrors: errors.length });
    return { stream, busy: false, processed, imported, cursor: String(remaining), errors };
  } catch (error) {
    await lease.fail(error);
    errors.push(error instanceof Error ? error.message : String(error));
    return { stream, busy: false, processed, imported, cursor: null, errors };
  }
}

function previousDay(day: string) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

async function syncExpandedRequest(): Promise<SyncPart> {
  const request = await nextExpandedAnalyticsRequest();
  if (!request) return { stream: "expanded", busy: false, processed: 0, imported: 0, cursor: null, errors: [] };
  const stream = `expanded:${request.id}`;
  const lease = await acquireAnalyticsSyncLease(stream);
  if (!lease) return { stream, busy: true, processed: 0, imported: 0, cursor: null, errors: [] };
  const raw = request.filter_definition;
  const from = typeof raw.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.from) ? raw.from : utcDay(89);
  const to = typeof raw.to === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.to) ? raw.to : utcDay();
  const cpvPrefixes = Array.isArray(raw.cpvPrefixes) ? raw.cpvPrefixes.filter((item): item is string => typeof item === "string") : [];
  const subjectQuery = typeof raw.subjectQuery === "string" ? raw.subjectQuery.trim() : "";
  const refreshTo = to < utcDay() ? to : utcDay();
  const refreshFrom = previousDay(refreshTo) > from ? previousDay(refreshTo) : from;
  const effectiveFrom = request.status === "ready" ? refreshFrom : from;
  let cursor = request.status === "ready"
    ? refreshTo
    : lease.cursor && /^\d{4}-\d{2}-\d{2}$/.test(lease.cursor) ? lease.cursor : to;
  let processed = 0;
  const imported = 0;
  const errors: string[] = [];
  try {
    await markExpandedAnalyticsRequest(request.id, "syncing");
    const daysPerRun = integerEnv("ANALYTICS_EXPANDED_DAYS_PER_RUN", 1, 1, 3);
    const target: ImportTarget = {
      datasetId: request.dataset_id,
      scope: "expanded",
      sourceName: "Official Prozorro API · expanded automatic search",
      filters: raw,
    };
    for (let index = 0; index < daysPerRun && cursor >= effectiveFrom; index += 1) {
      const found = await discoverAnalyticsTenders({
        day: cursor,
        username: process.env.SMARTTENDER_USERNAME ?? "",
        password: process.env.SMARTTENDER_PASSWORD ?? "",
        pageConcurrency: integerEnv("ANALYTICS_SEARCH_CONCURRENCY", 6, 1, 10),
        detailConcurrency: integerEnv("ANALYTICS_DISCOVERY_DETAIL_CONCURRENCY", 4, 1, 6),
        cpvPrefixes,
        phrases: subjectQuery ? [subjectQuery] : [],
      }) as DiscoveredTender[];
      processed += found.length;
      await enqueue(found, target, 10);
      cursor = previousDay(cursor);
      await lease.checkpoint(cursor, found.length, 0, { nextExpandedDay: cursor });
    }
    const discoveryComplete = cursor < effectiveFrom;
    const complete = discoveryComplete && await queuedAnalyticsCount(request.dataset_id) === 0;
    await markExpandedAnalyticsRequest(request.id, complete ? "ready" : "syncing");
    await lease.succeed(0, 0, { from: effectiveFrom, to: refreshTo, complete, lastRunErrors: errors.length });
    return { stream, busy: false, processed, imported, cursor, errors };
  } catch (error) {
    await markExpandedAnalyticsRequest(request.id, "failed", error);
    await lease.fail(error);
    errors.push(error instanceof Error ? error.message : String(error));
    return { stream, busy: false, processed, imported, cursor, errors };
  }
}

function initialFeedCursor() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - integerEnv("ANALYTICS_CHANGE_LOOKBACK_DAYS", 7, 1, 31));
  return date.toISOString();
}

async function syncFeed(kind: "tenders" | "contracts"): Promise<SyncPart> {
  const stream = `prozorro-${kind}`;
  const lease = await acquireAnalyticsSyncLease(stream);
  if (!lease) return { stream, busy: true, processed: 0, imported: 0, cursor: null, errors: [] };
  let processed = 0;
  const imported = 0;
  let cursor = lease.cursor ?? initialFeedCursor();
  const errors: string[] = [];
  try {
    const pageLimit = integerEnv("ANALYTICS_FEED_PAGES", 3, 1, 10);
    for (let page = 0; page < pageLimit; page += 1) {
      const feed = await fetchJson<FeedPage>(`${API}/${kind}?limit=100&offset=${encodeURIComponent(cursor)}`);
      const rows = (feed.data ?? []).filter((row) => row.id);
      if (!rows.length || !feed.next_page?.offset) break;
      processed += rows.length;
      let tenderItems: DiscoveredTender[] = [];
      if (kind === "tenders") {
        const known = await knownAnalyticsTenderIds(rows.map((row) => row.id), DATASET_ID);
        tenderItems = rows.filter((row) => known.has(row.id)).map((row) => ({ id: row.id, direction: null }));
      } else {
        const links = await analyticsTenderIdsForContracts(rows.map((row) => row.id));
        tenderItems = [...new Set(links.values())].map((id) => ({ id, direction: null }));
      }
      await enqueue(tenderItems, monitoringTarget, 20);
      cursor = feed.next_page.offset;
      await lease.checkpoint(cursor, rows.length, 0, { lastPageAt: new Date().toISOString() });
    }
    await lease.succeed(0, 0, { lastRunErrors: errors.length });
    return { stream, busy: false, processed, imported, cursor, errors };
  } catch (error) {
    await lease.fail(error);
    errors.push(error instanceof Error ? error.message : String(error));
    return { stream, busy: false, processed, imported, cursor, errors };
  }
}

function utcDay(daysAgo = 0) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

async function syncDiscovery(): Promise<SyncPart> {
  const stream = "monitoring-discovery";
  const lease = await acquireAnalyticsSyncLease(stream);
  if (!lease) return { stream, busy: true, processed: 0, imported: 0, cursor: null, errors: [] };
  const errors: string[] = [];
  let processed = 0;
  const imported = 0;
  let cursor = lease.cursor;
  try {
    const historyDays = integerEnv("ANALYTICS_HISTORY_DAYS", 3_650, 31, 5_000);
    const oldest = utcDay(historyDays - 1);
    const historicalDay = cursor === "complete"
      ? null
      : cursor && /^\d{4}-\d{2}-\d{2}$/.test(cursor) && cursor >= oldest ? cursor : utcDay(2);
    // One SmartTender day per invocation keeps a large search below the Vercel
    // Function limit. Four ten-minute slots advance history; two refresh today
    // and yesterday. Once backfill is complete, historical slots refresh today.
    const window = analyticsDiscoveryWindow(new Date());
    const day = window === "today"
      ? utcDay(0)
      : window === "yesterday" ? utcDay(1) : historicalDay ?? utcDay(0);
    const days = [day];
    for (const day of days) {
      const monitoringRuleSet = await loadActiveMonitoringRuleSet();
      const found = await discoverMonitoringTenders({
        day,
        username: process.env.SMARTTENDER_USERNAME ?? "",
        password: process.env.SMARTTENDER_PASSWORD ?? "",
        pageConcurrency: integerEnv("ANALYTICS_SEARCH_CONCURRENCY", 6, 1, 10),
        detailConcurrency: integerEnv("ANALYTICS_DISCOVERY_DETAIL_CONCURRENCY", 4, 1, 6),
        monitoringRuleSet,
      }) as DiscoveredTender[];
      processed += found.length;
      const known = await knownAnalyticsTenderIds(found.map((item) => item.id), DATASET_ID);
      const newlyDiscovered = found.filter((item) => !known.has(item.id));
      await enqueue(newlyDiscovered, monitoringTarget, day >= utcDay(1) ? 15 : 5);
      if (historicalDay && day === historicalDay) {
        const previous = new Date(`${historicalDay}T00:00:00Z`);
        previous.setUTCDate(previous.getUTCDate() - 1);
        cursor = previous.toISOString().slice(0, 10);
        if (cursor < oldest) cursor = "complete";
      }
      await lease.checkpoint(cursor ?? historicalDay ?? "complete", found.length, 0, { lastDiscoveryDay: day });
    }
    await lease.succeed(0, 0, { historyDays, lastRunErrors: errors.length });
    return { stream, busy: false, processed, imported, cursor, errors };
  } catch (error) {
    await lease.fail(error);
    errors.push(error instanceof Error ? error.message : String(error));
    return { stream, busy: false, processed, imported, cursor, errors };
  }
}

function controlStreamKey(mode: AnalyticsControlWindow, date: Date) {
  const day = date.toISOString().slice(0, 10);
  return mode === "full-history" ? `monitoring-control:${mode}:${day.slice(0, 7)}` : `monitoring-control:${mode}:${day}`;
}

async function syncControlPass(mode: AnalyticsControlWindow, date: Date): Promise<SyncPart> {
  const stream = controlStreamKey(mode, date);
  const lease = await acquireAnalyticsSyncLease(stream);
  if (!lease) return { stream, busy: true, processed: 0, imported: 0, cursor: null, errors: [] };
  if (lease.cursor === "complete") {
    await lease.succeed(0, 0, { mode, complete: true });
    return { stream, busy: false, processed: 0, imported: 0, cursor: "complete", errors: [] };
  }
  const errors: string[] = [];
  try {
    const batchSize = integerEnv("ANALYTICS_CONTROL_BATCH", 100, 10, 250);
    const ids = await analyticsTenderIdsForControl(DATASET_ID, mode, lease.cursor, batchSize);
    const nextCursor = ids.length < batchSize ? "complete" : ids.at(-1) ?? "complete";
    await enqueue(ids.map((id) => ({ id, direction: null })), monitoringTarget, mode === "recent-30-days" ? 24 : 12);
    await lease.checkpoint(nextCursor, ids.length, 0, { mode, complete: nextCursor === "complete" });
    await lease.succeed(0, 0, { mode, complete: nextCursor === "complete" });
    return { stream, busy: false, processed: ids.length, imported: 0, cursor: nextCursor, errors };
  } catch (error) {
    await lease.fail(error);
    errors.push(error instanceof Error ? error.message : String(error));
    return { stream, busy: false, processed: 0, imported: 0, cursor: lease.cursor, errors };
  }
}

export type AnalyticsSyncMode = "discovery" | "import";
const running = new Map<AnalyticsSyncMode, Promise<Awaited<ReturnType<typeof runAnalyticsSync>>>>();

async function runAnalyticsSync(mode: AnalyticsSyncMode) {
  const startedAt = new Date();
  await ensureAnalyticsV2Schema();
  if (mode === "import") {
    const queue = await processImportQueue();
    return {
      ok: queue.errors.length === 0,
      mode,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      processed: queue.processed,
      imported: queue.imported,
      busy: queue.busy ? [queue.stream] : [],
      parts: [queue],
      workspace: null,
      errors: queue.errors.slice(0, 50),
    };
  }
  const activeRules = await loadActiveMonitoringRuleSet();
  await ensureMonitoringDiscoveryVersion(`monitoring-classification:v3:${activeRules.version}`);
  const [discovery, tenders, contracts, expanded, control, workspace] = await Promise.all([
    syncDiscovery(), syncFeed("tenders"), syncFeed("contracts"), syncExpandedRequest(),
    syncControlPass(analyticsControlWindow(startedAt), startedAt),
    syncTenderWorkspace(),
  ]);
  const missingPublication = await analyticsTenderIdsMissingPublication(DATASET_ID);
  await enqueue(missingPublication.map((id) => ({ id, direction: null })), monitoringTarget, 30);
  const parts = [discovery, tenders, contracts, expanded, control];
  const errors = parts.flatMap((part) => part.errors);
  return {
    ok: errors.length === 0,
    mode,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    processed: parts.reduce((sum, part) => sum + part.processed, 0),
    imported: parts.reduce((sum, part) => sum + part.imported, 0),
    busy: parts.filter((part) => part.busy).map((part) => part.stream),
    parts,
    workspace,
    errors: errors.slice(0, 50),
  };
}

export function syncAnalyticsV2(mode: AnalyticsSyncMode = "discovery") {
  const active = running.get(mode);
  if (active) return active;
  const task = runAnalyticsSync(mode).finally(() => { running.delete(mode); });
  running.set(mode, task);
  return task;
}
