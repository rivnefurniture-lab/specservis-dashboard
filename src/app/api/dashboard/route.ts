import { cookies } from "next/headers";
import { after, NextResponse } from "next/server";
import { classifyCoverage } from "../../../../scripts/lib/coverage-policy.mjs";
import { isTargetTerritory } from "../../../../scripts/lib/territory.mjs";
import { toViewer, type AccountDirection } from "@/lib/accounts";
import { summarizeInternalTenders } from "@/lib/internal-summary.mjs";
import { getLivePulse } from "@/lib/smarttender";
import { sessionAccount, sessionCookie } from "@/lib/auth";
import { buildCompetitorRadar, buildOwnerControl } from "@/lib/owner-intelligence";
import { getMarketCoverage } from "@/lib/market-store";
import { getSharePointData } from "@/lib/sharepoint";
import type { Direction, InternalSnapshot, LivePulse, MarketCoverageSnapshot, MarketCoverageTender, MarketCoverageTenderView } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const LIVE_WAIT_MILLISECONDS = 4_000;

const directions: Array<Exclude<Direction, "Інше">> = ["Капбудівництво", "Сервіс", "Кондиціонування"];

function filterSnapshot(snapshot: InternalSnapshot, direction: AccountDirection | null): InternalSnapshot {
  if (!direction) return snapshot;
  const tenders = snapshot.tenders.filter((tender) => tender.direction === direction);
  return { ...snapshot, summary: summarizeInternalTenders(tenders), tenders };
}

function snapshotForClient(snapshot: InternalSnapshot, role: "owner" | "manager" | "employee") {
  if (role !== "employee") return snapshot;
  return {
    ...snapshot,
    // Конкуренти, управлінські рішення та вільні примітки мають окремий рівень
    // доступу. Працівнику для черги подач потрібні предмет, замовник, дедлайн,
    // сума й статус; решта не повинна випадково доїжджати прихованим JSON-полем.
    tenders: snapshot.tenders.map((tender) => ({
      ...tender,
      qualification: "",
      estimateNotes: "",
      decision: "",
      comment: "",
      participants: [],
    })),
  };
}

function filterCoverage(snapshot: MarketCoverageSnapshot, direction: AccountDirection | null): MarketCoverageSnapshot {
  if (!direction) return snapshot;
  const empty = { market: 0, seen: 0, missed: 0, needsReview: 0, untracked: 0, unavailable: 0, outsideScope: 0, unknownTerritory: 0, marketValue: 0, seenValue: 0, missedValue: 0, needsReviewValue: 0, untrackedValue: 0, unavailableValue: 0, outsideScopeValue: 0, unknownTerritoryValue: 0 };
  return {
    ...snapshot,
    daily: snapshot.daily.map((point) => ({
      date: point.date,
      ...point.byDirection[direction],
      byDirection: Object.fromEntries(directions.map((item) => [item, item === direction ? point.byDirection[item] : empty])) as MarketCoverageSnapshot["daily"][number]["byDirection"],
    })),
    tenders: snapshot.tenders.filter((tender) => tender.direction === direction),
  };
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^а-яіїєґa-z0-9]+/gi, " ").replace(/\s+/g, " ").trim();
}

function seenInSharePoint(tender: LivePulse["tenders"][number], snapshot: InternalSnapshot) {
  const marketTitle = normalize(tender.title);
  return snapshot.tenders.find((item) => {
    const internalTitle = normalize(item.title);
    const amountDelta = tender.amount > 0 && item.value > 0 ? Math.abs(tender.amount - item.value) / tender.amount : 1;
    const sameBuyer = tender.buyerEdrpou && tender.buyerEdrpou === item.buyerEdrpou;
    const nearTitle = marketTitle.length > 24 && internalTitle.length > 24 && (marketTitle.includes(internalTitle) || internalTitle.includes(marketTitle));
    return nearTitle || (sameBuyer && amountDelta <= 0.02);
  });
}

function summarize(items: MarketCoverageTender[]) {
  const open = items.filter((item) => item.actionable && isTargetTerritory(item));
  const seen = open.filter((item) => item.coverageStatus === "seen");
  const missed = open.filter((item) => item.coverageStatus === "missed");
  const needsReview = open.filter((item) => item.coverageStatus === "review");
  const untracked = open.filter((item) => item.coverageStatus === "untracked");
  const unavailable = items.filter((item) => !item.actionable);
  const outsideScope = items.filter((item) => item.actionable && item.territoryStatus === "outside");
  const unknownTerritory = items.filter((item) => item.actionable && item.territoryStatus === "unknown");
  return {
    market: items.length,
    seen: seen.length,
    missed: missed.length,
    needsReview: needsReview.length,
    untracked: untracked.length,
    unavailable: unavailable.length,
    outsideScope: outsideScope.length,
    unknownTerritory: unknownTerritory.length,
    marketValue: items.reduce((sum, item) => sum + item.amount, 0),
    seenValue: seen.reduce((sum, item) => sum + item.amount, 0),
    missedValue: missed.reduce((sum, item) => sum + item.amount, 0),
    needsReviewValue: needsReview.reduce((sum, item) => sum + item.amount, 0),
    untrackedValue: untracked.reduce((sum, item) => sum + item.amount, 0),
    unavailableValue: unavailable.reduce((sum, item) => sum + item.amount, 0),
    outsideScopeValue: outsideScope.reduce((sum, item) => sum + item.amount, 0),
    unknownTerritoryValue: unknownTerritory.reduce((sum, item) => sum + item.amount, 0),
  };
}

function mergeLiveMarket(base: MarketCoverageSnapshot, live: LivePulse, snapshot: InternalSnapshot): MarketCoverageSnapshot {
  if (live.status !== "online" || !live.tenders.length) return base;
  const liveRows: MarketCoverageTender[] = live.tenders.flatMap((tender) => {
    if (!tender.publishedAt || tender.direction === "Інше") return [];
    const match = seenInSharePoint(tender, snapshot);
    const coverage = classifyCoverage({ direction: tender.direction, cpvCode: tender.cpv[0] ?? "", seenByTeam: Boolean(match) });
    return [{
      id: tender.id,
      cdbNumber: tender.cdbNumber,
      cpvCode: tender.cpv[0] ?? "",
      title: tender.title,
      buyer: tender.buyer,
      buyerEdrpou: tender.buyerEdrpou,
      publishedAt: tender.publishedAt.slice(0, 10),
      deadline: tender.deadline,
      amount: tender.amount,
      status: tender.status,
      direction: tender.direction,
      relevanceReason: `live-profile:${tender.direction}`,
      prozorroUrl: tender.prozorroUrl,
      actionable: /прийом пропозицій|період уточнень|активна/i.test(tender.status),
      seenByTeam: Boolean(match),
      teamSource: match ? "SharePoint · закупівлі.xlsx" : null,
      matchedInternalId: match?.id ?? null,
      coverageStatus: coverage.coverageStatus as MarketCoverageTender["coverageStatus"],
      coverageNote: coverage.coverageNote,
      organizerRegion: tender.organizerRegion,
      deliveryRegions: tender.deliveryRegions,
      territoryStatus: tender.territoryStatus,
      territoryLabel: tender.territoryLabel,
      territorySource: tender.territorySource,
    }];
  });
  const currentDate = liveRows[0]?.publishedAt;
  if (!currentDate) return base;
  const merged = new Map(base.tenders.map((item) => [item.cdbNumber || item.id, item]));
  liveRows.forEach((item) => {
    const key = item.cdbNumber || item.id;
    const existing = merged.get(key);
    if (existing && item.territoryStatus === "unknown" && existing.territoryStatus !== "unknown") {
      merged.set(key, {
        ...existing,
        ...item,
        deliveryRegions: existing.deliveryRegions,
        territoryStatus: existing.territoryStatus,
        territoryLabel: existing.territoryLabel,
        territorySource: existing.territorySource,
      });
    } else {
      merged.set(key, item);
    }
  });
  const mergedTenders = [...merged.values()];
  const currentItems = mergedTenders.filter((item) => item.publishedAt === currentDate);
  const currentPoint = {
    date: currentDate,
    ...summarize(currentItems),
    byDirection: Object.fromEntries(directions.map((direction) => [direction, summarize(currentItems.filter((item) => item.direction === direction))])),
  } as MarketCoverageSnapshot["daily"][number];
  const daily = base.daily.some((point) => point.date === currentDate)
    ? base.daily.map((point) => point.date === currentDate ? currentPoint : point)
    : [...base.daily, currentPoint].sort((left, right) => left.date.localeCompare(right.date));
  return {
    ...base,
    generatedAt: live.fetchedAt,
    endDate: currentDate > base.endDate ? currentDate : base.endDate,
    daily,
    tenders: mergedTenders,
  };
}

async function getLivePulseWithoutBlocking(): Promise<LivePulse> {
  const livePromise = getLivePulse();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const fallback = new Promise<LivePulse>((resolve) => {
    timeout = setTimeout(() => resolve({
      fetchedAt: new Date().toISOString(),
      status: "degraded",
      message: "Показано перевірений зріз; live-оновлення готується у фоні",
      scanned: 0,
      relevant: 0,
      highPriority: 0,
      totalValue: 0,
      tenders: [],
    }), LIVE_WAIT_MILLISECONDS);
  });
  const live = await Promise.race([livePromise, fallback]);
  if (timeout) clearTimeout(timeout);
  if (live.status === "degraded" && !live.tenders.length) {
    after(async () => {
      await livePromise;
    });
  }
  return live;
}

/**
 * Клієнту віддаються лише ті поля ринкового тендера, які реально малюються.
 * Службові (CPV, ЄДРПОУ замовника, привід релевантності, джерело збігу) потрібні
 * серверу для розрахунків, але щоразу тягнути їх у браузер — це мегабайти дарма.
 */
function toClientTender(tender: MarketCoverageTender): MarketCoverageTenderView {
  return {
    id: tender.id,
    cdbNumber: tender.cdbNumber,
    title: tender.title,
    buyer: tender.buyer,
    publishedAt: tender.publishedAt,
    deadline: tender.deadline,
    amount: tender.amount,
    direction: tender.direction,
    prozorroUrl: tender.prozorroUrl,
    actionable: tender.actionable,
    seenByTeam: tender.seenByTeam,
    coverageStatus: tender.coverageStatus,
    coverageNote: tender.coverageNote,
    territoryStatus: tender.territoryStatus,
    territoryLabel: tender.territoryLabel,
  };
}

export async function GET() {
  const cookieStore = await cookies();
  const account = sessionAccount(cookieStore.get(sessionCookie.name)?.value);
  if (!account) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [live, sharePointData] = await Promise.all([getLivePulseWithoutBlocking(), getSharePointData()]);
  const permittedDirection = account.role === "owner" ? null : account.direction;
  const snapshot = filterSnapshot(sharePointData.snapshot, permittedDirection);
  const visibleLive = permittedDirection
    ? {
        ...live,
        tenders: live.tenders.filter((tender) => tender.direction === permittedDirection),
      }
    : live;
  visibleLive.relevant = visibleLive.tenders.length;
  visibleLive.highPriority = visibleLive.tenders.filter((tender) => tender.relevanceLabel === "Висока").length;
  visibleLive.totalValue = visibleLive.tenders.reduce((sum, tender) => sum + tender.amount, 0);
  const sharePointSync = permittedDirection ? { ...sharePointData.sharePointSync, records: snapshot.tenders.length } : sharePointData.sharePointSync;
  // Покриття рахується тут і зараз проти того Excel, що лежить у SharePoint у
  // цю секунду, а не береться замороженим зі зрізу. Тому доданий у файл рядок
  // прибирає закупівлю зі списку «підтверджено не в Excel» одразу.
  const { coverage: liveCoverage, source: marketSource, storedAt: marketStoredAt } = await getMarketCoverage(snapshot);
  const coverage = filterCoverage(mergeLiveMarket(liveCoverage, visibleLive, snapshot), permittedDirection);
  const control = buildOwnerControl(snapshot);
  const competitorRadar = account.role === "employee"
    ? { total: 0, fromInternal: 0, discoveries: 0, participantCoverage: 0, byDirection: [], items: [] }
    : buildCompetitorRadar(snapshot);
  return NextResponse.json(
    {
      viewer: toViewer(account),
      snapshot: snapshotForClient(snapshot, account.role),
      sharePointSync,
      coverage: { ...coverage, tenders: coverage.tenders.map(toClientTender), storedAt: marketStoredAt, storedSource: marketSource },
      live: { ...visibleLive, tenders: [] },
      control,
      competitorRadar,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
