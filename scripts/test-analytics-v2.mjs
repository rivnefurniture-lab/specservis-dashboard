import assert from "node:assert/strict";
import { buildAnalyticsV2 } from "../src/lib/analytics-v2-engine.ts";

const tenders = [
  { id: "T1", externalTenderId: "UA-1", prozorroUrl: "https://prozorro.gov.ua/tender/UA-1", title: "Competitive UAH", description: "School renovation", publishedAt: "2026-01-10", buyerId: "B1", buyerName: "Buyer One", procedureType: "open", status: "complete", category: "works", region: "Київська область", deliveryAddress: "Буча", expectedAmount: 100, ourStatus: "submitted", awardDataComplete: true, direct: false, direction: "build", cpv: "45450000" },
  { id: "T2", title: "Competitive USD", publishedAt: "2026-03-10", buyerId: "B2", buyerName: "Buyer Two", procedureType: "open", direct: false, direction: "service", cpv: "50730000" },
  { id: "T3", title: "Direct active", publishedAt: "2026-01-15", buyerId: "B1", buyerName: "Buyer One", procedureType: "direct", direct: true },
  { id: "T4", title: "Direct terminated", publishedAt: "2026-01-20", buyerId: "B1", buyerName: "Buyer One", procedureType: "direct", direct: true },
  { id: "T5", title: "Unknown amount", publishedAt: null, buyerId: "B3", buyerName: "Buyer Three", procedureType: "open", direct: false },
];

const lots = [
  { id: "L1", tenderId: "T1", title: "Lot one", expectedAmount: 100, expectedCurrency: "UAH" },
  { id: "L2", tenderId: "T2", title: "Lot two" },
  { id: "L3", tenderId: "T3", title: "Direct lot" },
  { id: "L5", tenderId: "T5", title: "Unknown lot" },
];

const bids = [
  // One company+lot participation: the last published revision is authoritative.
  { id: "BID-1-old", lotId: "L1", supplierId: "S1", supplierName: "Supplier One", publishedAt: "2026-01-11", amount: 100, currency: "uah" },
  { id: "BID-1-new", lotId: "L1", supplierId: "S1", supplierName: "Supplier One", publishedAt: "2026-01-12", amount: 90, currency: "UAH" },
  { id: "BID-2", lotId: "L1", supplierId: "S2", supplierName: "Supplier Two", publishedAt: "2026-01-11", amount: 85, currency: "UAH" },
  { id: "BID-3", lotId: "L2", supplierId: "S1", supplierName: "Supplier One", publishedAt: "2026-03-11", amount: 10, currency: "USD" },
  { id: "BID-4", lotId: "L2", supplierId: "S3", supplierName: "Supplier Three", publishedAt: "2026-03-11", amount: 12, currency: "USD" },
  { id: "BID-direct", lotId: "L3", supplierId: "S4", supplierName: "Direct Supplier", publishedAt: "2026-01-16", amount: 100, currency: "UAH" },
  { id: "BID-null", lotId: "L5", supplierId: "S5", supplierName: "Unknown Supplier", publishedAt: null, amount: null, currency: "UAH" },
];

const awards = [
  { id: "A1", lotId: "L1", supplierId: "S1", supplierName: "Supplier One", status: "active", date: "2026-01-20", amount: 88, currency: "UAH" },
  // Duplicate active award rows still represent one company+lot win.
  { id: "A1-copy", lotId: "L1", supplierId: "S1", supplierName: "Supplier One", status: "active", date: "2026-01-21", amount: 87, currency: "UAH" },
  { id: "A2-old-active", lotId: "L1", supplierId: "S2", supplierName: "Supplier Two", status: "active", date: "2026-01-19", amount: 96, currency: "UAH" },
  { id: "A-lost", lotId: "L1", supplierId: "S2", supplierName: "Supplier Two", status: "cancelled", date: "2026-01-20", amount: 95, currency: "UAH", rejectionReason: "Missing document" },
  { id: "A2", lotId: "L2", supplierId: "S1", supplierName: "Supplier One", status: "active", date: "2026-04-10", amount: 9, currency: "USD" },
  { id: "A-direct", lotId: "L3", supplierId: "S4", supplierName: "Direct Supplier", status: "active", date: "2026-01-17", amount: 100, currency: "UAH" },
  { id: "A5", lotId: "L5", supplierId: "S5", supplierName: "Unknown Supplier", status: "active", date: null, amount: null, currency: "UAH" },
];

const contracts = [
  { id: "C1", tenderId: "T1", lotId: "L1", supplierId: "S1", supplierName: "Supplier One", status: "active", signedAt: "2026-02-01", updatedAt: "2026-02-02", originalAmount: 88, currentAmount: 80, paidAmount: null, hasChanges: false, currency: "UAH" },
  // Same contract update: unique by contract id; the later state must win. Zero is known, not null.
  { id: "C1", tenderId: "T1", lotId: "L1", supplierId: "S1", supplierName: "Supplier One", status: "active", signedAt: "2026-02-01", updatedAt: "2026-02-03", originalAmount: 88, currentAmount: 75, paidAmount: 0, hasChanges: false, currency: "UAH" },
  { id: "C2", tenderId: "T2", lotId: "L2", supplierId: "S1", supplierName: "Supplier One", status: "terminated", signedAt: "2026-05-01", terminationType: "completed", originalAmount: 10, currentAmount: null, paidAmount: 8, currency: "USD" },
  { id: "C3", tenderId: "T3", lotId: "L3", supplierId: "S4", supplierName: "Direct Supplier", status: "active", signedAt: "2026-01-18", originalAmount: null, currentAmount: null, paidAmount: null, currency: "UAH" },
  { id: "C4", tenderId: "T4", lotId: null, supplierId: "S4", supplierName: "Direct Supplier", status: "terminated", signedAt: "2026-01-25", terminationType: "terminated", originalAmount: 50, currentAmount: 40, paidAmount: null, currency: "EUR" },
  { id: "C-state", tenderId: "T1", lotId: "L1", supplierId: "S1", supplierName: "Supplier One", status: "active", signedAt: "2026-01-22", updatedAt: "2026-01-23", originalAmount: 1, currentAmount: 1, paidAmount: 1, currency: "UAH" },
  { id: "C-state", tenderId: "T1", lotId: "L1", supplierId: "S1", supplierName: "Supplier One", status: "cancelled", signedAt: "2026-01-22", updatedAt: "2026-01-24", originalAmount: 1, currentAmount: 1, paidAmount: 1, currency: "UAH" },
  { id: "C-cancelled", tenderId: "T1", lotId: "L1", supplierId: "S1", supplierName: "Supplier One", status: "cancelled", signedAt: "2026-02-01", originalAmount: 1, currentAmount: 1, paidAmount: 1, currency: "UAH" },
];

const dataset = { tenders, lots, bids, awards, contracts };
const currency = (rows, code) => rows.find((row) => row.currency === code);

const january = buildAnalyticsV2(dataset, { from: "2026-01-01", to: "2026-01-31", dateLens: "publication" });
assert.equal(january.summary.tenders, 3);
assert.equal(january.summary.lots, 2);
assert.equal(january.summary.participations, 2, "direct bid must not be participation");
assert.equal(january.summary.wins, 1, "duplicate active awards and direct award must not inflate wins");
assert.equal(currency(january.summary.bidAmount, "UAH").value, 175, "last bid revision must replace the old amount");
assert.equal(january.summary.signedContracts, 3, "contract updates are unique and direct contracts remain contracts");
assert.equal(january.summary.competitiveContracts, 1);
assert.equal(january.summary.activeContracts, 2);
assert.equal(january.summary.terminatedContracts, 1);
assert.equal(january.summary.completedContracts, 0);
assert.equal(january.summary.earlyTerminatedContracts, 1);
assert.equal(january.summary.winRate, 0.5);
assert.equal(january.summary.contractConversion, 1);
assert.equal(january.summary.avgOtherBidders, 1);

assert.deepEqual(currency(january.summary.currentAmount, "UAH"), { currency: "UAH", value: 75, known: 1, total: 2 });
assert.deepEqual(currency(january.summary.paidAmount, "UAH"), { currency: "UAH", value: 0, known: 1, total: 2 });
assert.equal(currency(january.summary.currentAmount, "EUR").value, 40, "currencies must not be combined");
assert.equal(january.mainBuyersByCount[0].id, "B1");
assert.ok(january.matrix.some((row) => row.supplierId === "S4" && row.buyerId === "B1" && row.signedContracts === 2));
assert.ok(january.drilldown.some((row) => row.direct && !row.participation && row.contractIds.includes("C4")));

const supplierOnly = buildAnalyticsV2(dataset, {
  from: "2026-01-01", to: "2026-01-31", dateLens: "publication", supplierIds: ["S1"],
});
assert.equal(supplierOnly.summary.participations, 1);
assert.equal(supplierOnly.summary.avgOtherBidders, 1, "supplier filtering must not hide competing bidders");

const awardApril = buildAnalyticsV2(dataset, { from: "2026-04-01", to: "2026-04-30", dateLens: "award" });
assert.equal(awardApril.summary.tenders, 1);
assert.equal(awardApril.summary.lots, 1);
assert.equal(awardApril.summary.participations, 2);
assert.equal(awardApril.summary.wins, 1);
assert.equal(awardApril.summary.completedContracts, 1);
assert.equal(currency(awardApril.summary.currentAmount, "USD").value, null, "unknown amount is not zero");
assert.equal(currency(awardApril.summary.currentAmount, "USD").known, 0);

const contractJanuary = buildAnalyticsV2(dataset, { from: "2026-01-01", to: "2026-01-31", dateLens: "contract" });
assert.equal(contractJanuary.summary.tenders, 2);
assert.equal(contractJanuary.summary.participations, 0);
assert.equal(contractJanuary.summary.wins, 0);
assert.equal(contractJanuary.summary.signedContracts, 2);
assert.equal(contractJanuary.summary.contractConversion, null);

const allDates = buildAnalyticsV2(dataset);
assert.equal(allDates.summary.tenders, 5, "without a date range, null dates remain in the dataset");
assert.equal(allDates.summary.participations, 5);
assert.deepEqual(allDates.summary.bidAmount.map((row) => row.currency), ["UAH", "USD"]);
assert.equal(currency(allDates.summary.bidAmount, "UAH").known, 2);
assert.equal(currency(allDates.summary.bidAmount, "UAH").total, 3);

const advanced = buildAnalyticsV2(dataset, {
  from: "2026-01-01", to: "2026-01-31", dateLens: "publication",
  buyerIds: ["Buyer One"], supplierIds: ["Supplier One"], winnerSupplierIds: ["S1"],
  subjectQuery: "renovation", categories: ["works"], statuses: ["complete"],
  regions: ["Київська область"], addressQuery: "буча", expectedAmountMin: 90, expectedAmountMax: 110,
  minParticipants: 2, maxParticipants: 2, lowestRejected: true, contractPresence: true,
  paidPresence: false, changesPresence: false, ourStatuses: ["submitted"],
});
assert.equal(advanced.summary.tenders, 1, "all advanced procurement filters must be applied by the engine");
assert.equal(advanced.summary.participations, 1, "supplier name lookup must preserve other bidders for competition metrics");
assert.equal(advanced.summary.avgOtherBidders, 1);
assert.equal(advanced.drilldown[0].externalTenderId, "UA-1");
assert.equal(advanced.drilldown[0].participantCount, 2);
assert.equal(advanced.drilldown[0].lotParticipants.length, 2);

// Canonical schema adapter preserves source nulls and independent currencies.
const provenance = { source: "prozorro-tender", sourceId: "x", sourcePath: "test", fetchedAt: null };
const confidence = { level: "source", score: 1, basis: "test" };
const sv = (value) => ({ value, sourceState: value === null ? "source-null" : "value", provenance, confidence });
const canonicalSupplier = { id: "party-s", name: "Canonical Supplier", identifier: { scheme: "UA-EDR", id: "123", legalName: "Canonical Supplier LLC" } };
const canonicalBuyer = { id: "party-b", name: "Canonical Buyer", identifier: { scheme: "UA-EDR", id: "456", legalName: "Canonical Buyer Org" } };
const canonical = {
  schemaVersion: "analytics-v2",
  importedAt: "2026-06-01",
  procurements: [{
    id: "P1", tenderId: "UA-1", status: sv("complete"), procurementMethod: sv("open"), procurementMethodType: sv("aboveThresholdUA"),
    mainProcurementCategory: sv("services"),
    title: sv("Canonical tender"), description: sv(null), value: sv({ amount: 100, amountNet: null, currency: "UAH", valueAddedTaxIncluded: true }),
    datePublished: sv("2026-01-01"), dateModified: sv("2026-05-01"), buyer: sv(canonicalBuyer),
    lotIds: ["ROOT"], itemIds: [], bidIds: ["B1"], awardIds: ["A1"], contractIds: ["C1"], provenance: [provenance], confidence,
  }],
  lots: [{
    id: "ROOT", procurementId: "P1", sourceLotId: null, kind: "root-lot", title: sv("Root lot"), description: sv(null), status: sv("active"),
    value: sv({ amount: 100, amountNet: null, currency: "UAH", valueAddedTaxIncluded: true }), itemIds: [], bidIds: ["B1"], awardIds: ["A1"], provenance: [provenance], confidence,
  }],
  items: [],
  bids: [{
    id: "B1", procurementId: "P1", sourceBidId: "bid", status: sv("active"), date: sv("2026-01-02"), tenderers: [canonicalSupplier], lotIds: ["ROOT"],
    lotValues: [{ lotId: "ROOT", value: sv({ amount: 95, amountNet: null, currency: "UAH", valueAddedTaxIncluded: true }) }],
    value: sv({ amount: 95, amountNet: null, currency: "UAH", valueAddedTaxIncluded: true }), awardIds: ["A1"], provenance: [provenance], confidence,
  }],
  awards: [{
    id: "A1", procurementId: "P1", sourceAwardId: "award", lotId: "ROOT", bidId: "B1", status: sv("active"), date: sv("2026-01-03"),
    value: sv({ amount: 90, amountNet: null, currency: "UAH", valueAddedTaxIncluded: true }), suppliers: [canonicalSupplier], qualified: sv(true), eligible: sv(true),
    disqualificationReason: sv(null), contractIds: ["C1"], provenance: [provenance], confidence,
  }],
  contracts: [{
    id: "C1", procurementId: "P1", sourceContractId: "contract", contractNumber: sv("1"), awardId: "A1", lotId: "ROOT", status: sv("terminated"),
    dateSigned: sv("2026-01-04"), period: sv({ startDate: "2026-01-04", endDate: "2026-05-01" }),
    value: sv({ amount: 8, amountNet: null, currency: "USD", valueAddedTaxIncluded: false }),
    amountPaid: sv({ amount: 0, amountNet: null, currency: "USD", valueAddedTaxIncluded: false }), terminationDetails: sv("Contract completed"),
    suppliers: [canonicalSupplier], changeIds: [], paymentIds: [], provenance: [provenance], confidence,
  }],
  changes: [], payments: [], warnings: [],
};
const canonicalResult = buildAnalyticsV2(canonical);
assert.equal(canonicalResult.summary.participations, 1);
assert.equal(canonicalResult.summary.wins, 1);
assert.equal(canonicalResult.summary.signedContracts, 1);
assert.equal(canonicalResult.summary.completedContracts, 1);
assert.deepEqual(currency(canonicalResult.summary.originalAmount, "USD"), { currency: "USD", value: null, known: 0, total: 1 }, "award value must not be invented as original contract amount");
assert.equal(currency(canonicalResult.summary.currentAmount, "USD").value, 8);
assert.equal(currency(canonicalResult.summary.paidAmount, "USD").value, 0);
assert.equal(canonicalResult.suppliers[0].id, "UA-EDR:123");

console.log("analytics v2 engine: date lenses, uniqueness, direct contracts, nulls and currencies passed");
