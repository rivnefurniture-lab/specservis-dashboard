// @ts-check

/**
 * Канонічний довідник воронки проєктів із файлу «ПЕРЕЛІК-BITRIX».
 *
 * Джерело — аркуш «Аркуш2» самого файлу: це випадаючий список, з якого команда
 * обирає значення в колонці «СТАТУС ПОТОЧНИЙ». Той самий принцип, що й з аркушем
 * «База» у закупівлі.xlsx: класифікація береться з довідника файлу, а не
 * вгадується за словами в тексті.
 *
 * Код стадії («1.1», «3.2») — стабільний ключ. Саме за ним іде зіставлення, бо
 * назви стадій у файлі містять друкарські помилки («Виконанн робіт») і різні
 * тире, а коди — ні.
 */

/**
 * @typedef {"preparation" | "tender" | "delivery" | "archive" | "mixed"} PipelinePhase
 * @typedef {{
 *   code: string,
 *   label: string,
 *   phase: PipelinePhase,
 *   phaseLabel: string,
 *   active: boolean,
 *   canonical: boolean,
 * }} PipelineStage
 */

/** @type {Record<PipelinePhase, string>} */
const phaseLabels = {
  preparation: "Підготовка",
  tender: "Тендер",
  delivery: "Реалізація",
  archive: "Архів",
  mixed: "Різні етапи",
};

/**
 * Порядок збігається з аркушем «Аркуш2».
 *
 * `active` — чи є проєкт живою роботою. Стадії відмов, програшів і архіву не
 * активні: вони пояснюють, чому проєкт зупинився, і не мають потрапляти в
 * навантаження команди.
 *
 * @type {Array<Omit<PipelineStage, "phaseLabel" | "canonical"> & { aliases?: string[] }>}
 */
const canonicalStages = [
  // Єдина стадія, яку у файлі пишуть без цифрового префікса, тому їй потрібне
  // зіставлення за точним текстом довідника, а не за кодом.
  { code: "0.0", label: "Різний статус окремих етапів", phase: "mixed", active: true, aliases: ["РІЗНИЙ СТАТУС ОКРЕМИХ ЕТАПІВ"] },
  { code: "1.1", label: "Перспектива — аналіз, оцінка", phase: "preparation", active: true },
  { code: "1.2", label: "Обстеження або розрахунки", phase: "preparation", active: true },
  { code: "1.3", label: "Пропозиція на розгляді у контрагента", phase: "preparation", active: true },
  { code: "1.4", label: "Очікуємо тендер або договір", phase: "preparation", active: true },
  { code: "1.5", label: "Невизначеність або відмова", phase: "preparation", active: false },
  { code: "1.6", label: "Передано в суміжний відділ", phase: "preparation", active: false },
  { code: "1.7", label: "Неактуально, але на контролі", phase: "preparation", active: false },
  { code: "2.1", label: "Перемога — очікуємо акцепт", phase: "tender", active: true },
  { code: "2.2", label: "Підготовка пропозиції, участь", phase: "tender", active: true },
  { code: "2.3", label: "Неучасть: брак часу або ресурсів", phase: "tender", active: false },
  { code: "2.4", label: "Відмова від участі: домовленість", phase: "tender", active: false },
  { code: "2.5", label: "Оскарження тендерної закупівлі", phase: "tender", active: true },
  { code: "2.6", label: "Скасовано тендер замовником", phase: "tender", active: false },
  { code: "2.7", label: "Перші — оцінка, кваліфікація", phase: "tender", active: true },
  { code: "2.8", label: "У черзі на розгляд, не перші", phase: "tender", active: true },
  { code: "2.9", label: "Не перемога або відхилення", phase: "tender", active: false },
  { code: "3.1", label: "Договір: підготовка, підпис", phase: "delivery", active: true },
  { code: "3.2", label: "Виконання робіт, активна фаза", phase: "delivery", active: true },
  { code: "3.3", label: "Розірвання, претензія або пауза", phase: "delivery", active: false },
  { code: "3.4", label: "Завершені роботи — доплата", phase: "delivery", active: true },
  { code: "3.5", label: "Закритий, оплачений договір", phase: "delivery", active: false },
  { code: "3.6", label: "Минулі періоди — доробки", phase: "delivery", active: true },
  { code: "4.0", label: "Архів, неактивний статус", phase: "archive", active: false },
];

/** @type {PipelineStage} */
const emptyStage = {
  code: "none",
  label: "Без стадії",
  phase: "mixed",
  phaseLabel: phaseLabels.mixed,
  active: false,
  canonical: true,
};

/** @param {unknown} value */
function normalize(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[–—−]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** @type {Map<string, PipelineStage>} */
const stageByCode = new Map();
/** @type {Map<string, PipelineStage>} */
const stageByLabel = new Map();
for (const stage of canonicalStages) {
  const resolved = { ...stage, phaseLabel: phaseLabels[stage.phase], canonical: true };
  delete (/** @type {Record<string, unknown>} */ (resolved)).aliases;
  stageByCode.set(stage.code, resolved);
  for (const alias of stage.aliases ?? []) stageByLabel.set(normalize(alias), resolved);
}

/**
 * Зіставляє текст із колонки «СТАТУС ПОТОЧНИЙ» із довідником «Аркуш2».
 *
 * Зіставлення йде за кодом на початку рядка («2.1 - Перемога …» → «2.1»), бо
 * коди стабільні, а назви у файлі містять друкарські помилки. Рядок без коду
 * або з кодом поза довідником повертається як є з `canonical: false`, щоб
 * розбіжність між файлом і кодом було видно, а не приховано.
 *
 * @param {unknown} value
 * @returns {PipelineStage}
 */
export function resolveStage(value) {
  const raw = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return emptyStage;
  const code = raw.match(/^(\d+\.\d+)/)?.[1];
  const known = (code ? stageByCode.get(code) : undefined) ?? stageByLabel.get(normalize(raw));
  if (known) return known;
  return {
    code: code ?? "unrecognised",
    label: raw,
    phase: "mixed",
    phaseLabel: phaseLabels.mixed,
    active: false,
    canonical: false,
  };
}

/** Порядок фаз для показу воронки зліва направо. @type {PipelinePhase[]} */
const phaseOrder = ["preparation", "tender", "delivery", "archive", "mixed"];

export { phaseLabels, phaseOrder };
