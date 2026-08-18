import "server-only";

import ExcelJS from "exceljs";
import { analyticsDatabaseConfigured } from "@/lib/analytics-v2-db";
import { importTenderWorkbookRows, type TenderWorkbookImportRow } from "@/lib/tender-workspace-store";
import type { TenderParticipationDecision, TenderWorkbookFields, TenderWorkflowStatus } from "@/lib/tender-workspace";

type CellLike = { value: unknown; formula?: string };

function cellText(cell: CellLike) {
  const value = cell.value;
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value).trim();
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    if (typeof object.text === "string") return object.text.trim();
    if (typeof object.result === "string" || typeof object.result === "number") return String(object.result).trim();
    if (Array.isArray(object.richText)) return object.richText.map((part) => typeof part === "object" && part && "text" in part ? String(part.text) : "").join("").trim();
  }
  return "";
}

function hyperlink(cell: CellLike) {
  const value = cell.value;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    if (typeof object.hyperlink === "string") return { url: object.hyperlink, label: typeof object.text === "string" ? object.text : "" };
  }
  const formula = cell.formula || (value && typeof value === "object" && "formula" in value ? String((value as { formula?: unknown }).formula ?? "") : "");
  const match = formula.match(/HYPERLINK\("([^"]+)"\s*[;,]\s*"([^"]*)"\)/i);
  return { url: match?.[1] ?? "", label: match?.[2] ?? cellText(cell) };
}

function workflowFrom(action: string, participation: string): {
  decision: TenderParticipationDecision;
  status: TenderWorkflowStatus;
  decisionReason: string | null;
  actionNote: string | null;
} {
  const combined = `${participation} ${action}`.trim();
  const normalized = combined.toLocaleLowerCase("uk-UA");
  if (/не\s+(йдемо|беремо|прийма)|не\s+(цікаво|цікавить|наше|підход)|відмов/.test(normalized)) {
    return { decision: "skip", status: "closed", decisionReason: combined || null, actionNote: null };
  }
  if (/прийма.{0,12}участ|беремо\s+участь|пода(ємо|ли|на)|участь\s+сс/.test(normalized)) {
    return { decision: "participate", status: "preparing", decisionReason: null, actionNote: combined || null };
  }
  return combined
    ? { decision: "undecided", status: "review", decisionReason: null, actionNote: combined }
    : { decision: "undecided", status: "new", decisionReason: null, actionNote: null };
}

const source = process.argv[2];
if (!source) throw new Error("Usage: npm run workspace:import -- /absolute/path/workbook.xlsx");

const workbook = new ExcelJS.Workbook();
await workbook.xlsx.readFile(source);
const sheet = workbook.getWorksheet("Звіт") ?? workbook.worksheets[0];
if (!sheet) throw new Error("Workbook has no worksheets");

const importRows: TenderWorkbookImportRow[] = [];
for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
  const row = sheet.getRow(rowNumber);
  const prozorro = hyperlink(row.getCell(2));
  const tenderId = prozorro.label.match(/UA-\d{4}-\d{2}-\d{2}-\d{6}-[a-z]/i)?.[0]
    ?? prozorro.url.match(/UA-\d{4}-\d{2}-\d{2}-\d{6}-[a-z]/i)?.[0]
    ?? "";
  if (!tenderId) continue;
  const smartTender = hyperlink(row.getCell(1));
  const value = (column: number) => cellText(row.getCell(column));
  const fields: TenderWorkbookFields = {
    smartTenderId: smartTender.label, smartTenderUrl: smartTender.url,
    prozorroId: tenderId, prozorroUrl: prozorro.url,
    organizer: value(3), parentOrganization: value(4), buyerEdrpou: value(5), region: value(6), city: value(7),
    subject: value(8), procedure: value(9), classification: value(10), description: value(11), deliveryPlace: value(12),
    deliveryDeadline: value(13), expectedAmount: value(14), guarantee: value(15), submissionDeadline: value(16), auctionAt: value(17),
    tenderAction: value(18), unit: value(19), quantity: value(20), unitPrice: value(21), paymentPeriod: value(22),
    republished: value(23), previousProcurement: value(24), participation: value(25), urgencyNotice: value(26), changes: value(27),
    questionsComplaints: value(28), monitoringStatus: value(29), lowestBid: value(30), qualificationDay: value(31), winner: value(32),
    contract: value(33), manager: value(34),
  };
  for (const [key, raw] of Object.entries(fields)) if (!raw) delete fields[key as keyof TenderWorkbookFields];
  const state = workflowFrom(fields.tenderAction ?? "", fields.participation ?? "");
  importRows.push({ tenderId, fields, decision: state.decision, status: state.status, decisionReason: state.decisionReason, actionNote: state.actionNote });
}

if (analyticsDatabaseConfigured()) {
  console.log(JSON.stringify(await importTenderWorkbookRows(importRows), null, 2));
} else {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) throw new Error("CRON_SECRET is required for the protected production import");
  const origin = process.env.WORKSPACE_IMPORT_ORIGIN?.trim() || "https://specservis-intelligence.vercel.app";
  const response = await fetch(new URL("/api/tender-workspace/import", origin), {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({ rows: importRows }),
  });
  const result = await response.text();
  if (!response.ok) throw new Error(`Protected workbook import failed (${response.status}): ${result.slice(0, 500)}`);
  console.log(result);
}
