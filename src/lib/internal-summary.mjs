// @ts-check

import { resolveStatus } from "./workbook-dictionary.mjs";

/** @typedef {import("./types").InternalTender} InternalTender */
/** @typedef {import("./types").SnapshotSummary} SnapshotSummary */

/**
 * Єдине місце, де рахуються підсумки внутрішнього реєстру.
 * І генератор snapshot-а, і API дашборда викликають цю функцію, щоб цифра для
 * директора і цифра для керівника напрямку рахувалися однаковим правилом.
 *
 * @param {InternalTender[]} tenders
 * @returns {SnapshotSummary}
 */
export function summarizeInternalTenders(tenders) {
  /** @type {Map<string, number>} */
  const statusMap = new Map();
  /** @type {Map<string, number>} */
  const reasonMap = new Map();
  /** @type {Map<string, number>} */
  const directionMap = new Map();
  /** @type {Map<string, {month: string, count: number, value: number}>} */
  const monthMap = new Map();

  let totalValue = 0;
  let inWork = 0;
  let participated = 0;
  let awarded = 0;
  let contracted = 0;
  let lost = 0;
  let declined = 0;
  let deadlineMissed = 0;
  let cancelled = 0;
  let withoutStatus = 0;
  let unrecognisedStatus = 0;

  for (const tender of tenders) {
    const status = resolveStatus(tender.status);
    totalValue += tender.value;
    if (status.workQueue) inWork += 1;
    if (status.reachedSubmission || tender.ourOffer != null) participated += 1;
    if (status.code === "awarded") awarded += 1;
    if (status.code === "contracted") contracted += 1;
    if (status.group === "lost") lost += 1;
    if (status.group === "declined") declined += 1;
    if (status.group === "deadline-missed") deadlineMissed += 1;
    if (status.group === "cancelled") cancelled += 1;
    if (status.group === "none") withoutStatus += 1;
    if (!status.canonical) unrecognisedStatus += 1;

    statusMap.set(tender.status, (statusMap.get(tender.status) ?? 0) + 1);
    reasonMap.set(tender.reason, (reasonMap.get(tender.reason) ?? 0) + 1);
    directionMap.set(tender.direction, (directionMap.get(tender.direction) ?? 0) + 1);
    if (tender.deadline) {
      const month = tender.deadline.slice(0, 7);
      const current = monthMap.get(month) ?? { month, count: 0, value: 0 };
      current.count += 1;
      current.value += tender.value;
      monthMap.set(month, current);
    }
  }

  const values = tenders.map((tender) => tender.value).filter(Boolean).sort((left, right) => left - right);
  /** @type {(map: Map<string, number>) => Array<{name: string, value: number}>} */
  const counts = (map) => [...map]
    .map(([name, value]) => ({ name, value }))
    .sort((left, right) => right.value - left.value);

  return {
    totalCount: tenders.length,
    totalValue,
    inWork,
    participated,
    awarded,
    contracted,
    wins: awarded + contracted,
    lost,
    declined,
    deadlineMissed,
    cancelled,
    withoutStatus,
    unrecognisedStatus,
    medianValue: values.length ? values[Math.floor(values.length / 2)] : 0,
    statusCounts: counts(statusMap),
    reasonCounts: counts(reasonMap),
    directionCounts: /** @type {SnapshotSummary["directionCounts"]} */ (counts(directionMap)),
    monthly: [...monthMap.values()].sort((left, right) => left.month.localeCompare(right.month)),
  };
}
