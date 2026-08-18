import "server-only";

import { createHash } from "node:crypto";
import { getAnalyticsSql } from "@/lib/analytics-v2-db";
import type { AnalyticsV2Filters } from "@/lib/analytics-v2-engine";

type RequestRow = {
  id: string;
  dataset_id: string;
  filter_definition: Record<string, unknown>;
  status: "pending" | "syncing" | "ready" | "failed";
};

function definition(filters: AnalyticsV2Filters) {
  return {
    from: filters.from,
    to: filters.to,
    cpvPrefixes: [...(filters.cpvPrefixes ?? [])].sort(),
    subjectQuery: filters.subjectQuery?.trim() || null,
  };
}

function requestIdentity(filters: AnalyticsV2Filters) {
  const serialized = JSON.stringify(definition(filters));
  return createHash("sha256").update(serialized).digest("hex").slice(0, 24);
}

export function isExpandedDiscovery(filters: AnalyticsV2Filters) {
  return filters.scope === "expanded" && Boolean(filters.cpvPrefixes?.length || filters.subjectQuery);
}

export async function ensureExpandedAnalyticsRequest(ownerAccountId: string, filters: AnalyticsV2Filters) {
  const sql = getAnalyticsSql();
  if (!sql) return null;
  const key = requestIdentity(filters);
  const datasetId = `analytics-v2-expanded-${key}`;
  const requestId = `expanded-${key}`;
  const filtersJson = JSON.stringify(definition(filters));
  await sql`
    insert into analytics_datasets (id, scope_mode, filter_definition, generated_at, source_name, status, coverage)
    values (${datasetId}, 'expanded', ${filtersJson}::jsonb, now(), 'Official Prozorro API · expanded search', 'building', '{}'::jsonb)
    on conflict (id) do nothing
  `;
  await sql`
    insert into analytics_sync_requests (id, owner_account_id, dataset_id, filter_definition, status)
    values (${requestId}, ${ownerAccountId}, ${datasetId}, ${filtersJson}::jsonb, 'pending')
    on conflict (id) do update set requested_at = now(), updated_at = now(),
      status = case when analytics_sync_requests.status = 'failed' then 'pending' else analytics_sync_requests.status end
  `;
  const rows = await sql`
    select id, dataset_id, filter_definition, status from analytics_sync_requests where id = ${requestId}
  ` as unknown as RequestRow[];
  return rows[0] ?? null;
}

export async function nextExpandedAnalyticsRequest() {
  const sql = getAnalyticsSql();
  if (!sql) return null;
  const rows = await sql`
    select id, dataset_id, filter_definition, status from analytics_sync_requests
    where status in ('pending', 'syncing', 'failed')
      or (status = 'ready' and requested_at > now() - interval '30 days' and last_success_at < now() - interval '6 hours')
    order by case status when 'pending' then 0 when 'syncing' then 1 when 'failed' then 2 else 3 end, requested_at desc
    limit 1
  ` as unknown as RequestRow[];
  return rows[0] ?? null;
}

export async function markExpandedAnalyticsRequest(id: string, status: RequestRow["status"], error?: unknown) {
  const sql = getAnalyticsSql();
  if (!sql) throw new Error("DATABASE_URL is required");
  const errorText = error == null ? null : (error instanceof Error ? error.message : String(error)).slice(0, 2_000);
  await sql`
    update analytics_sync_requests set status = ${status},
      last_started_at = case when ${status} = 'syncing' then now() else last_started_at end,
      last_finished_at = case when ${status} in ('ready', 'failed') then now() else last_finished_at end,
      last_success_at = case when ${status} = 'ready' then now() else last_success_at end,
      last_error = ${errorText}, failure_count = case when ${status} = 'failed' then failure_count + 1 when ${status} = 'ready' then 0 else failure_count end,
      updated_at = now() where id = ${id}
  `;
  if (status === "ready") {
    await sql`
      update analytics_datasets set status = 'ready', generated_at = now(), source_updated_at = now(),
        coverage = jsonb_set(coverage, '{complete}', 'true'::jsonb, true), updated_at = now()
      where id = (select dataset_id from analytics_sync_requests where id = ${id})
    `;
  }
}
