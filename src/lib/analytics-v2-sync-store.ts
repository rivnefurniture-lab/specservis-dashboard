import "server-only";

import { randomUUID } from "node:crypto";
import { getAnalyticsSql } from "@/lib/analytics-v2-db";

export type AnalyticsSyncLease = {
  streamKey: string;
  token: string;
  cursor: string | null;
  checkpoint: (cursor: string, processed: number, imported: number, metadata?: Record<string, unknown>) => Promise<void>;
  succeed: (processed: number, imported: number, metadata?: Record<string, unknown>) => Promise<void>;
  fail: (error: unknown) => Promise<void>;
};

type LeaseRow = { cursor_value: string | null };

export type AnalyticsQueueItem = {
  dataset_id: string;
  tender_id: string;
  scope_mode: "monitoring" | "expanded";
  direction: string | null;
  source_name: string;
  filter_definition: Record<string, unknown>;
  attempts: number;
};

export type EnqueueAnalyticsItem = {
  datasetId: string;
  tenderId: string;
  scope: "monitoring" | "expanded";
  direction: string | null;
  sourceName: string;
  filters: Record<string, unknown>;
  priority?: number;
};

function message(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2_000);
}

export async function acquireAnalyticsSyncLease(streamKey: string, leaseSeconds = 330): Promise<AnalyticsSyncLease | null> {
  const sql = getAnalyticsSql();
  if (!sql) throw new Error("DATABASE_URL is required");
  const token = randomUUID();
  await sql`insert into analytics_sync_state (stream_key) values (${streamKey}) on conflict do nothing`;
  const rows = await sql`
    update analytics_sync_state set lease_token = ${token}, lease_expires_at = now() + (${leaseSeconds} * interval '1 second'),
      last_started_at = now(), last_error = null, updated_at = now()
    where stream_key = ${streamKey} and (lease_token is null or lease_expires_at is null or lease_expires_at < now())
    returning cursor_value
  ` as unknown as LeaseRow[];
  if (!rows[0]) return null;

  const ensureOwnership = (updated: unknown[]) => {
    if (!updated.length) throw new Error(`Analytics sync lease ${streamKey} is no longer owned by this process`);
  };
  return {
    streamKey,
    token,
    cursor: rows[0].cursor_value,
    checkpoint: async (cursor, processed, imported, metadata = {}) => {
      const updated = await sql`
        update analytics_sync_state set cursor_value = ${cursor}, processed_count = processed_count + ${processed},
          imported_count = imported_count + ${imported}, metadata = metadata || ${JSON.stringify(metadata)}::jsonb,
          lease_expires_at = now() + (${leaseSeconds} * interval '1 second'), updated_at = now()
        where stream_key = ${streamKey} and lease_token = ${token} returning stream_key
      ` as unknown[];
      ensureOwnership(updated);
    },
    succeed: async (processed, imported, metadata = {}) => {
      const updated = await sql`
        update analytics_sync_state set processed_count = processed_count + ${processed}, imported_count = imported_count + ${imported},
          metadata = metadata || ${JSON.stringify(metadata)}::jsonb, last_finished_at = now(), last_success_at = now(),
          last_error = null, failure_count = 0, lease_token = null, lease_expires_at = null, updated_at = now()
        where stream_key = ${streamKey} and lease_token = ${token} returning stream_key
      ` as unknown[];
      ensureOwnership(updated);
    },
    fail: async (error) => {
      await sql`
        update analytics_sync_state set last_finished_at = now(), last_error = ${message(error)}, failure_count = failure_count + 1,
          lease_token = null, lease_expires_at = null, updated_at = now()
        where stream_key = ${streamKey} and lease_token = ${token}
      `;
    },
  };
}

export async function knownAnalyticsTenderIds(ids: string[], datasetId?: string) {
  const sql = getAnalyticsSql();
  if (!sql || !ids.length) return new Set<string>();
  const rows = datasetId
    ? await sql`
        select p.id from analytics_procurements p join analytics_dataset_procurements dp on dp.procurement_id = p.id
        where dp.dataset_id = ${datasetId} and p.id = any(${ids}::text[])
      `
    : await sql`select id from analytics_procurements where id = any(${ids}::text[])`;
  return new Set(rows.map((row) => row.id));
}

export async function analyticsTenderIdsForContracts(contractIds: string[]) {
  const sql = getAnalyticsSql();
  if (!sql || !contractIds.length) return new Map<string, string>();
  const rows = await sql`
    select source_contract_id, procurement_id from analytics_contracts where source_contract_id = any(${contractIds}::text[])
  ` as unknown as Array<{ source_contract_id: string; procurement_id: string }>;
  return new Map(rows.map((row) => [row.source_contract_id, row.procurement_id]));
}

export async function enqueueAnalyticsTenders(items: EnqueueAnalyticsItem[]) {
  const sql = getAnalyticsSql();
  if (!sql) throw new Error("DATABASE_URL is required");
  for (const item of items) {
    await sql`
      insert into analytics_sync_queue (dataset_id, tender_id, scope_mode, direction, source_name, filter_definition, priority)
      values (${item.datasetId}, ${item.tenderId}, ${item.scope}, ${item.direction}, ${item.sourceName},
        ${JSON.stringify(item.filters)}::jsonb, ${item.priority ?? 0})
      on conflict (dataset_id, tender_id) do update set direction = coalesce(excluded.direction, analytics_sync_queue.direction),
        source_name = excluded.source_name, filter_definition = excluded.filter_definition,
        priority = greatest(analytics_sync_queue.priority, excluded.priority), available_at = least(analytics_sync_queue.available_at, now()),
        updated_at = now()
    `;
  }
  return items.length;
}

export async function nextAnalyticsQueueItems(limit: number) {
  const sql = getAnalyticsSql();
  if (!sql) throw new Error("DATABASE_URL is required");
  return await sql`
    select dataset_id, tender_id, scope_mode, direction, source_name, filter_definition, attempts
    from analytics_sync_queue where available_at <= now()
    order by priority desc, discovered_at asc limit ${limit}
  ` as unknown as AnalyticsQueueItem[];
}

export async function completeAnalyticsQueueItems(items: Array<{ datasetId: string; tenderId: string }>) {
  const sql = getAnalyticsSql();
  if (!sql || !items.length) return;
  for (const item of items) {
    await sql`delete from analytics_sync_queue where dataset_id = ${item.datasetId} and tender_id = ${item.tenderId}`;
  }
}

export async function failAnalyticsQueueItem(datasetId: string, tenderId: string, error: unknown) {
  const sql = getAnalyticsSql();
  if (!sql) throw new Error("DATABASE_URL is required");
  await sql`
    update analytics_sync_queue set attempts = attempts + 1, last_error = ${message(error)},
      available_at = now() + (least(3600, 30 * power(2, least(attempts, 7))) * interval '1 second'), updated_at = now()
    where dataset_id = ${datasetId} and tender_id = ${tenderId}
  `;
}

export async function queuedAnalyticsCount(datasetId?: string) {
  const sql = getAnalyticsSql();
  if (!sql) return 0;
  const rows = datasetId
    ? await sql`select count(*)::integer as count from analytics_sync_queue where dataset_id = ${datasetId}`
    : await sql`select count(*)::integer as count from analytics_sync_queue`;
  return Number((rows as unknown as Array<{ count: number | string }>)[0]?.count ?? 0);
}

export async function analyticsTenderIdsMissingPublication(datasetId: string, limit = 100) {
  const sql = getAnalyticsSql();
  if (!sql) return [];
  const rows = await sql`
    select p.id from analytics_procurements p join analytics_dataset_procurements dp on dp.procurement_id = p.id
    where dp.dataset_id = ${datasetId} and p.published_at is null limit ${limit}
  ` as unknown as Array<{ id: string }>;
  return rows.map((row) => row.id);
}

export async function monitoringAnalyticsSyncSummary() {
  const sql = getAnalyticsSql();
  if (!sql) return null;
  const [stateRows, queueRows] = await Promise.all([
    sql`
      select cursor_value, last_success_at, last_error, failure_count
      from analytics_sync_state where stream_key = 'monitoring-discovery'
    `,
    sql`select count(*)::integer as count from analytics_sync_queue where scope_mode = 'monitoring'`,
  ]);
  const state = (stateRows as unknown as Array<{
    cursor_value: string | null;
    last_success_at: string | Date | null;
    last_error: string | null;
    failure_count: number;
  }>)[0];
  const queued = Number((queueRows as unknown as Array<{ count: number | string }>)[0]?.count ?? 0);
  return {
    backfillComplete: state?.cursor_value === "complete",
    cursor: state?.cursor_value ?? null,
    queued,
    lastSuccessAt: state?.last_success_at instanceof Date ? state.last_success_at.toISOString() : state?.last_success_at ?? null,
    degraded: Boolean(state?.last_error && state.failure_count > 0),
  };
}

/** One-time cleanup after tightening SmartTender's publication-day boundary. */
export async function ensureMonitoringDiscoveryVersion(version: string) {
  const sql = getAnalyticsSql();
  if (!sql) throw new Error("DATABASE_URL is required");
  const streamKey = `monitoring-discovery-version:${version}`;
  const rows = await sql`
    insert into analytics_sync_state (stream_key, cursor_value, last_success_at)
    values (${streamKey}, ${version}, now()) on conflict do nothing returning stream_key
  ` as unknown[];
  if (!rows.length) return false;
  await sql`delete from analytics_sync_queue where scope_mode = 'monitoring'`;
  await sql`delete from analytics_dataset_procurements where dataset_id = 'analytics-v2-monitoring'`;
  await sql`
    update analytics_datasets set status = 'building', coverage = '{}'::jsonb, updated_at = now()
    where id = 'analytics-v2-monitoring'
  `;
  return true;
}
