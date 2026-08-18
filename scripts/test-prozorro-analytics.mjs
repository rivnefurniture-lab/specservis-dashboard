import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const fixtureRoot = join(tmpdir(), `specservis-analytics-v2-${process.pid}-${Date.now()}`);
await mkdir(fixtureRoot, { recursive: true });

async function loadImporter() {
  const sourceUrl = new URL("../src/lib/prozorro-analytics.ts", import.meta.url);
  const source = await (await import("node:fs/promises")).readFile(sourceUrl, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true,
    },
    fileName: "prozorro-analytics.ts",
  });
  const output = join(fixtureRoot, "prozorro-analytics.mjs");
  await writeFile(output, compiled.outputText);
  return import(pathToFileURL(output).href);
}

const { importProzorroAnalytics, prozorroAnalyticsSchemaVersion } = await loadImporter();
const options = {
  importedAt: "2026-08-12T12:00:00.000Z",
  tenderFetchedAt: "2026-08-12T11:58:00.000Z",
  contractingFetchedAt: "2026-08-12T11:59:00.000Z",
};

const party = (id, name) => ({ name, identifier: { scheme: "UA-EDR", id, legalName: name } });
const value = (amount) => ({ amount, currency: "UAH", valueAddedTaxIncluded: true });

try {
  const multilotTender = {
    data: {
      id: "multi-1",
      tenderID: "UA-2026-08-01-000001-a",
      title: "Два лоти",
      description: null,
      status: "active.awarded",
      procurementMethod: "open",
      procurementMethodType: "aboveThresholdUA",
      mainProcurementCategory: "works",
      date: "2026-08-01T09:15:00+03:00",
      value: value(300_000),
      lots: [
        { id: "lot-a", title: "Лот A", value: value(100_000), status: "active" },
        { id: "lot-b", title: "Лот B", value: value(200_000), status: "active" },
      ],
      items: [
        { id: "item-a", relatedLot: "lot-a", description: "Роботи A", quantity: 1, unit: { code: "E50" }, classification: { scheme: "ДК021", id: "45000000-7" } },
        { id: "item-b", relatedLot: "lot-b", description: "Роботи B", quantity: 2, unit: { code: "E50" }, classification: { scheme: "ДК021", id: "45300000-0" } },
      ],
      bids: [{
        id: "bid-1",
        status: "active",
        tenderers: [party("11111111", "Учасник")],
        lotValues: [
          { relatedLot: "lot-a", value: value(90_000) },
          { relatedLot: "lot-b", value: value(180_000) },
        ],
      }],
      awards: [
        { id: "award-a", bid_id: "bid-1", lotID: "lot-a", status: "active", value: value(90_000), suppliers: [party("11111111", "Учасник")] },
        { id: "award-b", bid_id: "bid-1", lotID: "lot-b", status: "active", value: value(180_000), suppliers: [party("11111111", "Учасник")] },
      ],
    },
  };
  const multilot = importProzorroAnalytics(multilotTender, [], options);
  assert.equal(multilot.schemaVersion, "analytics-v2");
  assert.equal(prozorroAnalyticsSchemaVersion, "analytics-v2");
  assert.equal(multilot.lots.length, 2, "source multilot must not get a synthetic root lot");
  assert.equal(multilot.items.find((item) => item.sourceItemId === "item-a")?.lotId, "multi-1:lot:lot-a");
  assert.deepEqual(multilot.bids[0].lotIds, ["multi-1:lot:lot-a", "multi-1:lot:lot-b"]);
  assert.equal(multilot.awards[1].bidId, "multi-1:bid:bid-1");
  assert.equal(multilot.awards[1].lotId, "multi-1:lot:lot-b");
  assert.equal(multilot.procurements[0].description.sourceState, "source-null");
  assert.equal(multilot.procurements[0].mainProcurementCategory.value, "works");
  assert.equal(multilot.procurements[0].datePublished.value, "2026-08-01T09:15:00+03:00");
  assert.equal(multilot.procurements[0].datePublished.provenance.sourcePath, "tender.data.date");

  const disqualificationTender = {
    data: {
      id: "dq-1",
      tenderID: "UA-2026-08-02-000002-a",
      title: "Конкурентна закупівля без лотів",
      status: "active.qualification",
      procurementMethod: "open",
      procurementMethodType: "aboveThresholdUA",
      value: value(50_000),
      items: [{ id: "item-root", description: "Послуга", quantity: 1 }],
      bids: [{ id: "bid-dq", status: "unsuccessful", value: value(49_000), tenderers: [party("22222222", "Відхилений учасник")] }],
      awards: [{
        id: "award-dq",
        bid_id: "bid-dq",
        status: "unsuccessful",
        qualified: false,
        eligible: true,
        description: "Не надано документ про кваліфікацію",
        suppliers: [party("22222222", "Відхилений учасник")],
      }],
    },
  };
  const disqualification = importProzorroAnalytics(disqualificationTender, [], options);
  assert.equal(disqualification.lots.length, 1);
  assert.equal(disqualification.lots[0].kind, "root-lot");
  assert.equal(disqualification.lots[0].sourceLotId, null);
  assert.equal(disqualification.items[0].lotId, "dq-1:lot:root");
  assert.equal(disqualification.awards[0].lotId, "dq-1:lot:root");
  assert.equal(disqualification.awards[0].disqualificationReason.value, "Не надано документ про кваліфікацію");
  assert.equal(disqualification.awards[0].qualified.value, false);

  const directTender = {
    data: {
      id: "direct-1",
      tenderID: "UA-2026-08-03-000003-a",
      title: "Звіт про договір",
      status: "complete",
      procurementMethod: "limited",
      procurementMethodType: "reporting",
      value: value(24_000),
      items: [{ id: "direct-item", description: "Товар", quantity: 3 }],
      awards: [{ id: "direct-award", status: "active", value: value(24_000), suppliers: [party("33333333", "Постачальник")] }],
      contracts: [{ id: "direct-contract", awardID: "direct-award", status: "active", value: value(24_000), suppliers: [party("33333333", "Постачальник")] }],
    },
  };
  const direct = importProzorroAnalytics(directTender, [], options);
  assert.equal(direct.bids.length, 0, "reporting procedures are valid without participation/bid records");
  assert.equal(direct.lots.length, 0, "direct reporting must not invent a competitive root lot");
  assert.equal(direct.awards[0].bidId, null);
  assert.equal(direct.contracts[0].awardId, "direct-1:award:direct-award");

  const terminatedTender = {
    data: {
      id: "term-1",
      tenderID: "UA-2026-08-04-000004-a",
      title: "Виконання договору",
      status: "complete",
      procurementMethod: "open",
      procurementMethodType: "aboveThresholdUA",
      value: value(500_000),
      awards: [{ id: "term-award", status: "active", value: value(450_000), suppliers: [party("44444444", "Переможець")] }],
      contracts: [{ id: "term-contract", awardID: "term-award", status: "active", value: value(450_000) }],
    },
  };
  const contractingObject = {
    data: {
      id: "term-contract",
      contractID: "UA-2026-08-04-000004-a-c1",
      awardID: "term-award",
      contractNumber: "17/26",
      status: "terminated",
      dateSigned: "2026-08-05T10:00:00+03:00",
      dateModified: "2026-08-11T14:00:00+03:00",
      value: { ...value(430_000), amountNet: 358_333.33 },
      amountPaid: { ...value(120_000), amountNet: 100_000 },
      terminationDetails: "Договір розірвано за згодою сторін",
      suppliers: [party("44444444", "Переможець")],
      changes: [{
        id: "change-1",
        status: "active",
        date: "2026-08-10T12:00:00+03:00",
        rationale: "Зменшення обсягів закупівлі",
        rationaleTypes: ["volumeCuts"],
        modifications: { value: value(430_000) },
      }],
    },
  };
  const terminated = importProzorroAnalytics(terminatedTender, contractingObject, options);
  assert.equal(terminated.contracts.length, 1, "tender and Contracting API views must merge by official identifiers");
  assert.equal(terminated.contracts[0].status.value, "terminated", "Contracting API is authoritative for execution status");
  assert.equal(terminated.contracts[0].terminationDetails.value, "Договір розірвано за згодою сторін");
  assert.equal(terminated.contracts[0].amountPaid.value?.amount, 120_000);
  assert.equal(terminated.contracts[0].amountPaid.provenance.source, "prozorro-contracting");
  assert.equal(terminated.changes[0].rationaleTypes[0], "volumeCuts");
  assert.deepEqual(terminated.contracts[0].changeIds, ["term-1:contract:term-contract:change:change-1"]);
  assert.equal(terminated.payments.length, 1);
  assert.equal(terminated.payments[0].kind, "reported-total");
  assert.equal(terminated.payments[0].amount.value?.amount, 120_000);
  assert.equal(terminated.payments[0].reportedAt.value, "2026-08-11T14:00:00+03:00");

  const explicitNullPayment = importProzorroAnalytics(terminatedTender, {
    data: { id: "term-contract", awardID: "term-award", amountPaid: null },
  }, options);
  assert.equal(explicitNullPayment.contracts[0].amountPaid.sourceState, "source-null");
  assert.equal(explicitNullPayment.contracts[0].amountPaid.value, null);
  assert.equal(explicitNullPayment.payments.length, 0, "null amountPaid is unknown, never a synthetic zero payment");

  console.log("✓ analytics-v2 multilot linkage");
  console.log("✓ analytics-v2 root lot and disqualification reason");
  console.log("✓ analytics-v2 direct reporting without participation");
  console.log("✓ analytics-v2 terminated contract, change, and amountPaid");
  console.log("✓ analytics-v2 source-null semantics");
} finally {
  await rm(fixtureRoot, { recursive: true, force: true });
}
