// @ts-check

import ExcelJS from "exceljs";
import { phaseOrder, phaseLabels, resolveStage } from "./pipeline-dictionary.mjs";

/** @typedef {import("./types").ProjectsSnapshot} ProjectsSnapshot */
/** @typedef {import("./types").PipelineProject} PipelineProject */
/** @typedef {import("./types").DeliveryProject} DeliveryProject */

/** @param {unknown} value @returns {string} */
function compact(value) {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    const record = /** @type {Record<string, unknown>} */ (value);
    if (record.text != null) return compact(record.text);
    if (record.result != null) return compact(record.result);
    if (record.hyperlink != null) return compact(record.hyperlink);
    if (Array.isArray(record.richText)) return record.richText.map((part) => compact(part)).join("");
  }
  return String(value).replace(/\s+/g, " ").trim();
}

/** @param {unknown} value */
function number(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const normalized = compact(value).replace(/\s/g, "").replace(",", ".").replace(/[^\d.-]/g, "");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Витягує посилання з клітинки: у файлі частина рядків має справжній гіперлінк,
 * частина — просто текст URL.
 * @param {ExcelJS.Cell} cell
 */
function link(cell) {
  const raw = /** @type {Record<string, unknown> | null} */ (cell.value);
  const href = raw && typeof raw === "object" && raw.hyperlink != null
    ? compact(raw.hyperlink)
    : compact(cell.value);
  return /^https?:\/\//i.test(href) ? href : "";
}

/**
 * SmartTender у посиланні вигляду .../tender/12345678 або ?id=12345678.
 * Саме числовий Id, а не номер CDB — деталізація API приймає лише його.
 * @param {string} href
 */
function smartTenderId(href) {
  if (!href) return null;
  const match = href.match(/(?:tender[/=]|[?&]id=)(\d{6,12})/i) ?? href.match(/\/(\d{6,12})(?:[/?#]|$)/);
  return match ? match[1] : null;
}

/**
 * Реєстр проєктів «ПЕРЕЛІК-BITRIX».
 *
 * Тут уперше з'являється відповідальний за проєкт — поля, якого немає в
 * закупівлі.xlsx. Стадія береться з довідника «Аркуш2» цього ж файлу.
 *
 * @param {ExcelJS.Worksheet} sheet
 * @returns {PipelineProject[]}
 */
function parsePipelineSheet(sheet) {
  /** @type {PipelineProject[]} */
  const projects = [];
  for (let rowNumber = 3; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const registryName = compact(row.getCell(5).value);
    const workingName = compact(row.getCell(13).value);
    if (!registryName && !workingName) continue;
    const stage = resolveStage(row.getCell(11).value);
    const responsible = compact(row.getCell(3).value);
    // «?» і «—» у файлі означають «відповідального не призначено», а не людину.
    const namedResponsible = /^[?—–-]*$/.test(responsible) ? "" : responsible;
    const href = link(row.getCell(15));
    projects.push({
      row: rowNumber,
      code: registryName.match(/^(\d{5})\s*-/)?.[1] ?? "",
      registryName,
      workingName,
      responsible: namedResponsible,
      foreman: compact(row.getCell(4).value),
      stage: stage.label,
      stageCode: stage.code,
      phase: stage.phase,
      phaseLabel: stage.phaseLabel,
      active: stage.active,
      canonicalStage: stage.canonical,
      tag: compact(row.getCell(12).value),
      channel: compact(row.getCell(9).value),
      budget: number(row.getCell(14).value),
      donePercent: number(row.getCell(6).value),
      plannedPercent: number(row.getCell(7).value),
      factRevenue: number(row.getCell(16).value),
      tenderUrl: href,
      smartTenderId: smartTenderId(href),
    });
  }
  return projects;
}

/**
 * Реєстр «Реалізація проєктів» за 2026 рік.
 *
 * Свідомо не читаємо колонки «Прибуток» і «Рентабельність»: колонка
 * «Орієнтовна собівартість» порожня в усіх рядках без винятку, тому прибуток у
 * файлі дорівнює сумі договору, а рентабельність — рівно 100 % скрізь. Це
 * артефакт формули, а не факт, і показувати його не можна.
 *
 * Статуси тут — вільний текст (близько 70 варіантів), без довідника у файлі.
 * Тому вони не групуються в вигадані категорії, а показуються як є.
 *
 * @param {ExcelJS.Worksheet} sheet
 * @returns {DeliveryProject[]}
 */
function parseDeliverySheet(sheet) {
  /** @type {DeliveryProject[]} */
  const projects = [];
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const title = compact(row.getCell(2).value);
    if (!title) continue;
    const href = link(row.getCell(8));
    projects.push({
      row: rowNumber,
      title,
      note: compact(row.getCell(3).value),
      contractValue: number(row.getCell(4).value),
      entity: compact(row.getCell(5).value),
      budget: number(row.getCell(6).value),
      status: compact(row.getCell(7).value),
      manager: compact(row.getCell(14).value),
      tenderUrl: href,
      smartTenderId: smartTenderId(href),
    });
  }
  return projects;
}

/**
 * Виконавця в колонці «Компанія» пишуть по-різному: «СС», «сс» і навіть «CC»
 * латиницею. Це та сама компанія, набрана в різних розкладках, тому зведення
 * робиться після приведення регістру й латинських омоглифів до кирилиці.
 * Будь-який інший текст («СС, прямий», «ФОП Даниленко») лишається як є —
 * він несе додатковий сенс, який не можна злити в загальну купу.
 * @param {string} value
 */
function normalizeEntity(value) {
  const upper = value.toUpperCase().replace(/[CС]/g, "С").replace(/\s+/g, " ").trim();
  if (upper === "СС") return "СС";
  if (upper === "ФОП") return "ФОП";
  return value || "Не вказано";
}

/** @param {Array<string>} values */
function countBy(values) {
  /** @type {Map<string, number>} */
  const map = new Map();
  for (const value of values) map.set(value, (map.get(value) ?? 0) + 1);
  return [...map]
    .map(([name, value]) => ({ name, value }))
    .sort((left, right) => right.value - left.value || left.name.localeCompare(right.name, "uk"));
}

/**
 * @param {PipelineProject[]} pipeline
 * @param {DeliveryProject[]} delivery
 * @returns {ProjectsSnapshot["summary"]}
 */
function summarize(pipeline, delivery) {
  const active = pipeline.filter((project) => project.active);
  const withResponsible = pipeline.filter((project) => project.responsible);
  const sum = (/** @type {Array<number | null>} */ values) => values.reduce(
    (/** @type {number} */ total, value) => total + (value ?? 0),
    0,
  );

  /** @type {Map<string, {name: string, total: number, active: number, budget: number}>} */
  const owners = new Map();
  for (const project of pipeline) {
    if (!project.responsible) continue;
    const current = owners.get(project.responsible) ?? { name: project.responsible, total: 0, active: 0, budget: 0 };
    current.total += 1;
    if (project.active) current.active += 1;
    current.budget += project.budget ?? 0;
    owners.set(project.responsible, current);
  }

  const phases = phaseOrder
    .map((phase) => {
      const items = pipeline.filter((project) => project.phase === phase);
      return {
        phase,
        label: phaseLabels[phase],
        count: items.length,
        budget: sum(items.map((item) => item.budget)),
        stages: countBy(items.map((item) => item.stage)),
      };
    })
    .filter((entry) => entry.count > 0);

  const contracted = delivery.filter((project) => project.contractValue != null);

  return {
    pipelineCount: pipeline.length,
    pipelineActive: active.length,
    pipelineBudget: sum(pipeline.map((project) => project.budget)),
    activeBudget: sum(active.map((project) => project.budget)),
    withResponsible: withResponsible.length,
    withoutResponsible: pipeline.length - withResponsible.length,
    unrecognisedStages: pipeline.filter((project) => !project.canonicalStage).length,
    phases,
    owners: [...owners.values()].sort((left, right) => right.active - left.active || right.total - left.total),
    deliveryCount: delivery.length,
    deliveryContracted: contracted.length,
    deliveryContractValue: sum(contracted.map((project) => project.contractValue)),
    deliveryWithoutValue: delivery.length - contracted.length,
    deliveryLinked: delivery.filter((project) => project.smartTenderId).length,
    deliveryStatuses: countBy(delivery.map((project) => project.status || "Без статусу")),
    deliveryEntities: countBy(delivery.map((project) => normalizeEntity(project.entity))),
    deliveryManagers: countBy(delivery.filter((project) => project.manager).map((project) => project.manager)),
  };
}

/**
 * @param {{ pipeline?: Buffer | null, delivery?: Buffer | null }} sources
 * @param {{ exportedAt: string, source?: string }} options
 * @returns {Promise<ProjectsSnapshot>}
 */
export async function parseProjectWorkbooks(sources, options) {
  /** @type {PipelineProject[]} */
  let pipeline = [];
  /** @type {DeliveryProject[]} */
  let delivery = [];

  if (sources.pipeline) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(/** @type {any} */ (sources.pipeline));
    const sheet = workbook.getWorksheet("Sheet1") ?? workbook.worksheets[0];
    if (sheet) pipeline = parsePipelineSheet(sheet);
  }

  if (sources.delivery) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(/** @type {any} */ (sources.delivery));
    const sheet = workbook.getWorksheet("2026") ?? workbook.worksheets[0];
    if (sheet) delivery = parseDeliverySheet(sheet);
  }

  return {
    exportedAt: options.exportedAt,
    source: options.source ?? "SharePoint · CRM_Dev · Tenders/Excels",
    available: { pipeline: pipeline.length > 0, delivery: delivery.length > 0 },
    summary: summarize(pipeline, delivery),
    pipeline,
    delivery,
  };
}
