import "server-only";

import { getAnalyticsSql } from "@/lib/analytics-v2-db";
import {
  DEFAULT_MONITORING_RULE_SET,
  normalizeMonitoringText,
  type MonitoringDirectionId,
  type MonitoringDirectionRule,
  type MonitoringRuleSet,
} from "@/lib/monitoring-rules";

let defaultRuleSync: Promise<void> | null = null;

async function ensureDefaultMonitoringRuleSet() {
  if (defaultRuleSync) return defaultRuleSync;
  defaultRuleSync = (async () => {
    const sql = getAnalyticsSql();
    if (!sql) return;
    const active = await sql`select id, version from analytics_monitoring_rule_sets where status = 'active' limit 1` as unknown as Array<{ id: string; version: string }>;
    if (active[0]?.version === DEFAULT_MONITORING_RULE_SET.version) return;
    const ruleSetId = `monitoring-default-${DEFAULT_MONITORING_RULE_SET.version.replace(/\W/g, "")}`;
    await sql`
      insert into analytics_monitoring_rule_sets (id, version, title, status, definition, published_at, published_by)
      values (${ruleSetId}, ${DEFAULT_MONITORING_RULE_SET.version}, 'Повні правила моніторингу за ТЗ', 'draft',
        '{"normalization":"uk-ru-translit-wordforms-v2","primaryPriority":"climate-before-construction"}'::jsonb,
        now(), 'system:tz')
      on conflict (id) do nothing
    `;
    for (const direction of DEFAULT_MONITORING_RULE_SET.directions) {
      await sql`
        insert into analytics_monitoring_rule_directions (rule_set_id, direction_id, priority, enabled_for_monitoring, analysis_only)
        values (${ruleSetId}, ${direction.id}, ${direction.priority}, ${direction.enabledForMonitoring}, ${direction.analysisOnly === true})
        on conflict (rule_set_id, direction_id) do update set priority = excluded.priority,
          enabled_for_monitoring = excluded.enabled_for_monitoring, analysis_only = excluded.analysis_only
      `;
      const entries = [
        ...direction.cpv.map((entry) => ({ kind: "cpv_include" as const, value: entry.code, variants: [] as string[], descendants: entry.includeDescendants === true, metadata: { broad: (direction.broadCpv ?? []).includes(entry.code) } })),
        ...(direction.excludedCpv ?? []).map((entry) => ({ kind: "cpv_exclude" as const, value: entry.code, variants: [] as string[], descendants: entry.includeDescendants === true, metadata: {} })),
        ...direction.terms.map((entry) => ({ kind: "term" as const, value: entry.value, variants: entry.variants ?? [], descendants: false, metadata: { requiresContext: entry.requiresContext === true, exactPhrase: entry.exactPhrase === true } })),
        ...(direction.brands ?? []).map((entry) => ({ kind: "brand" as const, value: entry.value, variants: entry.variants ?? [], descendants: false, metadata: { requiresContext: entry.requiresContext === true, exactPhrase: entry.exactPhrase === true } })),
        ...(direction.exclusions ?? []).map((entry) => ({ kind: "exclusion" as const, value: entry.value, variants: entry.variants ?? [], descendants: false, metadata: {} })),
      ];
      for (const [index, entry] of entries.entries()) {
        const normalized = entry.kind.startsWith("cpv_") ? entry.value.replace(/\D/g, "") : normalizeMonitoringText(entry.value);
        await sql`
          insert into analytics_monitoring_rule_entries (id, rule_set_id, direction_id, entry_kind, value,
            normalized_value, include_descendants, variants, priority, metadata)
          values (${`${ruleSetId}:${direction.id}:${entry.kind}:${index}`}, ${ruleSetId}, ${direction.id}, ${entry.kind},
            ${entry.value}, ${normalized}, ${entry.descendants}, ${entry.variants}::text[],
            ${entry.kind === "exclusion" || entry.kind === "cpv_exclude" ? 200 : entry.kind === "brand" ? 60 : 100},
            ${JSON.stringify(entry.metadata)}::jsonb)
          on conflict (id) do update set value = excluded.value, normalized_value = excluded.normalized_value,
            include_descendants = excluded.include_descendants, variants = excluded.variants,
            priority = excluded.priority, metadata = excluded.metadata, active = true
        `;
      }
    }
    await sql`update analytics_monitoring_rule_sets set status = 'archived', updated_at = now() where status = 'active' and id <> ${ruleSetId}`;
    await sql`update analytics_monitoring_rule_sets set status = 'active', published_at = now(), updated_at = now() where id = ${ruleSetId}`;
  })().catch((error) => {
    defaultRuleSync = null;
    throw error;
  });
  return defaultRuleSync;
}

type DirectionRow = {
  rule_set_id: string;
  version: string;
  direction_id: MonitoringDirectionId;
  label: string;
  priority: number;
  enabled_for_monitoring: boolean;
  analysis_only: boolean;
};

type EntryRow = {
  direction_id: MonitoringDirectionId;
  entry_kind: "cpv_include" | "cpv_exclude" | "term" | "brand" | "exclusion";
  value: string;
  include_descendants: boolean;
  variants: string[];
  metadata: Record<string, unknown> | null;
};

/** Load the active, user-editable rule version; the code seed is a safe bootstrap. */
export async function loadActiveMonitoringRuleSet(): Promise<MonitoringRuleSet> {
  const sql = getAnalyticsSql();
  if (!sql) return DEFAULT_MONITORING_RULE_SET;
  await ensureDefaultMonitoringRuleSet();
  const [directionRecords, entryRecords] = await Promise.all([
    sql`
      select rd.rule_set_id, rs.version, rd.direction_id, d.label, rd.priority,
        rd.enabled_for_monitoring, rd.analysis_only
      from analytics_monitoring_rule_sets rs
      join analytics_monitoring_rule_directions rd on rd.rule_set_id = rs.id
      join analytics_monitoring_directions d on d.id = rd.direction_id
      where rs.status = 'active' and d.active
      order by rd.priority desc
    `,
    sql`
      select e.direction_id, e.entry_kind, e.value, e.include_descendants, e.variants, e.metadata
      from analytics_monitoring_rule_entries e
      join analytics_monitoring_rule_sets rs on rs.id = e.rule_set_id
      where rs.status = 'active' and e.active
      order by e.priority desc, e.value
    `,
  ]);
  const directions = directionRecords as unknown as DirectionRow[];
  if (!directions.length) return DEFAULT_MONITORING_RULE_SET;
  // The code seed is the contractual minimum. An older database seed must not
  // silently remove CPVs, phrases, brands, or exclusions added by the latest ТЗ.
  if (directions[0].version !== DEFAULT_MONITORING_RULE_SET.version) {
    return DEFAULT_MONITORING_RULE_SET;
  }
  const entries = entryRecords as unknown as EntryRow[];
  const rules: MonitoringDirectionRule[] = directions.map((direction) => {
    const own = entries.filter((entry) => entry.direction_id === direction.direction_id);
    return {
      id: direction.direction_id,
      label: direction.label,
      priority: direction.priority,
      enabledForMonitoring: direction.enabled_for_monitoring,
      analysisOnly: direction.analysis_only,
      cpv: own.filter((entry) => entry.entry_kind === "cpv_include")
        .map((entry) => ({ code: entry.value, includeDescendants: entry.include_descendants })),
      excludedCpv: own.filter((entry) => entry.entry_kind === "cpv_exclude")
        .map((entry) => ({ code: entry.value, includeDescendants: entry.include_descendants })),
      terms: own.filter((entry) => entry.entry_kind === "term")
        .map((entry) => ({
          value: entry.value,
          variants: entry.variants,
          requiresContext: entry.metadata?.requiresContext === true,
          exactPhrase: entry.metadata?.exactPhrase === true,
        })),
      brands: own.filter((entry) => entry.entry_kind === "brand")
        .map((entry) => ({
          value: entry.value,
          variants: entry.variants,
          requiresContext: entry.metadata?.requiresContext === true,
          exactPhrase: entry.metadata?.exactPhrase === true,
        })),
      exclusions: own.filter((entry) => entry.entry_kind === "exclusion")
        .map((entry) => ({ value: entry.value, variants: entry.variants })),
      broadCpv: own.filter((entry) => entry.entry_kind === "cpv_include" && entry.metadata?.broad === true)
        .map((entry) => entry.value),
    };
  });
  return { id: directions[0].rule_set_id, version: directions[0].version, directions: rules };
}
