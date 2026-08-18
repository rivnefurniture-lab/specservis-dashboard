// @ts-check

import ExcelJS from "exceljs";
import { summarizeInternalTenders } from "./internal-summary.mjs";
import { resolveReason, resolveStatus } from "./workbook-dictionary.mjs";

/** @typedef {import("./types").Direction} Direction */
/** @typedef {import("./types").InternalSnapshot} InternalSnapshot */

/** @param {unknown} value @returns {string} */
function compact(value) {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    const record = /** @type {Record<string, unknown>} */ (value);
    if (record.text != null) return compact(record.text);
    if (record.result != null) return compact(record.result);
    if (Array.isArray(record.richText)) {
      return record.richText.map((part) => compact(part)).join("");
    }
  }
  return String(value).replace(/\s+/g, " ").trim();
}

/** @param {unknown} value */
function number(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const normalized = compact(value).replace(/\s/g, "").replace(",", ".").replace(/[^\d.-]/g, "");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

/** @param {unknown} value */
function isoDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === "number" && Number.isFinite(value)) {
    const epoch = Date.UTC(1899, 11, 30);
    return new Date(epoch + value * 86_400_000).toISOString().slice(0, 10);
  }
  const stringValue = compact(value);
  const dotted = stringValue.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (dotted) return `${dotted[3]}-${dotted[2]}-${dotted[1]}`;
  const iso = stringValue.match(/(\d{4})-(\d{2})-(\d{2})/);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
}

/**
 * Напрямок береться з походження файлу, а не з тексту назви закупівлі.
 * «закупівлі.xlsx» — реєстр капітального будівництва, тому кожен його рядок
 * належить капбудівництву, навіть якщо в назві є слово «вентиляція» чи
 * «технічне обслуговування». Коли команда підключить окремі файли сервісу та
 * кондиціонування, кожен із них будується зі своїм `registryDirection`.
 *
 * @param {Buffer} buffer
 * @param {{exportedAt: string, source?: string, registryDirection?: Exclude<Direction, "Інше">}} options
 * @returns {Promise<InternalSnapshot>}
 */
export async function parseInternalWorkbook(buffer, options) {
  const registryDirection = options.registryDirection ?? "Капбудівництво";
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(/** @type {any} */ (buffer));
  const sheet = workbook.getWorksheet("Sheet1") ?? workbook.worksheets[0];
  if (!sheet) throw new Error("SharePoint workbook has no worksheets");

  /** @type {InternalSnapshot["tenders"]} */
  const tenders = [];
  for (let rowNumber = 5; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const id = number(row.getCell(2).value);
    const title = compact(row.getCell(4).value);
    if (!id || !title) continue;
    const qualification = compact(row.getCell(8).value);
    const estimateNotes = compact(row.getCell(9).value);
    const decision = compact(row.getCell(10).value);
    const comment = compact(row.getCell(11).value);
    const status = resolveStatus(row.getCell(12).value);
    const reason = resolveReason(comment);
    tenders.push({
      id,
      deadline: isoDate(row.getCell(3).value),
      title,
      buyer: compact(row.getCell(5).value),
      buyerEdrpou: compact(row.getCell(6).value),
      value: number(row.getCell(7).value) ?? 0,
      qualification,
      estimateNotes,
      decision,
      comment,
      status: status.label,
      statusCode: status.code,
      statusGroup: status.group,
      ourOffer: number(row.getCell(13).value),
      auctionOffer: number(row.getCell(14).value),
      winnerValue: number(row.getCell(15).value),
      participants: [16, 17, 18, 19].map((column) => compact(row.getCell(column).value)).filter(Boolean),
      direction: registryDirection,
      reason: reason.label,
      reasonCode: reason.code,
    });
  }

  return {
    exportedAt: options.exportedAt,
    source: options.source ?? "SharePoint · закупівлі.xlsx",
    registry: {
      direction: registryDirection,
      note: `Цей файл — реєстр напрямку «${registryDirection}». Інші напрямки в ньому не ведуться.`,
    },
    summary: summarizeInternalTenders(tenders),
    tenders,
  };
}
