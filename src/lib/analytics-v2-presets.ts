import "server-only";

import { randomUUID } from "node:crypto";
import { getAnalyticsSql } from "@/lib/analytics-v2-db";

export type AnalyticsFilterPreset = {
  id: string;
  name: string;
  schemaVersion: number;
  filters: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

type PresetRow = {
  id: string;
  name: string;
  schema_version: number;
  filters: Record<string, unknown>;
  created_at: string | Date;
  updated_at: string | Date;
};

function iso(value: string | Date) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapPreset(row: PresetRow): AnalyticsFilterPreset {
  return {
    id: row.id,
    name: row.name,
    schemaVersion: row.schema_version,
    filters: row.filters,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

export async function listAnalyticsPresets(ownerAccountId: string) {
  const sql = getAnalyticsSql();
  if (!sql) return null;
  const rows = await sql`
    select id, name, schema_version, filters, created_at, updated_at
    from analytics_filter_presets
    where owner_account_id = ${ownerAccountId}
    order by updated_at desc, name asc
  ` as PresetRow[];
  return rows.map(mapPreset);
}

export async function createAnalyticsPreset(ownerAccountId: string, name: string, filters: Record<string, unknown>) {
  const sql = getAnalyticsSql();
  if (!sql) return null;
  const id = randomUUID();
  const rows = await sql`
    insert into analytics_filter_presets (id, owner_account_id, name, filters)
    values (${id}, ${ownerAccountId}, ${name}, ${JSON.stringify(filters)}::jsonb)
    returning id, name, schema_version, filters, created_at, updated_at
  ` as PresetRow[];
  return mapPreset(rows[0]);
}

export async function updateAnalyticsPreset(ownerAccountId: string, id: string, name: string, filters: Record<string, unknown>) {
  const sql = getAnalyticsSql();
  if (!sql) return null;
  const rows = await sql`
    update analytics_filter_presets
    set name = ${name}, filters = ${JSON.stringify(filters)}::jsonb, updated_at = now()
    where id = ${id} and owner_account_id = ${ownerAccountId}
    returning id, name, schema_version, filters, created_at, updated_at
  ` as PresetRow[];
  return rows[0] ? mapPreset(rows[0]) : undefined;
}

export async function deleteAnalyticsPreset(ownerAccountId: string, id: string) {
  const sql = getAnalyticsSql();
  if (!sql) return null;
  const rows = await sql`
    delete from analytics_filter_presets
    where id = ${id} and owner_account_id = ${ownerAccountId}
    returning id
  ` as Array<{ id: string }>;
  return Boolean(rows[0]);
}
