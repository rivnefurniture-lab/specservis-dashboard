import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { persistAnalyticsV2 } from "@/lib/analytics-v2-persist";
import { importProzorroAnalytics } from "@/lib/prozorro-analytics";
import type { ProzorroAnalyticsDataset } from "@/lib/analytics-v2-schema";
import { enrichSpendingPayments } from "@/lib/spending-enrichment";

type ImportRecord = { tender: unknown; contracting?: unknown; direction?: string | null };
type ImportBundle = {
  datasetId?: string;
  scope?: "monitoring" | "expanded";
  sourceName?: string;
  filters?: Record<string, unknown>;
  records?: ImportRecord[];
};

const inputPath = process.argv[2] || process.env.ANALYTICS_IMPORT_FILE;
if (!inputPath) throw new Error("Pass a JSON bundle path: npm run analytics:import -- ./bundle.json");
if (!process.env.DATABASE_URL?.trim()) throw new Error("DATABASE_URL is required");

const parsed = JSON.parse(await readFile(resolve(inputPath), "utf8")) as ImportBundle | ImportRecord[];
const bundle: ImportBundle = Array.isArray(parsed) ? { records: parsed } : parsed;
const records = bundle.records ?? [];
if (!records.length) throw new Error("Import bundle must contain at least one { tender, contracting? } record");

const importedAt = new Date().toISOString();
const datasets = records.map((record) => importProzorroAnalytics(record.tender, record.contracting ?? [], { importedAt }));
const merge = <T extends { id: string }>(rows: T[]) => [...new Map(rows.map((row) => [row.id, row])).values()];
const dataset: ProzorroAnalyticsDataset = {
  schemaVersion: "analytics-v2",
  importedAt,
  procurements: merge(datasets.flatMap((item) => item.procurements)),
  lots: merge(datasets.flatMap((item) => item.lots)),
  items: merge(datasets.flatMap((item) => item.items)),
  bids: merge(datasets.flatMap((item) => item.bids)),
  awards: merge(datasets.flatMap((item) => item.awards)),
  contracts: merge(datasets.flatMap((item) => item.contracts)),
  changes: merge(datasets.flatMap((item) => item.changes)),
  payments: merge(datasets.flatMap((item) => item.payments)),
  warnings: datasets.flatMap((item) => item.warnings),
};
const directions = Object.fromEntries(datasets.flatMap((item, index) => item.procurements.map((procurement) => [procurement.id, records[index]?.direction ?? null])));
const scope = bundle.scope ?? (process.env.ANALYTICS_SCOPE === "expanded" ? "expanded" : "monitoring");
const datasetId = bundle.datasetId ?? `analytics-v2-${scope}-${importedAt.slice(0, 10)}`;
const result = await persistAnalyticsV2(dataset, {
  datasetId,
  scope,
  sourceName: bundle.sourceName ?? "Official Prozorro API import",
  filters: bundle.filters,
  directions,
});
const spending = process.env.ANALYTICS_SPENDING === "true" ? await enrichSpendingPayments(dataset) : null;

console.log(JSON.stringify({ datasetId, scope, ...result, spending }, null, 2));
