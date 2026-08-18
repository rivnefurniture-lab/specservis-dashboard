import "server-only";

import { buildMarketSnapshot } from "../../scripts/lib/market-builder.mjs";
import { acquireMarketRefreshLease, getMarketCoverage, isBlobConfigured, saveMarketSnapshot } from "@/lib/market-store";
import { getSharePointData } from "@/lib/sharepoint";
import type { MarketCoverageSnapshot } from "@/lib/types";

/** Скільки останніх днів переобходимо за одне оновлення. */
const DEFAULT_CRAWL_DAYS = 3;
const MIN_CRAWL_DAYS = 1;
const MAX_CRAWL_DAYS = 7;

export type RefreshFailureReason = "busy" | "configuration" | "storage";

export type RefreshResult = {
  ok: boolean;
  startedAt: string;
  finishedAt: string;
  durationSeconds: number;
  crawlDays: number;
  crawled: number;
  added: number;
  updated: number;
  droppedOutOfWindow: number;
  failures: number;
  generatedAt: string;
  published: boolean;
  reason?: RefreshFailureReason;
  message: string;
};

/**
 * Один запуск за раз у межах теплого екземпляра.
 *
 * Розподілена lease у Blob нижче захищає між різними Vercel Functions. Цей
 * Promise лише дозволяє двом запитам одного екземпляра дочекатися спільного
 * результату без зайвого звернення до Blob.
 */
let running: Promise<RefreshResult> | null = null;

async function run(crawlDays: number): Promise<RefreshResult> {
  const startedAt = new Date();

  if (!Number.isInteger(crawlDays) || crawlDays < MIN_CRAWL_DAYS || crawlDays > MAX_CRAWL_DAYS) {
    const finishedAt = new Date();
    return {
      ok: false,
      reason: "configuration",
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationSeconds: 0,
      crawlDays,
      crawled: 0, added: 0, updated: 0, droppedOutOfWindow: 0, failures: 0,
      generatedAt: "",
      published: false,
      message: `MARKET_REFRESH_DAYS має бути цілим числом від ${MIN_CRAWL_DAYS} до ${MAX_CRAWL_DAYS}.`,
    };
  }

  if (!isBlobConfigured()) {
    const finishedAt = new Date();
    return {
      ok: false,
      reason: "storage",
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationSeconds: 0,
      crawlDays,
      crawled: 0, added: 0, updated: 0, droppedOutOfWindow: 0, failures: 0,
      generatedAt: "",
      published: false,
      message: "Сховище зрізів не підключене, тому оновлювати нема куди. Потрібен Vercel Blob (BLOB_READ_WRITE_TOKEN).",
    };
  }

  const lease = await acquireMarketRefreshLease();
  if (!lease) {
    const finishedAt = new Date();
    return {
      ok: false,
      reason: "busy",
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationSeconds: 0,
      crawlDays,
      crawled: 0, added: 0, updated: 0, droppedOutOfWindow: 0, failures: 0,
      generatedAt: "",
      published: false,
      message: "Оновлення ринку вже виконується іншим процесом. Повторний обхід не запущено.",
    };
  }

  try {
    const { snapshot: internal } = await getSharePointData();
    const { coverage: base } = await getMarketCoverage(internal);
    const { snapshot, stats } = await buildMarketSnapshot({
      username: process.env.SMARTTENDER_USERNAME ?? "",
      password: process.env.SMARTTENDER_PASSWORD ?? "",
      crawlDays,
      internalTenders: internal.tenders,
      base,
      pageConcurrency: Number(process.env.MARKET_PAGE_CONCURRENCY ?? 8),
      detailConcurrency: Number(process.env.MARKET_DETAIL_CONCURRENCY ?? 6),
    }) as unknown as { snapshot: MarketCoverageSnapshot & { refresh: { added: number; updated: number; droppedOutOfWindow: number } }; stats: { crawled: number; failures: number } };

    const saved = await saveMarketSnapshot(snapshot);
    const finishedAt = new Date();
    const durationSeconds = Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000);

    return {
      ok: true,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationSeconds,
      crawlDays,
      crawled: stats.crawled,
      added: snapshot.refresh.added,
      updated: snapshot.refresh.updated,
      droppedOutOfWindow: snapshot.refresh.droppedOutOfWindow,
      failures: stats.failures,
      generatedAt: snapshot.generatedAt,
      published: saved.published,
      message: saved.published
        ? `Перевірено ${crawlDays} останніх днів Prozorro за ${durationSeconds} с: ${snapshot.refresh.added} нових закупівель у зрізі, ${snapshot.refresh.updated} оновлено.`
        : "Обхід завершено, але новіший зріз уже був опублікований іншим процесом. Поточний зріз не замінено.",
    };
  } finally {
    try {
      await lease.release();
    } catch (error) {
      console.error("Market refresh lease release failed", error instanceof Error ? error.message : "Unknown error");
    }
  }
}

export function refreshMarket(crawlDays = Number(process.env.MARKET_REFRESH_DAYS ?? DEFAULT_CRAWL_DAYS)) {
  if (running) return running;
  running = run(crawlDays).finally(() => { running = null; });
  return running;
}
