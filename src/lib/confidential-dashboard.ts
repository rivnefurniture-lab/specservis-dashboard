import type { ConfidentialTurnoverRecord } from "@/lib/confidential-turnover";

export type TurnoverRangeOption = { id: string; label: string; from: string; to: string };

export type TurnoverMonth = ConfidentialTurnoverRecord & {
  grossTurnover: number;
  strategicTurnover: number;
  turnoverPerFte: number | null;
  payrollPerFte: number | null;
  payrollShare: number | null;
};

export type TurnoverSummary = {
  months: number;
  grossTurnover: number;
  baseTurnover: number;
  strategicTurnover: number;
  strategicShare: number | null;
  payroll: number;
  payrollMonths: number;
  payrollShare: number | null;
  avgFte: number | null;
  lastFte: number | null;
  turnoverPerFte: number | null;
  lastTurnoverPerFte: number | null;
  payrollPerFte: number | null;
};

export type EntityMix = { id: string; label: string; value: number; share: number };

export type AnnualTurnover = TurnoverSummary & { year: string; complete: boolean };

export type ComparableTurnover = TurnoverSummary & {
  id: string;
  label: string;
  from: string;
  to: string;
  monthly: TurnoverMonth[];
  cumulativeBaseTurnover: number[];
};

export type TurnoverMovement = {
  latestPeriod: string | null;
  previousPeriod: string | null;
  grossMonthOverMonth: number | null;
  grossYearOverYear: number | null;
  baseMonthOverMonth: number | null;
  fteMonthOverMonth: number | null;
  productivityMonthOverMonth: number | null;
};

export type PayrollEconomics = {
  months: number;
  currentPayroll: number;
  previousPayroll: number;
  payrollGrowth: number | null;
  currentGross: number;
  previousGross: number;
  grossGrowth: number | null;
  currentBase: number;
  previousBase: number;
  baseGrowth: number | null;
  payrollGrowthGap: number | null;
};

export type TurnoverStructure = {
  recordedCash: number;
  recordedCashShare: number | null;
  topEntity: EntityMix | null;
  topThreeShare: number | null;
};

export type ConfidentialDashboardModel = {
  range: TurnoverRangeOption;
  options: TurnoverRangeOption[];
  months: TurnoverMonth[];
  comparisonMonths: TurnoverMonth[];
  summary: TurnoverSummary;
  comparison: TurnoverSummary | null;
  payrollComparison: { current: number; previous: number; months: number; growth: number | null } | null;
  payrollEconomics: PayrollEconomics | null;
  movement: TurnoverMovement;
  structure: TurnoverStructure;
  growth: {
    grossTurnover: number | null;
    baseTurnover: number | null;
    avgFte: number | null;
    turnoverPerFte: number | null;
  };
  entityMix: EntityMix[];
  comparisonEntityMix: EntityMix[];
  history: ComparableTurnover[];
  annual: AnnualTurnover[];
  peak: TurnoverMonth | null;
};

const sum = (values: Array<number | null | undefined>) => values.reduce<number>((total, value) => total + (value ?? 0), 0);

function monthIndex(period: string) {
  const [year, month] = period.split("-").map(Number);
  return year * 12 + month - 1;
}

function periodFromIndex(index: number) {
  return `${Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2, "0")}`;
}

function priorYear(period: string) {
  return periodFromIndex(monthIndex(period) - 12);
}

function divide(numerator: number, denominator: number) {
  return denominator ? numerator / denominator : null;
}

function growth(current: number | null, previous: number | null) {
  return current === null || previous === null || previous === 0 ? null : current / previous - 1;
}

export function deriveTurnoverMonth(record: ConfidentialTurnoverRecord): TurnoverMonth {
  const strategicTurnover = sum([record.cocaColaPromtech, record.cocaColaSpecservis, record.abinbev]);
  const grossTurnover = (record.baseTurnover ?? 0) + strategicTurnover;
  return {
    ...record,
    grossTurnover,
    strategicTurnover,
    turnoverPerFte: record.fte && record.baseTurnover !== null ? record.baseTurnover / record.fte : null,
    payrollPerFte: record.payroll !== null && record.fte ? record.payroll / record.fte : null,
    payrollShare: record.payroll !== null && record.baseTurnover ? record.payroll / record.baseTurnover : null,
  };
}

function summarizeTurnover(months: TurnoverMonth[]): TurnoverSummary {
  const grossTurnover = sum(months.map((month) => month.grossTurnover));
  const baseTurnover = sum(months.map((month) => month.baseTurnover));
  const strategicTurnover = sum(months.map((month) => month.strategicTurnover));
  const fteMonths = months.filter((month) => month.fte !== null);
  const totalFte = sum(fteMonths.map((month) => month.fte));
  const payrollMonths = months.filter((month) => month.payroll !== null);
  const payroll = sum(payrollMonths.map((month) => month.payroll));
  const payrollFte = sum(payrollMonths.map((month) => month.fte));
  const payrollBase = sum(payrollMonths.map((month) => month.baseTurnover));
  const productivityMonths = months.filter((month) => month.turnoverPerFte !== null);
  const latestProductivity = [...months].reverse().find((month) => month.turnoverPerFte !== null);
  return {
    months: months.length,
    grossTurnover,
    baseTurnover,
    strategicTurnover,
    strategicShare: divide(strategicTurnover, grossTurnover),
    payroll,
    payrollMonths: payrollMonths.length,
    payrollShare: divide(payroll, payrollBase),
    avgFte: divide(totalFte, fteMonths.length),
    lastFte: [...months].reverse().find((month) => month.fte !== null)?.fte ?? null,
    turnoverPerFte: divide(sum(productivityMonths.map((month) => month.turnoverPerFte)), productivityMonths.length),
    lastTurnoverPerFte: latestProductivity?.turnoverPerFte ?? null,
    payrollPerFte: divide(payroll, payrollFte),
  };
}

function confidentialRangeOptions(records: ConfidentialTurnoverRecord[]): TurnoverRangeOption[] {
  const sorted = [...records].sort((a, b) => a.period.localeCompare(b.period));
  const first = sorted[0]?.period;
  const last = sorted.at(-1)?.period;
  if (!first || !last) return [];
  const latestYear = last.slice(0, 4);
  const years = [...new Set(sorted.map((record) => record.period.slice(0, 4)))].sort().reverse();
  return [
    { id: "ytd", label: `${latestYear} YTD`, from: `${latestYear}-01`, to: last },
    { id: "12m", label: "Останні 12 місяців", from: periodFromIndex(Math.max(monthIndex(first), monthIndex(last) - 11)), to: last },
    ...years.map((year) => ({ id: year, label: year, from: `${year}-01`, to: `${year}-12` })),
    { id: "all", label: "Уся історія", from: first, to: last },
  ];
}

function entityMix(months: TurnoverMonth[]): EntityMix[] {
  const values = [
    { id: "specservis", label: "Спецсервіс", value: sum(months.map((month) => (month.specservisBank ?? 0) + (month.specservisCash ?? 0))) },
    { id: "promtech", label: "Промтехгруп · база", value: sum(months.map((month) => month.promtechCore)) },
    { id: "refkey", label: "Рефкей", value: sum(months.map((month) => (month.refkeyBank ?? 0) + (month.refkeyCash ?? 0))) },
    { id: "naryshkov", label: "ФОП Наришков", value: sum(months.map((month) => month.fopNaryshkov)) },
    { id: "pashkov", label: "ФОП Пашков", value: sum(months.map((month) => month.fopPashkov)) },
    { id: "danilenko", label: "ФОП Даниленко", value: sum(months.map((month) => month.fopDanilenko)) },
  ].filter((item) => item.value !== 0);
  const reportedTotal = sum(months.map((month) => month.baseTurnover));
  const reconciliation = reportedTotal - sum(values.map((item) => item.value));
  if (Math.abs(reconciliation) >= 1) {
    values.push({ id: "reconciliation", label: "Нерозподілені коригування", value: reconciliation });
  }
  const total = sum(values.map((item) => item.value));
  return values.map((item) => ({ ...item, share: total ? item.value / total : 0 })).sort((a, b) => b.value - a.value);
}

function matchedPayrollEconomics(current: TurnoverMonth[], byPeriod: Map<string, TurnoverMonth>): PayrollEconomics | null {
  const pairs = current.flatMap((month) => {
    const previous = byPeriod.get(priorYear(month.period));
    return month.payroll !== null && previous?.payroll !== null && previous?.payroll !== undefined ? [[month, previous] as const] : [];
  });
  if (!pairs.length) return null;
  const currentPayroll = sum(pairs.map(([month]) => month.payroll));
  const previousPayroll = sum(pairs.map(([, month]) => month.payroll));
  const currentGross = sum(pairs.map(([month]) => month.grossTurnover));
  const previousGross = sum(pairs.map(([, month]) => month.grossTurnover));
  const currentBase = sum(pairs.map(([month]) => month.baseTurnover));
  const previousBase = sum(pairs.map(([, month]) => month.baseTurnover));
  const payrollGrowth = growth(currentPayroll, previousPayroll);
  const grossGrowth = growth(currentGross, previousGross);
  const baseGrowth = growth(currentBase, previousBase);
  return {
    months: pairs.length,
    currentPayroll,
    previousPayroll,
    payrollGrowth,
    currentGross,
    previousGross,
    grossGrowth,
    currentBase,
    previousBase,
    baseGrowth,
    payrollGrowthGap: payrollGrowth === null || baseGrowth === null ? null : payrollGrowth - baseGrowth,
  };
}

function movement(months: TurnoverMonth[], byPeriod: Map<string, TurnoverMonth>): TurnoverMovement {
  const latest = months.at(-1);
  const previous = months.at(-2);
  const yearAgo = latest ? byPeriod.get(priorYear(latest.period)) : undefined;
  return {
    latestPeriod: latest?.period ?? null,
    previousPeriod: previous?.period ?? null,
    grossMonthOverMonth: latest && previous ? growth(latest.grossTurnover, previous.grossTurnover) : null,
    grossYearOverYear: latest && yearAgo ? growth(latest.grossTurnover, yearAgo.grossTurnover) : null,
    baseMonthOverMonth: latest && previous ? growth(latest.baseTurnover, previous.baseTurnover) : null,
    fteMonthOverMonth: latest && previous ? growth(latest.fte, previous.fte) : null,
    productivityMonthOverMonth: latest && previous ? growth(latest.turnoverPerFte, previous.turnoverPerFte) : null,
  };
}

function turnoverStructure(months: TurnoverMonth[], mix: EntityMix[]): TurnoverStructure {
  const base = sum(months.map((month) => month.baseTurnover));
  const recordedCash = sum(months.map((month) => (month.refkeyCash ?? 0) + (month.specservisCash ?? 0)));
  const positive = mix
    .filter((item) => item.id !== "reconciliation" && item.value > 0)
    .sort((a, b) => b.value - a.value);
  return {
    recordedCash,
    recordedCashShare: divide(recordedCash, base),
    topEntity: positive[0] ?? null,
    topThreeShare: divide(sum(positive.slice(0, 3).map((item) => item.value)), base),
  };
}

function comparableHistory(allMonths: TurnoverMonth[], range: TurnoverRangeOption): ComparableTurnover[] {
  const period = (id: string, label: string, from: string, to: string, months: TurnoverMonth[]): ComparableTurnover => {
    let runningTotal = 0;
    return {
      id,
      label,
      from,
      to,
      monthly: months,
      cumulativeBaseTurnover: months.map((month) => {
        runningTotal += month.baseTurnover ?? 0;
        return runningTotal;
      }),
      ...summarizeTurnover(months),
    };
  };

  if (range.id === "all") {
    return [...new Set(allMonths.map((month) => month.period.slice(0, 4)))].map((year) => {
      const yearMonths = allMonths.filter((month) => month.period.startsWith(`${year}-`));
      return period(year, year, `${year}-01`, `${year}-12`, yearMonths);
    });
  }

  const selectedMonths = allMonths.filter((month) => month.period >= range.from && month.period <= range.to);
  const effectiveFrom = selectedMonths[0]?.period ?? range.from;
  const effectiveTo = selectedMonths.at(-1)?.period ?? range.to;
  const firstIndex = monthIndex(allMonths[0]?.period ?? range.from);
  const expectedMonths = monthIndex(effectiveTo) - monthIndex(effectiveFrom) + 1;
  const periods: ComparableTurnover[] = [];
  for (let offset = 0; monthIndex(effectiveFrom) - offset * 12 >= firstIndex; offset += 1) {
    const from = periodFromIndex(monthIndex(effectiveFrom) - offset * 12);
    const to = periodFromIndex(monthIndex(effectiveTo) - offset * 12);
    const months = allMonths.filter((month) => month.period >= from && month.period <= to);
    if (months.length !== expectedMonths) continue;
    const fromYear = from.slice(0, 4);
    const toYear = to.slice(0, 4);
    periods.push(period(`${from}:${to}`, fromYear === toYear ? toYear : `${fromYear}/${toYear.slice(2)}`, from, to, months));
  }
  return periods.reverse();
}

export function buildConfidentialDashboard(records: ConfidentialTurnoverRecord[], rangeId = "ytd"): ConfidentialDashboardModel {
  const allMonths = [...records].sort((a, b) => a.period.localeCompare(b.period)).map(deriveTurnoverMonth);
  const options = confidentialRangeOptions(records);
  const range = options.find((option) => option.id === rangeId) ?? options[0];
  if (!range) throw new Error("Confidential turnover dataset is empty");
  const months = allMonths.filter((month) => month.period >= range.from && month.period <= range.to);
  const byPeriod = new Map(allMonths.map((month) => [month.period, month]));
  const comparisonMonths = range.id === "all" ? [] : months.flatMap((month) => {
    const comparison = byPeriod.get(priorYear(month.period));
    return comparison ? [comparison] : [];
  });
  const summary = summarizeTurnover(months);
  const comparison = comparisonMonths.length === months.length ? summarizeTurnover(comparisonMonths) : null;
  const payrollEconomics = matchedPayrollEconomics(months, byPeriod);
  const mix = entityMix(months);
  const annual = [...new Set(allMonths.map((month) => month.period.slice(0, 4)))].map((year) => {
    const yearMonths = allMonths.filter((month) => month.period.startsWith(`${year}-`));
    return { year, complete: yearMonths.length === 12, ...summarizeTurnover(yearMonths) };
  }).reverse();
  return {
    range,
    options,
    months,
    comparisonMonths,
    summary,
    comparison,
    payrollComparison: payrollEconomics ? {
      current: payrollEconomics.currentPayroll,
      previous: payrollEconomics.previousPayroll,
      months: payrollEconomics.months,
      growth: payrollEconomics.payrollGrowth,
    } : null,
    payrollEconomics,
    movement: movement(months, byPeriod),
    structure: turnoverStructure(months, mix),
    growth: {
      grossTurnover: comparison ? growth(summary.grossTurnover, comparison.grossTurnover) : null,
      baseTurnover: comparison ? growth(summary.baseTurnover, comparison.baseTurnover) : null,
      avgFte: comparison ? growth(summary.avgFte, comparison.avgFte) : null,
      turnoverPerFte: comparison ? growth(summary.turnoverPerFte, comparison.turnoverPerFte) : null,
    },
    entityMix: mix,
    comparisonEntityMix: comparison ? entityMix(comparisonMonths) : [],
    history: comparableHistory(allMonths, range),
    annual,
    peak: months.reduce<TurnoverMonth | null>((peak, month) => !peak || (month.baseTurnover ?? 0) > (peak.baseTurnover ?? 0) ? month : peak, null),
  };
}
