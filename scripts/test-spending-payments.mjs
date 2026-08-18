import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const sourcePath = new URL("../src/lib/spending-payments.ts", import.meta.url);
const source = await readFile(sourcePath, "utf8");
const transpiled = ts.transpileModule(source.replace('import "server-only";', ""), {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`;
const { matchSpendingTransaction, summarizeConfirmedPayments } = await import(moduleUrl);

const contract = {
  tenderId: "UA-2024-07-11-005663-a",
  contractNumber: "№ 243",
  signedAt: "2024-07-31T08:00:00+03:00",
  buyerIdentifier: "41326277",
  supplierIdentifier: "02005450",
};

const confirmed = matchSpendingTransaction({
  id: 289789011,
  trans_date: "2024-09-26",
  amount: 1360.73,
  currency: "UAH",
  payer_edrpou: "41326277",
  recipt_edrpou: "02005450",
  contractNumber: "UA-2024-07-11-005663-a",
  payment_details: "договiр № 243 вiд 31.07.2024 р.",
}, contract);
assert.equal(confirmed.matchConfidence, "confirmed");

const probable = matchSpendingTransaction({
  id: 2,
  amount: 100,
  payer_edrpou: "41326277",
  recipt_edrpou: "02005450",
  payment_details: "Оплата за договором №243 від 31.07.2024 р.",
}, contract);
assert.equal(probable.matchConfidence, "probable");

const unrelated = matchSpendingTransaction({
  id: 3,
  amount: 999,
  payer_edrpou: "41326277",
  recipt_edrpou: "02005450",
  payment_details: "Договір №58 від 19.02.2024 р.",
}, contract);
assert.equal(unrelated.matchConfidence, "unmatched");
assert.equal(summarizeConfirmedPayments([confirmed, probable, unrelated]), 1360.73);
console.log("spending payment tests passed");
