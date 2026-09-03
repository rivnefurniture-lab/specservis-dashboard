import "server-only";

import { randomUUID } from "node:crypto";
import { getAnalyticsSql } from "@/lib/analytics-v2-db";
import type {
  MonitoringConfidence,
  MonitoringCpvNode,
  MonitoringReviewStatus,
  MonitoringRuleEntry,
  MonitoringRuleSuggestion,
  MonitoringSyncStream,
  MonitoringV2Filters,
  MonitoringV2Payload,
  MonitoringV2Row,
} from "@/lib/monitoring-v2-types";
import { collapseDirectionRows, TENDER_DIRECTION_GROUPS } from "@/lib/tender-scope";

type QueryRow = Omit<MonitoringV2Row,
  "expectedAmount" | "participantCount" | "directions" | "reasons" | "needsGeographyReview" | "ruleVersion"
> & {
  expectedAmount: string | number | null;
  participantCount: string | number;
  directions: MonitoringV2Row["directions"] | null;
  reasons: MonitoringV2Row["reasons"] | null;
  needsGeographyReview: boolean | null;
  ruleVersion: string | null;
  total_count: string | number;
};

const textArray = (value?: string[]) => value?.length ? value : null;
const text = (value?: string) => value?.trim() || null;
const amount = (value: string | number | null) => value == null ? null : Number(value);
const iso = (value: string | Date | null) => value instanceof Date ? value.toISOString() : value;

async function timedQuery(name: string, query: PromiseLike<unknown>) {
  const startedAt = performance.now();
  try {
    const result = await query;
    console.info("[monitoring-v2] query completed", {
      name,
      durationMs: Math.round(performance.now() - startedAt),
      rows: Array.isArray(result) ? result.length : null,
    });
    return result;
  } catch (error) {
    console.error("[monitoring-v2] query failed", {
      name,
      durationMs: Math.round(performance.now() - startedAt),
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

function currentStreamKeys(now: Date) {
  const day = now.toISOString().slice(0, 10);
  return [
    { key: "monitoring-discovery", expectedEveryMinutes: 60 },
    { key: "prozorro-tenders", expectedEveryMinutes: 60 },
    { key: "prozorro-contracts", expectedEveryMinutes: 1_440 },
    { key: `monitoring-control:recent-30-days:${day}`, expectedEveryMinutes: 1_440 },
    { key: `monitoring-control:contracts:${day}`, expectedEveryMinutes: 1_440 },
    { key: `monitoring-control:full-history:${day.slice(0, 7)}`, expectedEveryMinutes: 44_640 },
  ];
}

export async function loadMonitoringV2(
  filters: MonitoringV2Filters,
  options: { maxPageSize?: number } = {},
): Promise<MonitoringV2Payload | null> {
  const sql = getAnalyticsSql();
  if (!sql) return null;
  const page = Math.max(1, Math.floor(filters.page ?? 1));
  const pageSize = Math.min(options.maxPageSize ?? 200, Math.max(20, Math.floor(filters.pageSize ?? 50)));
  const offset = (page - 1) * pageSize;
  const query = text(filters.q);
  const needle = query ? `%${query}%` : null;
  const keyword = text(filters.keyword);
  const keywordNeedle = keyword ? `%${keyword}%` : null;
  const buyer = text(filters.buyer);
  const buyerNeedle = buyer ? `%${buyer}%` : null;
  const cpv = text(filters.cpv)?.replace(/\D/g, "") || null;
  const cpvNameNeedle = text(filters.cpv) ? `%${text(filters.cpv)}%` : null;
  const selectedCpv = (filters.cpvCodes ?? []).map((item) => item.replace(/\D/g, "").slice(0, 8)).filter(Boolean);
  const exclusions = (filters.cpvExclusions ?? []).map((item) => item.replace(/\D/g, "")).filter(Boolean);
  const sort = filters.sort ?? "newest";
  const directions = textArray(filters.directions);
  const categories = textArray(filters.categories);
  const procedures = textArray(filters.procedures);
  const statuses = textArray(filters.statuses);
  const confidence = textArray(filters.confidence);
  const geography = textArray(filters.geography);
  const reviewStatuses = textArray(filters.reviewStatuses);
  const now = new Date();
  const streamExpectations = currentStreamKeys(now);
  const streamKeys = streamExpectations.map((item) => item.key);

  const [recordRows, summaryRows, datasetRows, categoryRows, procedureRows, statusRows, cpvRows, ruleRows, suggestionRows, syncRows, queueRows] = await Promise.all([
    timedQuery("records", sql`
      with base as (
        select
          l.id,
          p.id as "procurementId",
          p.tender_id as "tenderId",
          l.id as "lotId",
          coalesce(nullif(l.title, ''), p.title) as title,
          coalesce(nullif(l.description, ''), p.description) as description,
          p.buyer_id as "buyerId",
          coalesce(buyer.legal_name, 'Замовника не вказано') as "buyerName",
          buyer.identifier as "buyerCode",
          p.published_at as "publishedAt",
          p.submission_end_at as "deadlineAt",
          p.main_category as category,
          coalesce(p.procurement_method_type, p.procurement_method) as procedure,
          coalesce(l.status, p.status) as status,
          coalesce(item.cpv_codes, array_remove(array[p.cpv_code], null)) as "cpvCodes",
          coalesce(item.cpv_names, '{}'::text[]) as "cpvNames",
          coalesce(l.expected_amount, p.expected_amount) as "expectedAmount",
          coalesce(l.expected_currency, p.expected_currency) as currency,
          coalesce(bids.participant_count, 0) as "participantCount",
          coalesce(match_directions.directions,
            case when p.department is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object(
              'id', p.department, 'slug', p.department, 'label', p.department, 'primary', true
            )) end) as directions,
          coalesce(primary_match.confidence, nullif(p.relevance->>'confidence', ''), 'review') as confidence,
          coalesce(primary_match.reasons, '[]'::jsonb) as reasons,
          coalesce(primary_match.matched_fields, '{}'::text[]) as "matchedFields",
          coalesce(primary_match.matched_terms, '{}'::text[]) as "matchedTerms",
          case
            when primary_match.geography_basis = 'buyer_fallback' and buyer.locality ilike 'київ%' then 'м. Київ · за адресою замовника'
            when primary_match.geography_basis = 'buyer_fallback' and buyer.region ilike '%київ%' then 'Київська область · за адресою замовника'
            when coalesce(item.region_count, 0) = 0 then 'Не визначена'
            when item.region_count > 1 then 'Змішана'
            when item.locality_text ilike 'київ%' then 'м. Київ'
            when item.region_text ilike '%київ%' then 'Київська область'
            else 'Інші області'
          end as geography,
          primary_match.geography_basis as "geographyBasis",
          coalesce(primary_match.needs_geography_review, coalesce(item.region_count, 0) = 0) as "needsGeographyReview",
          item.delivery_text as "deliveryAddress",
          review.status as "reviewStatus",
          review.comment as "reviewComment",
          primary_match.rule_version as "ruleVersion",
          p.prozorro_url as "prozorroUrl"
        from analytics_lots l
        join analytics_procurements p on p.id = l.procurement_id
        join analytics_dataset_procurements dp on dp.procurement_id = p.id and dp.dataset_id = 'analytics-v2-monitoring'
        left join analytics_organizations buyer on buyer.id = p.buyer_id
        left join lateral (
          select
            array_agg(distinct i.cpv_code) filter (where i.cpv_code is not null) as cpv_codes,
            array_agg(distinct i.cpv_name) filter (where i.cpv_name is not null) as cpv_names,
            count(distinct nullif(i.delivery_region, ''))::integer as region_count,
            string_agg(distinct nullif(i.delivery_region, ''), ' · ') as region_text,
            string_agg(distinct nullif(i.delivery_locality, ''), ' · ') as locality_text,
            string_agg(distinct nullif(i.delivery_text, ''), ' | ') as delivery_text
          from analytics_items i where i.lot_id = l.id or (i.lot_id is null and i.procurement_id = p.id and l.is_synthetic_root)
        ) item on true
        left join lateral (
          select count(distinct b.supplier_id)::integer as participant_count
          from analytics_bids b where b.lot_id = l.id and b.is_published = true
        ) bids on true
        left join lateral (
          select m.confidence, m.reasons, m.matched_fields, m.matched_terms, m.geography_basis,
            m.needs_geography_review, m.rule_version
          from analytics_monitoring_matches m
          where m.lot_id = l.id and m.is_primary
          order by m.classified_at desc limit 1
        ) primary_match on true
        left join lateral (
          select jsonb_agg(jsonb_build_object('id', direction_id, 'slug', slug, 'label', label, 'primary', is_primary)
            order by is_primary desc, priority desc) as directions
          from (
            select distinct on (m.direction_id) m.*, d.slug, d.label, d.priority
            from analytics_monitoring_matches m
            join analytics_monitoring_directions d on d.id = m.direction_id
            where m.lot_id = l.id
            order by m.direction_id, m.classified_at desc
          ) latest_matches
        ) match_directions on true
        left join lateral (
          select r.status, r.comment from analytics_relevance_reviews r
          where r.lot_id = l.id order by r.updated_at desc limit 1
        ) review on true
      )
      select *, count(*) over() as total_count from base
      where (${needle}::text is null or title ilike ${needle} or description ilike ${needle}
          or "tenderId" ilike ${needle} or "buyerName" ilike ${needle} or coalesce("buyerCode", '') ilike ${needle})
        and (${filters.from || null}::date is null or "publishedAt" >= ${filters.from || null}::date)
        and (${filters.to || null}::date is null or "publishedAt" < ${filters.to || null}::date + interval '1 day')
        and (${filters.deadlineFrom || null}::date is null or "deadlineAt" >= ${filters.deadlineFrom || null}::date)
        and (${filters.deadlineTo || null}::date is null or "deadlineAt" < ${filters.deadlineTo || null}::date + interval '1 day')
        and (${buyerNeedle}::text is null or "buyerName" ilike ${buyerNeedle} or coalesce("buyerCode", '') ilike ${buyerNeedle})
        and (${directions}::text[] is null or exists (
          select 1 from jsonb_array_elements(directions) d where d->>'id' = any(${directions}::text[]) or d->>'slug' = any(${directions}::text[])
        ))
        and (${categories}::text[] is null or category = any(${categories}::text[]))
        and (${procedures}::text[] is null or procedure = any(${procedures}::text[]))
        and (${statuses}::text[] is null or status = any(${statuses}::text[]))
        and (${confidence}::text[] is null or confidence = any(${confidence}::text[]))
        and (${geography}::text[] is null or geography = any(${geography}::text[]))
        and (${reviewStatuses}::text[] is null or "reviewStatus" = any(${reviewStatuses}::text[]))
        and (${filters.amountMin ?? null}::numeric is null or "expectedAmount" >= ${filters.amountMin ?? null}::numeric)
        and (${filters.amountMax ?? null}::numeric is null or "expectedAmount" <= ${filters.amountMax ?? null}::numeric)
        and (${filters.participantsMin ?? null}::integer is null or "participantCount" >= ${filters.participantsMin ?? null}::integer)
        and (${filters.participantsMax ?? null}::integer is null or "participantCount" <= ${filters.participantsMax ?? null}::integer)
        and (${cpv}::text is null or exists (
          select 1 from unnest("cpvCodes") code where
            (${filters.cpvIncludeDescendants !== false} and regexp_replace(code, '\\D', '', 'g') like ${cpv ? `${cpv}%` : null})
            or (${filters.cpvIncludeDescendants === false} and regexp_replace(code, '\\D', '', 'g') = ${cpv})
        ) or exists (select 1 from unnest("cpvNames") name where name ilike ${cpvNameNeedle}))
        and (${selectedCpv.length ? selectedCpv : null}::text[] is null or exists (
          select 1 from unnest("cpvCodes") code, unnest(${selectedCpv.length ? selectedCpv : null}::text[]) selected
          where regexp_replace(code, '\\D', '', 'g') like selected || '%'
        ))
        and (${exclusions.length ? exclusions : null}::text[] is null or not exists (
          select 1 from unnest("cpvCodes") code, unnest(${exclusions.length ? exclusions : null}::text[]) excluded
          where regexp_replace(code, '\\D', '', 'g') like excluded || '%'
        ))
        and (${keywordNeedle}::text is null or title ilike ${keywordNeedle} or description ilike ${keywordNeedle}
          or exists (select 1 from unnest("matchedTerms") term where term ilike ${keywordNeedle})
          or reasons::text ilike ${keywordNeedle})
        and coalesce("reviewStatus", '') not in ('not_relevant', 'missed')
      order by
        case when ${sort} = 'deadline' then "deadlineAt" end asc nulls last,
        case when ${sort} = 'amount-desc' then "expectedAmount" end desc nulls last,
        case when ${sort} = 'amount-asc' then "expectedAmount" end asc nulls last,
        "publishedAt" desc nulls last, "tenderId" desc, "lotId" asc
      limit ${pageSize} offset ${offset}
    `),
    timedQuery("summary", sql`
      select
        count(distinct l.id) filter (where p.published_at >= (now() at time zone 'Europe/Kyiv')::date)::integer as today_lots,
        coalesce(sum(coalesce(l.expected_amount, p.expected_amount)) filter (
          where p.published_at >= (now() at time zone 'Europe/Kyiv')::date and coalesce(l.expected_currency, p.expected_currency, 'UAH') = 'UAH'
        ), 0) as today_value_uah,
        count(distinct l.id) filter (where p.published_at >= date_trunc('month', now() at time zone 'Europe/Kyiv'))::integer as month_lots,
        coalesce(sum(coalesce(l.expected_amount, p.expected_amount)) filter (
          where p.published_at >= date_trunc('month', now() at time zone 'Europe/Kyiv') and coalesce(l.expected_currency, p.expected_currency, 'UAH') = 'UAH'
        ), 0) as month_value_uah
      from analytics_lots l
      join analytics_procurements p on p.id = l.procurement_id
      join analytics_dataset_procurements dp on dp.procurement_id = p.id and dp.dataset_id = 'analytics-v2-monitoring'
      where (${directions}::text[] is null or p.department = any(${directions}::text[]) or exists (
        select 1 from analytics_monitoring_matches m where m.lot_id = l.id and m.direction_id = any(${directions}::text[])
      ))
      and not exists (
        select 1 from analytics_relevance_reviews r where r.lot_id = l.id and r.status in ('not_relevant', 'missed')
      )
    `),
    timedQuery("dataset", sql`select generated_at from analytics_datasets where id = 'analytics-v2-monitoring' limit 1`),
    timedQuery("categories", sql`select coalesce(main_category, 'Не вказано') as value, count(*)::integer as count from analytics_procurements group by 1 order by count desc`),
    timedQuery("procedures", sql`select coalesce(procurement_method_type, procurement_method, 'Не вказано') as value, count(*)::integer as count from analytics_procurements group by 1 order by count desc limit 100`),
    timedQuery("statuses", sql`select coalesce(status, 'Не вказано') as value, count(*)::integer as count from analytics_procurements group by 1 order by count desc`),
    timedQuery("cpv", sql`
      select regexp_replace(i.cpv_code, '\\D', '', 'g') as code,
        coalesce(max(nullif(i.cpv_name, '')), regexp_replace(i.cpv_code, '\\D', '', 'g')) as label,
        count(distinct coalesce(i.lot_id, i.procurement_id))::integer as count
      from analytics_items i
      where i.cpv_code is not null
      group by regexp_replace(i.cpv_code, '\\D', '', 'g')
      order by count desc limit 1500
    `),
    timedQuery("rules", sql`
      select e.id, e.direction_id, d.label as direction_label, e.entry_kind, e.value, rs.version,
        e.include_descendants, e.field_scope, e.active, e.priority
      from analytics_monitoring_rule_entries e
      join analytics_monitoring_rule_sets rs on rs.id = e.rule_set_id and rs.status = 'active'
      join analytics_monitoring_directions d on d.id = e.direction_id
      order by d.priority desc, e.entry_kind, e.priority desc, e.value
    `),
    timedQuery("suggestions", sql`
      select suggested_rule_change->>'directionId' as direction_id,
        suggested_rule_change->>'kind' as kind,
        suggested_rule_change->>'value' as value,
        count(*)::integer as occurrences,
        (array_agg(comment order by updated_at desc) filter (where comment is not null))[1] as latest_comment,
        max(updated_at) as latest_at
      from analytics_relevance_reviews
      where suggested_rule_change <> '{}'::jsonb
        and coalesce(suggested_rule_change->>'value', '') <> ''
      group by 1, 2, 3
      order by occurrences desc, latest_at desc
      limit 100
    `),
    timedQuery("sync", sql`
      select stream_key, cursor_value, last_success_at, last_error, failure_count,
        lease_expires_at is not null and lease_expires_at > now() as running
      from analytics_sync_state where stream_key = any(${streamKeys}::text[])
    `),
    timedQuery("queue", sql`select count(*)::integer as count from analytics_sync_queue where scope_mode = 'monitoring'`),
  ]);

  const rawRows = recordRows as unknown as QueryRow[];
  const rows: MonitoringV2Row[] = rawRows.map((row) => ({
    ...row,
    expectedAmount: amount(row.expectedAmount),
    participantCount: Number(row.participantCount),
    directions: collapseDirectionRows(row.directions ?? []),
    reasons: row.reasons ?? [],
    needsGeographyReview: Boolean(row.needsGeographyReview),
    ruleVersion: row.ruleVersion,
  }));
  const streams: MonitoringSyncStream[] = (syncRows as unknown as Array<{
    stream_key: string; cursor_value: string | null; last_success_at: string | Date | null;
    last_error: string | null; failure_count: number; running: boolean;
  }>).map((row) => ({
    ...(() => {
      const expectedEveryMinutes = streamExpectations.find((item) => item.key === row.stream_key)?.expectedEveryMinutes ?? 60;
      const lagMinutes = row.last_success_at ? Math.max(0, Math.round((now.getTime() - new Date(row.last_success_at).getTime()) / 60_000)) : null;
      return { expectedEveryMinutes, lagMinutes, overdue: lagMinutes == null || lagMinutes > expectedEveryMinutes };
    })(),
    key: row.stream_key,
    cursor: row.cursor_value,
    lastSuccessAt: iso(row.last_success_at),
    lastError: row.last_error,
    failureCount: row.failure_count,
    running: row.running,
  }));
  const ingestionStreams = streams.filter((row) => row.key === "monitoring-discovery" || row.key === "prozorro-tenders");
  const successTimes = ingestionStreams.map((row) => row.lastSuccessAt ? Date.parse(row.lastSuccessAt) : NaN).filter(Number.isFinite);
  const latestSuccess = successTimes.length ? Math.max(...successTimes) : null;
  const maximumLag = ingestionStreams.map((row) => row.lagMinutes).filter((value): value is number => value != null);
  const queued = Number((queueRows as unknown as Array<{ count: number | string }>)[0]?.count ?? 0);
  const activeRuleVersion = (ruleRows as unknown as Array<{ version?: string }>)[0]?.version;
  const cpvTree = buildCpvTree(cpvRows as unknown as Array<{ code: string; label: string; count: number | string }>);
  const summary = (summaryRows as unknown as Array<{
    today_lots: number | string; today_value_uah: number | string;
    month_lots: number | string; month_value_uah: number | string;
  }>)[0];

  return {
    generatedAt: iso((datasetRows as unknown as Array<{ generated_at: string | Date }>)[0]?.generated_at ?? null),
    ruleVersion: activeRuleVersion ?? rows[0]?.ruleVersion ?? null,
    total: Number(rawRows[0]?.total_count ?? 0),
    page,
    pageSize,
    rows,
    summary: {
      today: { lots: Number(summary?.today_lots ?? 0), expectedValueUah: Number(summary?.today_value_uah ?? 0) },
      month: { lots: Number(summary?.month_lots ?? 0), expectedValueUah: Number(summary?.month_value_uah ?? 0) },
    },
    facets: {
      directions: TENDER_DIRECTION_GROUPS.map((group) => ({ value: group.id, label: group.label })),
      categories: (categoryRows as unknown as Array<{ value: string; count: number }>).map((row) => ({ ...row, label: row.value })),
      procedures: (procedureRows as unknown as Array<{ value: string; count: number }>).map((row) => ({ ...row, label: row.value })),
      statuses: (statusRows as unknown as Array<{ value: string; count: number }>).map((row) => ({ ...row, label: row.value })),
      geography: ["м. Київ", "Київська область", "м. Київ · за адресою замовника", "Київська область · за адресою замовника", "Інші області", "Змішана", "Не визначена"].map((value) => ({ value, label: value })),
      cpv: cpvTree,
    },
    rules: (ruleRows as unknown as Array<{
      id: string; direction_id: string; direction_label: string; entry_kind: MonitoringRuleEntry["kind"];
      value: string; include_descendants: boolean; field_scope: string[]; active: boolean; priority: number;
    }>).map((row) => ({
      id: row.id,
      directionId: row.direction_id,
      directionLabel: TENDER_DIRECTION_GROUPS.find((group) => group.directions.includes(row.direction_id))?.label ?? row.direction_label,
      kind: row.entry_kind,
      value: row.value,
      includeDescendants: row.include_descendants,
      fields: row.field_scope,
      active: row.active,
      priority: row.priority,
    })),
    ruleSuggestions: (suggestionRows as unknown as Array<{
      direction_id: string; kind: MonitoringRuleSuggestion["kind"]; value: string;
      occurrences: number | string; latest_comment: string | null; latest_at: string | Date;
    }>).map((row) => ({
      directionId: row.direction_id,
      kind: row.kind,
      value: row.value,
      occurrences: Number(row.occurrences),
      latestComment: row.latest_comment,
      latestAt: iso(row.latest_at) ?? new Date(0).toISOString(),
    })),
    sync: {
      lastSuccessfulAt: latestSuccess ? new Date(latestSuccess).toISOString() : null,
      maximumLagMinutes: maximumLag.length ? Math.max(...maximumLag) : null,
      incomplete: streams.some((row) => row.failureCount > 0 || Boolean(row.lastError) || row.overdue) || queued > 0 || streams.length < streamKeys.length,
      queued,
      streams,
    },
  };
}

function buildCpvTree(rows: Array<{ code: string; label: string; count: number | string }>): MonitoringCpvNode[] {
  const nodes = new Map<string, MonitoringCpvNode>();
  const levels = [2, 3, 4, 5, 8];
  for (const row of rows) {
    const full = row.code.replace(/\D/g, "").slice(0, 8);
    if (full.length < 2) continue;
    const count = Number(row.count);
    for (const [depth, length] of levels.entries()) {
      if (full.length < length) continue;
      const code = full.slice(0, length);
      const previous = nodes.get(code);
      const label = length === 8 ? row.label : `${["Розділ", "Група", "Клас", "Категорія"][depth] ?? "Код"} ${code}`;
      nodes.set(code, {
        value: code,
        code,
        label,
        count: (previous?.count ?? 0) + count,
        parentCode: depth === 0 ? null : full.slice(0, levels[depth - 1]),
        depth,
      });
    }
  }
  return [...nodes.values()].sort((left, right) => left.code.localeCompare(right.code) || left.depth - right.depth);
}

export async function saveMonitoringReview(input: {
  procurementId: string;
  lotId: string;
  directionId?: string | null;
  status: MonitoringReviewStatus;
  comment?: string | null;
  suggestedRuleChange?: { directionId: string; kind: MonitoringRuleEntry["kind"]; value: string } | null;
  reviewedBy: string;
}) {
  const sql = getAnalyticsSql();
  if (!sql) return null;
  const id = randomUUID();
  const rows = await sql`
    insert into analytics_relevance_reviews (id, procurement_id, lot_id, direction_id, status, comment, suggested_rule_change, reviewed_by)
    values (${id}, ${input.procurementId}, ${input.lotId}, ${input.directionId ?? null}, ${input.status}, ${text(input.comment ?? undefined)},
      ${JSON.stringify(input.suggestedRuleChange ?? {})}::jsonb, ${input.reviewedBy})
    on conflict (lot_id, direction_id) do update set status = excluded.status, comment = excluded.comment,
      suggested_rule_change = excluded.suggested_rule_change, reviewed_by = excluded.reviewed_by,
      reviewed_at = now(), updated_at = now()
    returning id, status, comment, reviewed_at
  `;
  return rows[0] ?? null;
}

export const monitoringReviewStatuses: readonly MonitoringReviewStatus[] = [
  "relevant", "not_relevant", "needs_review", "missed",
];

export const monitoringConfidenceLevels: readonly MonitoringConfidence[] = ["high", "medium", "review"];
