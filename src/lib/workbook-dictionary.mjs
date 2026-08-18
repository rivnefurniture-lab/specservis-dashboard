// @ts-check

/**
 * Канонічні довідники робочого файлу «закупівлі.xlsx».
 *
 * Обидва списки взяті з аркуша «База» самого файлу — це випадаючі списки, з яких
 * команда обирає значення в колонках «ПОТОЧНИЙ СТАТУС» і «КОМЕНТАР ДЛЯ ДОПИСУ».
 * Довідник — єдине джерело правди для класифікації. Значення, якого немає в
 * довіднику, ніколи не вгадується за схожістю: воно позначається окремо, щоб
 * розбіжність між файлом і кодом було видно, а не приховано.
 */

/**
 * @typedef {"in-progress" | "won" | "lost" | "declined" | "deadline-missed" | "cancelled" | "none" | "unrecognised"} StatusGroup
 * @typedef {"analysis" | "preparing" | "submitted" | "complaint"} StatusStage
 * @typedef {{
 *   code: string,
 *   label: string,
 *   group: StatusGroup,
 *   stage: StatusStage | null,
 *   workQueue: boolean,
 *   preSubmission: boolean,
 *   reachedSubmission: boolean,
 *   canonical: boolean,
 * }} TenderStatus
 */

/**
 * Порядок збігається з аркушем «База».
 *
 * `workQueue` — визначення директора: тендер вважається активним у роботі команди
 * лише за статусами «Аналіз закупівлі», «Готуємо пропозицію», «Документи подано»,
 * «Кваліфікація» та скаргами від нас. «Скарга на нас» — теж незавершена процедура,
 * але вона не входить у це визначення, тому в чергу роботи не потрапляє.
 *
 * `preSubmission` — пропозицію ще не подано, тому прострочений дедлайн означає
 * незакритий статус, а не завершену участь.
 *
 * @type {TenderStatus[]}
 */
const canonicalStatuses = [
  { code: "analysis", label: "Аналіз закупівлі", group: "in-progress", stage: "analysis", workQueue: true, preSubmission: true, reachedSubmission: false, canonical: true },
  { code: "preparing", label: "Готуємо пропозицію", group: "in-progress", stage: "preparing", workQueue: true, preSubmission: true, reachedSubmission: false, canonical: true },
  { code: "declined", label: "Відмова від участі", group: "declined", stage: null, workQueue: false, preSubmission: false, reachedSubmission: false, canonical: true },
  { code: "cancelled-by-buyer", label: "Скасували тендер", group: "cancelled", stage: null, workQueue: false, preSubmission: false, reachedSubmission: false, canonical: true },
  { code: "submitted", label: "Документи подано", group: "in-progress", stage: "submitted", workQueue: true, preSubmission: false, reachedSubmission: true, canonical: true },
  { code: "complaint-terms", label: "Скарга від нас на умови", group: "in-progress", stage: "complaint", workQueue: true, preSubmission: false, reachedSubmission: false, canonical: true },
  { code: "complaint-competitor", label: "Скарга від нас на конкурента", group: "in-progress", stage: "complaint", workQueue: true, preSubmission: false, reachedSubmission: true, canonical: true },
  { code: "complaint-against-us", label: "Скарга на нас", group: "in-progress", stage: "complaint", workQueue: false, preSubmission: false, reachedSubmission: true, canonical: true },
  { code: "re-announced", label: "Закупівлю переоголошено", group: "cancelled", stage: null, workQueue: false, preSubmission: false, reachedSubmission: false, canonical: true },
  { code: "disqualified", label: "Дискваліфіковано", group: "lost", stage: null, workQueue: false, preSubmission: false, reachedSubmission: true, canonical: true },
  { code: "all-disqualified", label: "Всіх дискваліфіковано", group: "cancelled", stage: null, workQueue: false, preSubmission: false, reachedSubmission: true, canonical: true },
  { code: "other-winner", label: "Інший переможець", group: "lost", stage: null, workQueue: false, preSubmission: false, reachedSubmission: true, canonical: true },
  { code: "deadline-missed", label: "Не встигли", group: "deadline-missed", stage: null, workQueue: false, preSubmission: false, reachedSubmission: false, canonical: true },
  { code: "procurement-failed", label: "Закупівля не відбулась", group: "cancelled", stage: null, workQueue: false, preSubmission: false, reachedSubmission: false, canonical: true },
  { code: "contracted", label: "Укладено договір", group: "won", stage: null, workQueue: false, preSubmission: false, reachedSubmission: true, canonical: true },
  { code: "qualification", label: "Кваліфікація", group: "in-progress", stage: "submitted", workQueue: true, preSubmission: false, reachedSubmission: true, canonical: true },
  { code: "awarded", label: "Обрані переможцем", group: "won", stage: null, workQueue: false, preSubmission: false, reachedSubmission: true, canonical: true },
  { code: "complaint-own-disqualification", label: "Скарга від нас на нашу дискваліфікацію", group: "in-progress", stage: "complaint", workQueue: true, preSubmission: false, reachedSubmission: true, canonical: true },
];

/** @type {TenderStatus} */
const emptyStatus = {
  code: "none",
  label: "Без статусу",
  group: "none",
  stage: null,
  workQueue: false,
  preSubmission: false,
  reachedSubmission: false,
  canonical: true,
};

/**
 * Довідник «КОМЕНТАРІЙ ДЛЯ ДОПИСУ» з аркуша «База».
 * `label` — коротка назва для групування, `source` — точний текст із файлу.
 * @type {Array<{ code: string, label: string, source: string }>}
 */
const canonicalReasons = [
  { code: "resources", label: "Ресурси або час", source: "недостатньо ресурсів  або часу для підготовки" },
  { code: "risky-buyer", label: "Проблемний замовник", source: "проблемний замовник  або негативний досвід" },
  { code: "budget", label: "Бюджет, рентабельність, логістика", source: "нецікавий бюджет /рентабельність /логістика" },
  { code: "complexity", label: "Складна підготовка", source: "складна підготовка / незрозумілі перспективи " },
  { code: "guaranteed-rejection", label: "Гарантоване відхилення", source: "гарантоване відхилення через невідповідність " },
  { code: "agreement", label: "Домовленість / конфлікт інтересів", source: "домовленість про неучасть, конфлікт інтересів" },
  { code: "out-of-profile", label: "Не наш профіль", source: "проблемна специфіка / взагалі не наш профіль" },
  { code: "preparing", label: "Готуємо пропозицію", source: "готуємо" },
];

/** @param {unknown} value */
function normalize(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[\u2018\u2019\u02BC`\u00B4]/g, "'")
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s+/g, " ")
    .trim();
}

// `emptyStatus` теж реєструється за міткою, щоб збережений у snapshot текст
// «Без статусу» розпізнавався так само, як порожня клітинка у файлі.
const statusByLabel = new Map([...canonicalStatuses, emptyStatus].map((status) => [normalize(status.label), status]));
const reasonBySource = new Map(canonicalReasons.map((reason) => [normalize(reason.source), reason]));

/**
 * Зіставляє текст із колонки «ПОТОЧНИЙ СТАТУС» із довідником «База».
 * Порожня клітинка — «Без статусу». Значення поза довідником повертається як є
 * з `canonical: false`, щоб його було видно у контролі якості даних.
 * @param {unknown} value
 * @returns {TenderStatus}
 */
export function resolveStatus(value) {
  const raw = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return emptyStatus;
  const known = statusByLabel.get(normalize(raw));
  if (known) return known;
  return {
    code: "unrecognised",
    label: raw,
    group: "unrecognised",
    stage: null,
    workQueue: false,
    preSubmission: false,
    reachedSubmission: false,
    canonical: false,
  };
}

/**
 * Зіставляє текст із колонки «КОМЕНТАР ДЛЯ ДОПИСУ» із довідником «База».
 * Довільний текст не підганяється під найближчий пункт довідника: він отримує
 * окремий код `manual`, а точне формулювання залишається в полі `comment`.
 * @param {unknown} value
 * @returns {{ code: string, label: string, canonical: boolean }}
 */
export function resolveReason(value) {
  const raw = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return { code: "none", label: "Не вказано", canonical: true };
  const known = reasonBySource.get(normalize(raw));
  if (known) return { code: known.code, label: known.label, canonical: true };
  return { code: "manual", label: "Інша причина (вписана вручну)", canonical: false };
}

export { canonicalStatuses, canonicalReasons };
