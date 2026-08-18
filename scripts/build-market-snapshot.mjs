// @ts-check

/**
 * Повний обхід ринку Prozorro і запис вбудованого зрізу.
 *
 * Триває десятки хвилин, тому запускається руками:
 *   node --env-file=.env.local scripts/build-market-snapshot.mjs
 *
 * Часткове оновлення останніх днів робить застосунок сам — щотригодинним
 * планувальником і кнопкою «Оновити». Обидва шляхи ділять один код у
 * `lib/market-builder.mjs`, тому дані не розходяться.
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildMarketSnapshot, summarize } from "./lib/market-builder.mjs";

const internalSnapshot = JSON.parse(await readFile(path.join(process.cwd(), "src/data/internal-snapshot.json"), "utf8"));

const { snapshot, stats } = await buildMarketSnapshot({
  username: process.env.SMARTTENDER_USERNAME ?? "",
  password: process.env.SMARTTENDER_PASSWORD ?? "",
  endDate: process.env.MARKET_SNAPSHOT_END ?? new Date().toISOString().slice(0, 10),
  crawlDays: Number(process.env.MARKET_HISTORY_DAYS ?? 31),
  internalTenders: internalSnapshot.tenders,
  closedCap: Number(process.env.MARKET_CLOSED_CAP ?? 400),
  pageConcurrency: Number(process.env.MARKET_PAGE_CONCURRENCY ?? 8),
  detailConcurrency: Number(process.env.MARKET_DETAIL_CONCURRENCY ?? 4),
  log: (message) => console.log(message),
});

const outputPath = path.join(process.cwd(), "src/data/market-snapshot.json");
await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`);
const totals = summarize(snapshot.tenders);
console.log(`saved ${outputPath}`);
console.log(JSON.stringify({
  ...stats,
  retention: snapshot.retention,
  targetOpen: totals.seen + totals.missed,
  seen: totals.seen,
  missed: totals.missed,
  outsideScope: totals.outsideScope,
  unknownTerritory: totals.unknownTerritory,
}, null, 2));
