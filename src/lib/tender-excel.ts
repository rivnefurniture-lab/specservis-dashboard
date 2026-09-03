import "server-only";

import ExcelJS from "exceljs";
import type { MonitoringV2Row } from "@/lib/monitoring-v2-types";
import type { AnalyticsV2Result } from "@/lib/analytics-v2-engine";

const headerFill = "272273";
const headerFont = { bold: true, color: { argb: "FFFFFFFF" } };

function finishSheet(sheet: ExcelJS.Worksheet) {
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columnCount } };
  sheet.getRow(1).eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: headerFill } };
    cell.font = headerFont;
    cell.alignment = { vertical: "middle", wrapText: true };
  });
  sheet.eachRow((row, index) => {
    row.alignment = { vertical: "top", wrapText: true };
    if (index > 1 && index % 2 === 0) {
      row.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF7F7FB" } }; });
    }
  });
}

async function buffer(workbook: ExcelJS.Workbook) {
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function dateCell(value: unknown) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return typeof value === "string" ? value.slice(0, 10) : "";
}

export async function monitoringWorkbook(rows: MonitoringV2Row[]) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Specservis";
  const sheet = workbook.addWorksheet("Моніторинг");
  sheet.columns = [
    { header: "Закупівля", key: "tender", width: 22 },
    { header: "Лот", key: "lot", width: 22 },
    { header: "Предмет", key: "title", width: 48 },
    { header: "Напрям", key: "direction", width: 28 },
    { header: "Опубліковано", key: "published", width: 15 },
    { header: "Дедлайн", key: "deadline", width: 15 },
    { header: "Замовник", key: "buyer", width: 34 },
    { header: "ЄДРПОУ", key: "buyerCode", width: 14 },
    { header: "ДК 021:2015", key: "cpv", width: 22 },
    { header: "Причина відбору", key: "reason", width: 36 },
    { header: "Точність", key: "confidence", width: 14 },
    { header: "Очікувана сума", key: "amount", width: 18 },
    { header: "Валюта", key: "currency", width: 10 },
    { header: "Статус", key: "status", width: 20 },
    { header: "Коментар", key: "comment", width: 36 },
    { header: "Prozorro", key: "url", width: 48 },
  ];
  for (const row of rows) sheet.addRow({
    tender: row.tenderId,
    lot: row.lotId,
    title: row.title,
    direction: row.directions.map((item) => item.label).join(", "),
    published: dateCell(row.publishedAt),
    deadline: dateCell(row.deadlineAt),
    buyer: row.buyerName,
    buyerCode: row.buyerCode ?? "",
    cpv: row.cpvCodes.join(", "),
    reason: row.matchedTerms.join(", ") || row.reasons.map((item) => item.value || item.label).filter(Boolean).join(", "),
    confidence: row.confidence,
    amount: row.expectedAmount,
    currency: row.currency ?? "",
    status: row.status ?? "",
    comment: row.reviewComment ?? "",
    url: row.prozorroUrl,
  });
  sheet.getColumn("amount").numFmt = "#,##0.00";
  finishSheet(sheet);
  return buffer(workbook);
}

export async function analyticsWorkbook(result: AnalyticsV2Result) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Specservis";
  const sheet = workbook.addWorksheet("Аналітика");
  sheet.columns = [
    { header: "Закупівля", key: "tender", width: 22 },
    { header: "Лот", key: "lot", width: 22 },
    { header: "Предмет", key: "title", width: 46 },
    { header: "Дата", key: "date", width: 15 },
    { header: "Замовник", key: "buyer", width: 34 },
    { header: "Постачальник", key: "supplier", width: 34 },
    { header: "Учасників", key: "participants", width: 12 },
    { header: "Пропозиція", key: "bid", width: 16 },
    { header: "Перемога", key: "won", width: 12 },
    { header: "Сума перемоги", key: "award", width: 17 },
    { header: "Сума договору", key: "contract", width: 17 },
    { header: "Статус договору", key: "contractStatus", width: 22 },
    { header: "Prozorro", key: "url", width: 48 },
  ];
  for (const row of result.drilldown) sheet.addRow({
    tender: row.externalTenderId || row.tenderId,
    lot: row.lotId ?? "",
    title: row.lotTitle || row.tenderTitle,
    date: dateCell(row.publishedAt || row.awardDate || row.contractDate),
    buyer: row.buyerName,
    supplier: row.supplierName,
    participants: row.participantCount,
    bid: row.bid?.amount ?? null,
    won: row.won ? "Так" : "Ні",
    award: row.award?.amount ?? null,
    contract: row.currentAmount.length === 1 ? row.currentAmount[0].value : null,
    contractStatus: row.contractStatuses.join(", "),
    url: row.prozorroUrl ?? "",
  });
  for (const key of ["bid", "award", "contract"]) sheet.getColumn(key).numFmt = "#,##0.00";
  finishSheet(sheet);
  return buffer(workbook);
}
