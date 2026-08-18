// @ts-check

/**
 * Збирає вбудовану копію реєстрів проєктів із SharePoint (сайт CRM_Dev, тека
 * Tenders/Excels) — це резерв на випадок, коли Graph недоступний.
 *
 * Запуск (секрети передаються файлом, а не аргументами, щоб не потрапити в
 * історію команд і в список процесів):
 *   node --env-file=<файл> scripts/build-projects-snapshot.mjs
 *
 * Або з локальних копій, без мережі:
 *   node scripts/build-projects-snapshot.mjs <ПЕРЕЛІК-BITRIX.xlsx> <Реалізація.xlsx>
 */

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { parseProjectWorkbooks } from "../src/lib/projects-parser.mjs";

const HOSTNAME = process.env.SHAREPOINT_HOSTNAME ?? "specservis.sharepoint.com";
const SITE_PATH = process.env.SHAREPOINT_SITE_PATH ?? "/sites/CRM_Dev";
const FOLDER = process.env.SHAREPOINT_FOLDER ?? "Tenders/Excels";
const PIPELINE_FILE = process.env.SHAREPOINT_PIPELINE_FILE ?? "ПЕРЕЛІК-BITRIX копия.xlsx";
const DELIVERY_FILE = process.env.SHAREPOINT_DELIVERY_FILE ?? "Реалізація проєктів 1111.xlsx";

const outputPath = resolve(dirname(fileURLToPath(import.meta.url)), "../src/data/projects-snapshot.json");

async function graphToken() {
  const body = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID ?? "",
    client_secret: process.env.MICROSOFT_CLIENT_SECRET ?? "",
    grant_type: "client_credentials",
    scope: "https://graph.microsoft.com/.default",
  });
  const response = await fetch(
    `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID}/oauth2/v2.0/token`,
    { method: "POST", body },
  );
  if (!response.ok) throw new Error(`Microsoft token request failed (${response.status})`);
  const payload = await response.json();
  if (!payload.access_token) throw new Error("Microsoft token response has no access token");
  return payload.access_token;
}

/**
 * Шлях сайту треба спершу перетворити на ідентифікатор: два двокрапкових шляхи
 * в одному запиті Graph не приймає.
 * @param {string} token
 */
async function resolveSiteId(token) {
  const response = await fetch(
    `https://graph.microsoft.com/v1.0/sites/${HOSTNAME}:${SITE_PATH}?$select=id`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!response.ok) throw new Error(`Graph site request failed (${response.status})`);
  const site = await response.json();
  if (!site.id) throw new Error("Graph site response has no id");
  return site.id;
}

/** @param {string} token @param {string} siteId @param {string} fileName */
async function download(token, siteId, fileName) {
  const path = `${FOLDER}/${fileName}`.split("/").map(encodeURIComponent).join("/");
  const base = `https://graph.microsoft.com/v1.0/sites/${siteId}/drive/root:/${path}`;
  const meta = await fetch(`${base}?$select=id,name,lastModifiedDateTime`, { headers: { Authorization: `Bearer ${token}` } });
  if (!meta.ok) throw new Error(`Graph metadata request for ${fileName} failed (${meta.status})`);
  const item = await meta.json();
  const content = await fetch(`${base}:/content`, { headers: { Authorization: `Bearer ${token}` }, redirect: "follow" });
  if (!content.ok) throw new Error(`Graph content request for ${fileName} failed (${content.status})`);
  return { item, buffer: Buffer.from(await content.arrayBuffer()) };
}

async function main() {
  const [localPipeline, localDelivery] = process.argv.slice(2);
  let pipeline;
  let delivery;
  let exportedAt;
  let source;

  if (localPipeline && localDelivery) {
    pipeline = await readFile(localPipeline);
    delivery = await readFile(localDelivery);
    exportedAt = process.env.PROJECTS_EXPORTED_AT ?? new Date().toISOString();
    source = process.env.PROJECTS_SOURCE_LABEL ?? "Локальні копії реєстрів проєктів";
  } else {
    const token = await graphToken();
    const siteId = await resolveSiteId(token);
    const [p, d] = await Promise.all([download(token, siteId, PIPELINE_FILE), download(token, siteId, DELIVERY_FILE)]);
    pipeline = p.buffer;
    delivery = d.buffer;
    // Зріз не може бути свіжішим за найстаріший із файлів, з яких він зібраний.
    const dates = [p.item.lastModifiedDateTime, d.item.lastModifiedDateTime].filter(Boolean).sort();
    exportedAt = dates[0] ?? new Date().toISOString();
    source = `SharePoint · ${SITE_PATH.replace("/sites/", "")}/${FOLDER} · Microsoft Graph read-only`;
  }

  const snapshot = await parseProjectWorkbooks({ pipeline, delivery }, { exportedAt, source });
  await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");

  const s = snapshot.summary;
  const mln = (/** @type {number} */ value) => `${(value / 1e6).toFixed(1)} млн`;
  console.log(`Зріз проєктів записано: ${outputPath}`);
  console.log(`  джерело: ${source} (${exportedAt})`);
  console.log(`  воронка: ${s.pipelineCount} проєктів, ${s.pipelineActive} активних, бюджет ${mln(s.pipelineBudget)}`);
  console.log(`  відповідальні: ${s.withResponsible} призначено, ${s.withoutResponsible} без відповідального`);
  console.log(`  стадій поза довідником: ${s.unrecognisedStages}`);
  console.log(`  реалізація: ${s.deliveryCount} рядків, ${s.deliveryContracted} із сумою договору на ${mln(s.deliveryContractValue)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
