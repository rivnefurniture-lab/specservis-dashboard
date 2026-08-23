import assert from "node:assert/strict";
import { buildConfidentialDashboard, deriveTurnoverMonth } from "../src/lib/confidential-dashboard.ts";

const row = (period, values = {}) => ({
  period, sourceRow: 1, promtechGross: null, promtechCore: 20, refkeyBank: 10, specservisBank: 40,
  fopNaryshkov: 5, fopPashkov: 0, fopDanilenko: 0, refkeyCash: 5, specservisCash: 10,
  baseTurnover: 90, fte: 3, payroll: 18, sourceTurnoverPerFte: 30,
  cocaColaPromtech: 5, cocaColaSpecservis: 5, abinbev: 0, ...values,
});

const records = [
  row("2025-01", { baseTurnover: 80, payroll: 16, fte: 2 }),
  row("2025-02", { baseTurnover: 100, payroll: 20, fte: 2 }),
  row("2026-01", { baseTurnover: 160, payroll: 24, fte: 4 }),
  row("2026-02", { baseTurnover: 200, payroll: null, fte: 5, cocaColaPromtech: 20 }),
];

const derived = deriveTurnoverMonth(records[3]);
assert.equal(derived.strategicTurnover, 25);
assert.equal(derived.grossTurnover, 225);
assert.equal(derived.turnoverPerFte, 40, "director productivity follows base turnover / FTE, as in the source workbook");
assert.equal(derived.payrollShare, null, "unknown payroll must not become zero");

const dashboard = buildConfidentialDashboard(records, "ytd");
assert.deepEqual(dashboard.months.map((month) => month.period), ["2026-01", "2026-02"]);
assert.deepEqual(dashboard.comparisonMonths.map((month) => month.period), ["2025-01", "2025-02"]);
assert.equal(dashboard.summary.grossTurnover, 395);
assert.equal(dashboard.summary.baseTurnover, 360);
assert.equal(dashboard.summary.lastTurnoverPerFte, 40);
assert.equal(dashboard.summary.turnoverPerFte, 40, "period productivity is the average of monthly turnover/FTE values");
assert.equal(dashboard.summary.avgFte, 4.5);
assert.equal(dashboard.summary.payroll, 24);
assert.equal(dashboard.summary.payrollMonths, 1);
assert.equal(dashboard.payrollComparison?.months, 1, "payroll comparison must use matching known months only");
assert.equal(dashboard.payrollComparison?.current, 24);
assert.equal(dashboard.payrollComparison?.previous, 16);
assert.equal(dashboard.payrollEconomics?.grossGrowth, 170 / 90 - 1);
assert.equal(dashboard.payrollEconomics?.payrollGrowth, .5);
assert.equal(dashboard.payrollEconomics?.payrollGrowthGap, -.5);
assert.equal(dashboard.movement.latestPeriod, "2026-02");
assert.equal(dashboard.movement.grossMonthOverMonth, 225 / 170 - 1);
assert.equal(dashboard.movement.grossYearOverYear, 225 / 110 - 1);
assert.equal(dashboard.structure.recordedCash, 30);
assert.equal(dashboard.structure.topEntity?.id, "specservis");
assert.equal(dashboard.structure.topThreeShare, 170 / 360);
assert.equal(dashboard.entityMix.some((item) => item.id === "strategic"), false, "strategic contracts stay outside the company mix");
assert.equal(dashboard.entityMix.reduce((sum, item) => sum + item.value, 0), dashboard.summary.baseTurnover);
assert.equal(dashboard.peak?.period, "2026-02");
assert.equal(dashboard.annual[0].complete, false);

console.log("confidential dashboard: ranges, reconciliation, comparison, and source-null handling passed");
