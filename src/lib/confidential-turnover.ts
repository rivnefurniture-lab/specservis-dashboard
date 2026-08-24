import "server-only";

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getAnalyticsSql } from "@/lib/analytics-v2-db";

const fields = [
  "promtechGross", "promtechCore", "refkeyBank", "specservisBank", "fopNaryshkov", "fopPashkov",
  "fopDanilenko", "refkeyCash", "specservisCash", "baseTurnover", "fte", "payroll",
  "sourceTurnoverPerFte", "cocaColaPromtech", "cocaColaSpecservis", "abinbev",
] as const;

export type ConfidentialTurnoverRecord = {
  period: string;
  sourceRow: number;
} & Record<(typeof fields)[number], number | null>;

export type ConfidentialTurnoverPayload = {
  schemaVersion: number;
  source: {
    fileName: string;
    sha256: string;
    modifiedAt: string;
    importedAt: string;
    sheetName: string;
  };
  records: ConfidentialTurnoverRecord[];
  warnings: Array<{ code: string; sourceRow: number; period: string }>;
};

export type ConfidentialTurnoverDataset = ConfidentialTurnoverPayload & {
  source: ConfidentialTurnoverPayload["source"] & { rowCount: number };
};

let schemaPromise: Promise<void> | null = null;

function ensureConfidentialTurnoverSchema() {
  if (schemaPromise) return schemaPromise;
  schemaPromise = (async () => {
    const sql = getAnalyticsSql();
    if (!sql) throw new Error("DATABASE_URL is required");
    const migration = await readFile(resolve(process.cwd(), "db/confidential-turnover.sql"), "utf8");
    const statements = migration.split(/;\s*(?:\n|$)/).map((statement) => statement.trim()).filter(Boolean);
    for (const statement of statements) await sql.query(statement, []);
  })().catch((error) => {
    schemaPromise = null;
    throw error;
  });
  return schemaPromise;
}

function date(value: unknown, label: string) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new Error(`${label} must be an ISO date`);
  return value;
}

function numeric(value: unknown, label: string) {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > 1_000_000_000_000) {
    throw new Error(`${label} must be a finite number or null`);
  }
  return value;
}

function validateConfidentialTurnoverPayload(input: unknown): ConfidentialTurnoverPayload {
  if (!input || typeof input !== "object") throw new Error("Payload must be an object");
  const raw = input as Partial<ConfidentialTurnoverPayload>;
  if (raw.schemaVersion !== 1 || !raw.source || !Array.isArray(raw.records) || !Array.isArray(raw.warnings)) {
    throw new Error("Unsupported confidential turnover payload");
  }
  if (!raw.records.length || raw.records.length > 1_000) throw new Error("Unexpected monthly record count");
  const fileName = String(raw.source.fileName ?? "").trim();
  const sha256 = String(raw.source.sha256 ?? "").trim().toLowerCase();
  const sheetName = String(raw.source.sheetName ?? "").trim();
  if (!fileName || fileName.length > 180 || !sheetName || sheetName.length > 120 || !/^[0-9a-f]{64}$/.test(sha256)) {
    throw new Error("Invalid source metadata");
  }
  const seen = new Set<string>();
  const records = raw.records.map((record, index) => {
    if (!record || typeof record !== "object" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(record.period)) throw new Error(`Invalid period at record ${index + 1}`);
    if (seen.has(record.period)) throw new Error(`Duplicate period ${record.period}`);
    seen.add(record.period);
    if (!Number.isSafeInteger(record.sourceRow) || record.sourceRow < 1) throw new Error(`Invalid source row for ${record.period}`);
    const normalized = { period: record.period, sourceRow: record.sourceRow } as ConfidentialTurnoverRecord;
    for (const field of fields) normalized[field] = numeric(record[field], `${record.period}.${field}`);
    return normalized;
  }).sort((a, b) => a.period.localeCompare(b.period));
  const warnings = raw.warnings.slice(0, 1_000).map((warning) => ({
    code: String(warning.code ?? "unknown").slice(0, 80),
    sourceRow: Number.isSafeInteger(warning.sourceRow) ? warning.sourceRow : 0,
    period: /^\d{4}-(0[1-9]|1[0-2])$/.test(warning.period ?? "") ? warning.period : "unknown",
  }));
  return {
    schemaVersion: 1,
    source: {
      fileName,
      sha256,
      modifiedAt: date(raw.source.modifiedAt, "source.modifiedAt"),
      importedAt: date(raw.source.importedAt, "source.importedAt"),
      sheetName,
    },
    records,
    warnings,
  };
}

export async function importConfidentialTurnover(input: unknown) {
  const payload = validateConfidentialTurnoverPayload(input);
  await ensureConfidentialTurnoverSchema();
  const sql = getAnalyticsSql();
  if (!sql) throw new Error("DATABASE_URL is required");
  const sourceId = `turnover:${payload.source.sha256}`;
  const existing = await sql`select status, row_count from confidential.turnover_sources where id = ${sourceId}` as unknown as Array<{ status: string; row_count: number }>;
  if (existing[0]?.status === "ready" && Number(existing[0].row_count) === payload.records.length) {
    await sql`
      insert into confidential.settings (key, source_id) values ('active-turnover', ${sourceId})
      on conflict (key) do update set source_id = excluded.source_id, updated_at = now()
    `;
    return { sourceId, imported: 0, total: payload.records.length, unchanged: true };
  }
  await sql`
    insert into confidential.turnover_sources (id, schema_version, source_filename, source_sha256, source_modified_at,
      imported_at, sheet_name, row_count, warnings, status, updated_at)
    values (${sourceId}, ${payload.schemaVersion}, ${payload.source.fileName}, ${payload.source.sha256}, ${payload.source.modifiedAt},
      ${payload.source.importedAt}, ${payload.source.sheetName}, ${payload.records.length}, ${JSON.stringify(payload.warnings)}::jsonb, 'building', now())
    on conflict (id) do update set source_modified_at = excluded.source_modified_at, imported_at = excluded.imported_at,
      row_count = excluded.row_count, warnings = excluded.warnings, status = 'building', updated_at = now()
  `;
  await sql`delete from confidential.turnover_months where source_id = ${sourceId}`;
  try {
    for (const record of payload.records) {
      await sql`
        insert into confidential.turnover_months (source_id, period, source_row, promtech_gross, promtech_core,
          refkey_bank, specservis_bank, fop_naryshkov, fop_pashkov, fop_danilenko, refkey_cash, specservis_cash,
          base_turnover, fte, payroll, source_turnover_per_fte, coca_cola_promtech, coca_cola_specservis, abinbev)
        values (${sourceId}, ${`${record.period}-01`}, ${record.sourceRow}, ${record.promtechGross}, ${record.promtechCore},
          ${record.refkeyBank}, ${record.specservisBank}, ${record.fopNaryshkov}, ${record.fopPashkov}, ${record.fopDanilenko},
          ${record.refkeyCash}, ${record.specservisCash}, ${record.baseTurnover}, ${record.fte}, ${record.payroll},
          ${record.sourceTurnoverPerFte}, ${record.cocaColaPromtech}, ${record.cocaColaSpecservis}, ${record.abinbev})
      `;
    }
    const counted = await sql`select count(*)::integer as count from confidential.turnover_months where source_id = ${sourceId}` as unknown as Array<{ count: number }>;
    if (Number(counted[0]?.count) !== payload.records.length) throw new Error("Confidential import row count mismatch");
    await sql`update confidential.turnover_sources set status = 'ready', updated_at = now() where id = ${sourceId}`;
    await sql`
      insert into confidential.settings (key, source_id) values ('active-turnover', ${sourceId})
      on conflict (key) do update set source_id = excluded.source_id, updated_at = now()
    `;
    return { sourceId, imported: payload.records.length, total: payload.records.length, unchanged: false };
  } catch (error) {
    await sql`update confidential.turnover_sources set status = 'failed', updated_at = now() where id = ${sourceId}`;
    throw error;
  }
}

type SourceRow = {
  schema_version: number;
  source_filename: string;
  source_sha256: string;
  source_modified_at: string | Date;
  imported_at: string | Date;
  sheet_name: string;
  row_count: number;
  warnings: ConfidentialTurnoverPayload["warnings"];
};

type MonthRow = Record<string, string | number | null | Date> & { period: Date | string; source_row: number };

function iso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function decimal(value: string | number | null | Date) {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function loadConfidentialTurnover(): Promise<ConfidentialTurnoverDataset | null> {
  const sql = getAnalyticsSql();
  if (!sql) return null;
  const sources = await sql`
    select s.schema_version, s.source_filename, s.source_sha256, s.source_modified_at, s.imported_at,
      s.sheet_name, s.row_count, s.warnings
    from confidential.settings x join confidential.turnover_sources s on s.id = x.source_id
    where x.key = 'active-turnover' and s.status = 'ready'
  ` as unknown as SourceRow[];
  const source = sources[0];
  if (!source) return null;
  const rows = await sql`
    select m.* from confidential.turnover_months m
    join confidential.settings x on x.source_id = m.source_id
    where x.key = 'active-turnover' order by m.period
  ` as unknown as MonthRow[];
  const records = rows.map((row) => ({
    period: iso(row.period).slice(0, 7),
    sourceRow: Number(row.source_row),
    promtechGross: decimal(row.promtech_gross), promtechCore: decimal(row.promtech_core),
    refkeyBank: decimal(row.refkey_bank), specservisBank: decimal(row.specservis_bank),
    fopNaryshkov: decimal(row.fop_naryshkov), fopPashkov: decimal(row.fop_pashkov),
    fopDanilenko: decimal(row.fop_danilenko), refkeyCash: decimal(row.refkey_cash),
    specservisCash: decimal(row.specservis_cash), baseTurnover: decimal(row.base_turnover),
    fte: decimal(row.fte), payroll: decimal(row.payroll), sourceTurnoverPerFte: decimal(row.source_turnover_per_fte),
    cocaColaPromtech: decimal(row.coca_cola_promtech), cocaColaSpecservis: decimal(row.coca_cola_specservis),
    abinbev: decimal(row.abinbev),
  }));
  return {
    schemaVersion: source.schema_version,
    source: {
      fileName: source.source_filename,
      sha256: source.source_sha256,
      modifiedAt: iso(source.source_modified_at),
      importedAt: iso(source.imported_at),
      sheetName: source.sheet_name,
      rowCount: Number(source.row_count),
    },
    records,
    warnings: source.warnings,
  };
}
