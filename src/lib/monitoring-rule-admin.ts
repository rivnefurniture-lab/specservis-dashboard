import "server-only";

import { randomUUID } from "node:crypto";
import { getAnalyticsSql } from "@/lib/analytics-v2-db";
import { normalizeCpvCode, normalizeMonitoringText } from "@/lib/monitoring-rules";
import type { MonitoringRuleEntry } from "@/lib/monitoring-v2-types";

type EditableEntry = Pick<MonitoringRuleEntry,
  "id" | "directionId" | "kind" | "value" | "includeDescendants" | "fields" | "active" | "priority"
>;

type CurrentRuleRow = { id: string; version: string; title: string; definition: Record<string, unknown> };

function nextVersion(now: Date) {
  const day = now.toISOString().slice(0, 10).replaceAll("-", ".");
  return `${day}.${now.getTime()}`;
}

/**
 * Publish a copy-on-write rule version. Existing versions stay immutable and
 * auditable; the next sync automatically reclassifies data with the new set.
 */
export async function publishMonitoringRuleEntry(entry: EditableEntry, accountId: string) {
  const sql = getAnalyticsSql();
  if (!sql) return null;
  const currentRows = await sql`
    select id, version, title, definition from analytics_monitoring_rule_sets
    where status = 'active' order by published_at desc nulls last limit 1
  ` as unknown as CurrentRuleRow[];
  const current = currentRows[0];
  if (!current) throw new Error("Active monitoring rule set is missing");
  const now = new Date();
  const newRuleSetId = `monitoring-${randomUUID()}`;
  const newEntryId = `${newRuleSetId}:${randomUUID()}`;
  const version = nextVersion(now);
  const normalized = entry.kind.startsWith("cpv_") ? normalizeCpvCode(entry.value) : normalizeMonitoringText(entry.value);
  const fields = entry.fields.length ? entry.fields : [
    "procurement_title", "procurement_description", "lot_title", "lot_description", "item_description",
  ];
  const queries = [
    sql`update analytics_monitoring_rule_sets set status = 'archived', updated_at = now() where id = ${current.id}`,
    sql`
      insert into analytics_monitoring_rule_sets (id, version, title, status, definition, checksum, created_by, published_by, published_at)
      values (${newRuleSetId}, ${version}, ${current.title}, 'active', ${JSON.stringify(current.definition)}::jsonb,
        ${version}, ${accountId}, ${accountId}, now())
    `,
    sql`
      insert into analytics_monitoring_rule_directions (rule_set_id, direction_id, priority, enabled_for_monitoring, analysis_only, settings)
      select ${newRuleSetId}, direction_id, priority, enabled_for_monitoring, analysis_only, settings
      from analytics_monitoring_rule_directions where rule_set_id = ${current.id}
    `,
    sql`
      insert into analytics_monitoring_rule_entries (id, rule_set_id, direction_id, entry_kind, value,
        normalized_value, include_descendants, field_scope, variants, priority, active, metadata)
      select ${newRuleSetId} || ':' || id, ${newRuleSetId}, direction_id, entry_kind, value,
        normalized_value, include_descendants, field_scope, variants, priority, active, metadata
      from analytics_monitoring_rule_entries where rule_set_id = ${current.id} and id <> ${entry.id}
    `,
    sql`
      insert into analytics_monitoring_rule_entries (id, rule_set_id, direction_id, entry_kind, value,
        normalized_value, include_descendants, field_scope, variants, priority, active, metadata)
      values (${newEntryId}, ${newRuleSetId}, ${entry.directionId}, ${entry.kind}, ${entry.value.trim()}, ${normalized},
        ${entry.includeDescendants}, ${fields}::text[], '{}'::text[], ${entry.priority}, ${entry.active}, '{}'::jsonb)
    `,
  ];
  await sql.transaction(queries);
  return { ruleSetId: newRuleSetId, version, entryId: newEntryId };
}
