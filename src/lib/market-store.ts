import "server-only";

import { randomUUID } from "node:crypto";
import { BlobPreconditionFailedError, del, get, list, put } from "@vercel/blob";
import bundledMarket from "@/data/market-snapshot.json";
import { applyCoverage, buildDaily } from "../../scripts/lib/market-builder.mjs";
import type { InternalSnapshot, MarketCoveragePoint, MarketCoverageSnapshot, MarketCoverageTender } from "@/lib/types";

const LEGACY_BLOB_PREFIX = "market/snapshot";
const VERSION_PREFIX = "market-data/v2/versions/";
const CURRENT_PATH = "market-data/v2/current.json";
const REFRESH_LOCK_PATH = "market-data/v2/refresh-lock.json";
const REFRESH_LEASE_MS = 6 * 60 * 1000;
const VERSIONS_TO_KEEP = 3;

/**
 * Зріз ринку живе поза кодом.
 *
 * Він важить майже три мегабайти і оновлюється кожні три години, тому тримати
 * його у файлі застосунку не можна: працюючий сайт не може переписати власний
 * білд. Тому свіжий зріз лежить у Vercel Blob, а вбудований файл лишається
 * запасним варіантом на випадок, коли сховище ще порожнє або недоступне.
 *
 * У сховище пишуться **лише ринкові факти**. Усе, що стосується «чи веде це
 * команда» — `seenByTeam`, `coverageStatus`, звʼязок із рядком Excel — свідомо
 * не зберігається: по-перше, це внутрішня інформація, якій нема чого лежати в
 * publicly-readable сховищі; по-друге, вона застаріває тієї ж миті, коли хтось
 * редагує закупівлі.xlsx. Тому вона рахується наново на кожному запиті.
 */
type StoredMarket = Omit<MarketCoverageSnapshot, "tenders" | "daily"> & {
  tenders: Array<Omit<MarketCoverageTender, "seenByTeam" | "teamSource" | "matchedInternalId" | "coverageStatus" | "coverageNote">>;
};

const coverageFields = ["seenByTeam", "teamSource", "matchedInternalId", "coverageStatus", "coverageNote"] as const;

function stripCoverage(snapshot: MarketCoverageSnapshot): StoredMarket {
  // `daily` теж не зберігається: це похідні підсумки, які залежать від статусу
  // покриття, а він перераховується на кожному запиті.
  const copy = { ...snapshot } as Partial<MarketCoverageSnapshot>;
  delete copy.daily;
  delete copy.tenders;
  return {
    ...(copy as Omit<MarketCoverageSnapshot, "daily" | "tenders">),
    tenders: snapshot.tenders.map((tender) => {
      const copy = { ...tender } as Record<string, unknown>;
      for (const field of coverageFields) delete copy[field];
      return copy as StoredMarket["tenders"][number];
    }),
  };
}

export function isBlobConfigured() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

let storedCache: { url: string; snapshot: StoredMarket } | null = null;

type CurrentMarketPointer = {
  url: string;
  generatedAt: string;
};

type RefreshLock = {
  owner: string;
  acquiredAt: string;
  expiresAt: string;
};

type JsonBlob<T> = {
  value: T;
  etag: string;
};

async function readJsonBlob<T>(urlOrPathname: string): Promise<JsonBlob<T> | null> {
  const result = await get(urlOrPathname, { access: "public", useCache: false });
  if (!result || result.statusCode !== 200) return null;
  const value = await new Response(result.stream).json() as T;
  return { value, etag: result.blob.etag };
}

async function readSnapshotUrl(url: string): Promise<StoredMarket> {
  if (storedCache?.url === url) return storedCache.snapshot;
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Blob snapshot request failed (${response.status})`);
  const snapshot = await response.json() as StoredMarket;
  storedCache = { url, snapshot };
  return snapshot;
}

async function readCurrentStored(): Promise<StoredMarket | null> {
  const pointer = await readJsonBlob<CurrentMarketPointer>(CURRENT_PATH);
  if (!pointer?.value.url || !Number.isFinite(Date.parse(pointer.value.generatedAt))) return null;
  return readSnapshotUrl(pointer.value.url);
}

async function readLegacyStored(): Promise<StoredMarket | null> {
  const { blobs } = await list({ prefix: LEGACY_BLOB_PREFIX, limit: 20 });
  if (!blobs.length) return null;
  const newest = [...blobs].sort((left, right) => right.uploadedAt.getTime() - left.uploadedAt.getTime())[0];
  return readSnapshotUrl(newest.url);
}

/** Найсвіжіший збережений зріз або `null`, якщо сховище порожнє чи вимкнене. */
async function readStored(): Promise<StoredMarket | null> {
  if (!isBlobConfigured()) return null;
  const [currentResult, legacyResult] = await Promise.allSettled([readCurrentStored(), readLegacyStored()]);
  const current = currentResult.status === "fulfilled" ? currentResult.value : null;
  const legacy = legacyResult.status === "fulfilled" ? legacyResult.value : null;
  if (!current && !legacy) {
    const failure = currentResult.status === "rejected" ? currentResult.reason
      : legacyResult.status === "rejected" ? legacyResult.reason
        : null;
    if (failure) throw failure;
  }
  if (!current) return legacy;
  if (!legacy) return current;
  return Date.parse(current.generatedAt) >= Date.parse(legacy.generatedAt) ? current : legacy;
}

function versionTimestamp(pathname: string) {
  const match = pathname.slice(VERSION_PREFIX.length).match(/^(\d+)-/);
  return match ? Number(match[1]) : Number.NaN;
}

async function cleanOldVersions(publishedAt: number, publishedUrl: string) {
  try {
    const { blobs } = await list({ prefix: VERSION_PREFIX, limit: 100 });
    const older = blobs
      .filter((blob) => blob.url !== publishedUrl && versionTimestamp(blob.pathname) < publishedAt)
      .sort((left, right) => versionTimestamp(right.pathname) - versionTimestamp(left.pathname))
      .slice(VERSIONS_TO_KEEP - 1);
    if (older.length) await del(older.map((blob) => blob.url));
  } catch (error) {
    // Публікація вже атомарно завершена; збій необов'язкового прибирання не
    // повинен перетворювати успішне оновлення на помилку для користувача.
    console.error("Old market snapshot cleanup failed", error instanceof Error ? error.message : "Unknown error");
  }
}

/**
 * Публікує незмінну версію зрізу через атомарний покажчик.
 *
 * Якщо два старі/нові деплої все ж завершаться одночасно, CAS на CURRENT_PATH
 * дозволить опублікувати лише новіший generatedAt. Очищення торкається тільки
 * версій, старших за щойно опубліковану, тому не може видалити новіший зріз.
 */
export async function saveMarketSnapshot(snapshot: MarketCoverageSnapshot) {
  const payload = stripCoverage(snapshot);
  const generatedAt = Date.parse(snapshot.generatedAt);
  if (!Number.isFinite(generatedAt)) throw new Error("Market snapshot generatedAt is invalid");

  const result = await put(`${VERSION_PREFIX}${generatedAt}-${randomUUID()}.json`, JSON.stringify(payload), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    cacheControlMaxAge: 60,
  });

  const pointer: CurrentMarketPointer = { url: result.url, generatedAt: snapshot.generatedAt };
  let published = false;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const current = await readJsonBlob<CurrentMarketPointer>(CURRENT_PATH);
    // Запит міг успішно записати pointer, але втратити відповідь у мережі.
    // У такому разі повторне читання доводить, що саме наша версія опублікована.
    if (current?.value.url === result.url) {
      published = true;
      break;
    }
    if (current && Date.parse(current.value.generatedAt) >= generatedAt) break;
    try {
      await put(CURRENT_PATH, JSON.stringify(pointer), {
        access: "public",
        contentType: "application/json",
        addRandomSuffix: false,
        cacheControlMaxAge: 60,
        ...(current ? { allowOverwrite: true, ifMatch: current.etag } : { allowOverwrite: false }),
      });
      published = true;
      break;
    } catch (error) {
      if (!(error instanceof BlobPreconditionFailedError) && attempt === 4) throw error;
    }
  }

  if (!published) {
    try { await del(result.url); } catch (error) {
      console.error("Unpublished market snapshot cleanup failed", error instanceof Error ? error.message : "Unknown error");
    }
    return { url: result.url, published: false };
  }

  storedCache = { url: result.url, snapshot: payload };
  await cleanOldVersions(generatedAt, result.url);
  return { url: result.url, published: true };
}

export type MarketRefreshLease = {
  release: () => Promise<void>;
};

/**
 * Розподілена lease-блокада для Vercel Functions.
 *
 * Створення та захоплення простроченого lock виконуються умовним записом.
 * Видалення теж умовне, отже старий процес не здатен зняти чужу нову lease.
 */
export async function acquireMarketRefreshLease(): Promise<MarketRefreshLease | null> {
  const owner = randomUUID();
  const now = Date.now();
  const lock: RefreshLock = {
    owner,
    acquiredAt: new Date(now).toISOString(),
    expiresAt: new Date(now + REFRESH_LEASE_MS).toISOString(),
  };

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const current = await readJsonBlob<RefreshLock>(REFRESH_LOCK_PATH);
    if (current?.value.owner === owner) {
      return {
        release: async () => {
          try { await del(REFRESH_LOCK_PATH, { ifMatch: current.etag }); } catch (error) {
            if (!(error instanceof BlobPreconditionFailedError)) throw error;
          }
        },
      };
    }
    if (current && Date.parse(current.value.expiresAt) > Date.now()) return null;

    try {
      const acquired = await put(REFRESH_LOCK_PATH, JSON.stringify(lock), {
        access: "public",
        contentType: "application/json",
        addRandomSuffix: false,
        cacheControlMaxAge: 60,
        ...(current ? { allowOverwrite: true, ifMatch: current.etag } : { allowOverwrite: false }),
      });
      return {
        release: async () => {
          try { await del(REFRESH_LOCK_PATH, { ifMatch: acquired.etag }); } catch (error) {
            if (!(error instanceof BlobPreconditionFailedError)) throw error;
          }
        },
      };
    } catch (error) {
      if (!(error instanceof BlobPreconditionFailedError) && attempt === 4) throw error;
    }
  }
  return null;
}

/**
 * Ключем кешу є пара «версія зрізу + версія Excel». Щойно змінюється будь-що з
 * двох — покриття перераховується. Це і робить правку в Excel помітною одразу.
 */
let coverageCache: { key: string; value: MarketCoverageSnapshot } | null = null;

export type MarketSource = "blob" | "bundled";

export async function getMarketCoverage(internal: InternalSnapshot): Promise<{
  coverage: MarketCoverageSnapshot;
  source: MarketSource;
  storedAt: string;
}> {
  let base: StoredMarket = bundledMarket as unknown as StoredMarket;
  let source: MarketSource = "bundled";
  try {
    const stored = await readStored();
    // Вбудований файл виграє лише тоді, коли він новіший за збережений: так
    // свіжий деплой із перебудованим зрізом не відкочується до старого блоба.
    if (stored && Date.parse(stored.generatedAt) >= Date.parse(bundledMarket.generatedAt)) {
      base = stored;
      source = "blob";
    }
  } catch (error) {
    console.error("Market blob read failed", error instanceof Error ? error.message : "Unknown error");
  }

  const key = `${base.generatedAt}|${internal.exportedAt}|${internal.summary.totalCount}`;
  if (coverageCache?.key === key) return { coverage: coverageCache.value, source, storedAt: base.generatedAt };

  const tenders = applyCoverage(base.tenders, internal.tenders) as MarketCoverageTender[];
  const coverage: MarketCoverageSnapshot = {
    ...(base as unknown as MarketCoverageSnapshot),
    daily: buildDaily(tenders, base.startDate, base.endDate) as unknown as MarketCoveragePoint[],
    tenders,
  };
  coverageCache = { key, value: coverage };
  return { coverage, source, storedAt: base.generatedAt };
}
