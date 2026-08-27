import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import {
  buildTenderDigest,
  buildTenderWorkbook,
  parseTenderSubscriptions,
  tenderMatchesFilters,
} from "../src/lib/tender-integrations";

const subscriptions = parseTenderSubscriptions(JSON.stringify([
  {
    id: "climate",
    name: "Кондиціонування",
    recipients: ["tender@example.com", "not-an-email"],
    filters: { directions: ["Кондиціонування"], cpvPrefixes: ["4251"] },
  },
  { id: "invalid", name: "Без адресата", recipients: [] },
]));
assert.equal(subscriptions.length, 1);
assert.deepEqual(subscriptions[0].recipients, ["tender@example.com"]);

const event: Parameters<typeof tenderMatchesFilters>[0] = {
  id: "procurement-1",
  tenderId: "UA-2026-08-25-000001-a",
  title: "Кондиціонер інверторний",
  buyerId: "UA-EDR:12345678",
  buyerName: "Тестовий замовник",
  department: "Кондиціонування",
  cpvCode: "42512000-8",
  procedureType: "aboveThresholdUA",
  status: "active.tendering",
  category: "goods",
  region: "м. Київ",
  expectedAmount: 250000,
  currency: "UAH",
  publishedAt: "2026-08-25T06:00:00.000Z",
  modifiedAt: "2026-08-25T07:00:00.000Z",
  submissionEndAt: "2026-08-30T15:00:00.000Z",
  prozorroUrl: "https://prozorro.gov.ua/tender/UA-2026-08-25-000001-a",
};
assert.equal(tenderMatchesFilters(event, subscriptions[0].filters), true);
assert.equal(tenderMatchesFilters(event, { directions: ["Сервіс"] }), false);
assert.equal(tenderMatchesFilters(event, { cpvPrefixes: ["4533"] }), false);
const digest = buildTenderDigest(subscriptions[0], [event]);
assert.match(digest.text, /UA-2026-08-25-000001-a/);
assert.match(digest.html, /Кондиціонер інверторний/);

const workbookBuffer = await buildTenderWorkbook(Buffer.alloc(0), {
  worksheet: "Тендери",
  table: "TenderExport",
}, [{
  tender_id: event.tenderId,
  title: event.title,
  buyer_name: event.buyerName,
  department: event.department,
  cpv_code: event.cpvCode,
  procurement_method_type: event.procedureType,
  status: event.status,
  region: event.region,
  expected_amount: event.expectedAmount,
  expected_currency: event.currency,
  published_at: event.publishedAt,
  submission_end_at: event.submissionEndAt,
  source_modified_at: event.modifiedAt,
  prozorro_url: event.prozorroUrl,
}]);
const workbook = new ExcelJS.Workbook();
await workbook.xlsx.load(workbookBuffer as unknown as ExcelJS.Buffer);
const sheet = workbook.getWorksheet("Тендери");
assert.ok(sheet);
assert.equal(sheet.getRow(2).getCell(1).value, event.tenderId);
assert.ok(sheet.getTable("TenderExport"));

const refreshedBuffer = await buildTenderWorkbook(workbookBuffer, {
  worksheet: "Тендери",
  table: "TenderExport",
}, []);
const refreshed = new ExcelJS.Workbook();
await refreshed.xlsx.load(refreshedBuffer as unknown as ExcelJS.Buffer);
const refreshedSheet = refreshed.getWorksheet("Тендери");
assert.ok(refreshedSheet?.getTable("TenderExport"));
assert.equal(refreshedSheet?.getRow(2).getCell(1).value ?? null, null);

console.log("Tender integration tests passed");
