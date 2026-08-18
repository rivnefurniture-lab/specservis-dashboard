import "server-only";

import snapshotJson from "@/data/competitor-snapshot.json";
import type { Direction, TerritoryStatus } from "@/lib/types";

/**
 * Зріз конкурентів зберігається нормалізовано (закупівлі / компанії / ставки),
 * тому будь-який період рахується з первинних рядків Prozorro, а не з готових
 * підсумків за все вікно. Це дозволяє чесно відповісти «за 31 день», не вигадуючи
 * пропорцій із 120-денних агрегатів.
 */

export type CompetitorSnapshotFile = {
  generatedAt: string;
  source: string;
  method: string;
  startDate: string;
  endDate: string;
  days: number;
  scanned: { searched: number; competitiveRelevant: number; withBids: number };
  failureCount: number;
  totals: {
    companies: number;
    tendersAnalysed: number;
    bidRows: number;
    contestedTenders: number;
    averageBidders: number;
    awardedValue: number;
    specservisBids: number;
  };
  companies: Array<{
    key: string;
    edrpou: string;
    name: string;
    aliases: string[];
    region: string;
    locality: string;
    isSpecservis: boolean;
  }>;
  tenders: Array<{
    cdbNumber: string;
    title: string;
    buyer: string;
    buyerEdrpou: string;
    direction: Exclude<Direction, "Інше">;
    cpvCode: string;
    publishedAt: string;
    announcedAmount: number;
    status: string;
    method: string;
    territoryStatus: TerritoryStatus;
    territoryLabel: string;
    territorySource: string;
    bidders: number;
    prozorroUrl: string;
  }>;
  bids: Array<{
    t: number;
    c: number;
    amount: number;
    won: boolean;
    disqualified: boolean;
    contractValue: number;
    contractSigned: string | null;
    vsSpecservis: boolean;
  }>;
};

export type CompetitorRow = {
  key: string;
  name: string;
  edrpou: string;
  region: string;
  locality: string;
  isSpecservis: boolean;
  participations: number;
  wins: number;
  /** Програші лише там, де замовник уже ухвалив рішення. */
  losses: number;
  /** Ставки в процедурах, які ще тривають: переможця немає — і це не програш. */
  pending: number;
  disqualified: number;
  /** wins ÷ (wins + losses). Незавершені процедури у знаменник не входять. */
  winRate: number;
  bidValue: number;
  wonValue: number;
  soloWins: number;
  contestedWins: number;
  directions: Array<{ name: Exclude<Direction, "Інше">; value: number }>;
  targetTerritory: number;
  /** Скільки разів подавалися на ту саму закупівлю, що й Спецсервіс. */
  metSpecservis: number;
  /** З них виграв конкурент. */
  beatSpecservis: number;
  /** З них виграв саме Спецсервіс (а не будь-хто третій). */
  lostToSpecservis: number;
  firstSeen: string;
  lastSeen: string;
};

export type CompetitorTenderRow = {
  cdbNumber: string;
  title: string;
  buyer: string;
  direction: Exclude<Direction, "Інше">;
  publishedAt: string;
  announcedAmount: number;
  bidAmount: number;
  contractValue: number;
  won: boolean;
  /** Чи вже є рішення замовника; якщо ні — це ще не програш. */
  decided: boolean;
  disqualified: boolean;
  rivals: number;
  territoryLabel: string;
  territoryStatus: TerritoryStatus;
  againstSpecservis: boolean;
  prozorroUrl: string;
};

export type CompetitorQuery = {
  days?: number;
  direction?: Exclude<Direction, "Інше"> | null;
  territory?: "all" | "target";
  search?: string;
  sort?: "wonValue" | "wins" | "participations" | "winRate" | "vsUs";
  page?: number;
  limit?: number;
};

const snapshot = snapshotJson as unknown as CompetitorSnapshotFile;

/**
 * Процедура вважається вирішеною, коли замовник закрив її. Поки вона триває,
 * відсутність перемоги не означає програш — інакше кожен свіжий тендер псував би
 * відсоток перемог. 16 % ставок у зрізі саме такі.
 */
const isDecided = (status: string) => /Завершено|не відбул|відмінен/i.test(status);

/**
 * Для конкретного учасника результат відомий і тоді, коли процедура ще триває,
 * але його вже дискваліфікували: для нього це програш, а не очікування.
 */
const isSettled = (status: string, disqualified: boolean) => isDecided(status) || disqualified;

function windowStart(days: number | undefined) {
  if (!days || days >= snapshot.days) return snapshot.startDate;
  const end = Date.parse(`${snapshot.endDate}T00:00:00Z`);
  return new Date(end - (days - 1) * 86_400_000).toISOString().slice(0, 10);
}

type Accumulator = CompetitorRow & { firstSeen: string; lastSeen: string };

/**
 * Закупівлі, де переміг саме Спецсервіс. Потрібні, щоб «ми обійшли» означало
 * нашу перемогу, а не просто те, що конкурент не виграв: у тендері міг перемогти
 * хтось третій або рішення ще немає.
 */
const specservisWonTenders = (() => {
  const ownIndex = snapshot.companies.findIndex((company) => company.isSpecservis);
  const won = new Set<number>();
  if (ownIndex < 0) return won;
  for (const bid of snapshot.bids) {
    if (bid.c === ownIndex && bid.won) won.add(bid.t);
  }
  return won;
})();

function aggregate(query: CompetitorQuery) {
  const from = windowStart(query.days);
  const rows = new Map<number, Accumulator>();
  let tendersInWindow = 0;
  let bidRows = 0;
  let contested = 0;
  let awardedValue = 0;
  let pendingBids = 0;
  const seenTenders = new Set<number>();

  for (const bid of snapshot.bids) {
    const tender = snapshot.tenders[bid.t];
    if (!tender || tender.publishedAt < from) continue;
    if (query.direction && tender.direction !== query.direction) continue;
    if (query.territory === "target" && tender.territoryStatus !== "target" && tender.territoryStatus !== "nationwide") continue;

    if (!seenTenders.has(bid.t)) {
      seenTenders.add(bid.t);
      tendersInWindow += 1;
      if (tender.bidders > 1) contested += 1;
    }
    bidRows += 1;
    if (bid.won) awardedValue += bid.contractValue || bid.amount;
    else if (!isSettled(tender.status, bid.disqualified)) pendingBids += 1;

    const company = snapshot.companies[bid.c];
    if (!company) continue;
    let row = rows.get(bid.c);
    if (!row) {
      row = {
        key: company.key,
        name: company.name,
        edrpou: company.edrpou,
        region: company.region,
        locality: company.locality,
        isSpecservis: company.isSpecservis,
        participations: 0,
        wins: 0,
        losses: 0,
        pending: 0,
        disqualified: 0,
        winRate: 0,
        bidValue: 0,
        wonValue: 0,
        soloWins: 0,
        contestedWins: 0,
        directions: [],
        targetTerritory: 0,
        metSpecservis: 0,
        beatSpecservis: 0,
        lostToSpecservis: 0,
        firstSeen: tender.publishedAt,
        lastSeen: tender.publishedAt,
      };
      rows.set(bid.c, row);
    }
    row.participations += 1;
    row.bidValue += bid.amount;
    if (bid.won) {
      row.wins += 1;
      row.wonValue += bid.contractValue || bid.amount;
      if (tender.bidders > 1) row.contestedWins += 1;
      else row.soloWins += 1;
    } else if (isSettled(tender.status, bid.disqualified)) {
      row.losses += 1;
    } else {
      row.pending += 1;
    }
    if (bid.disqualified) row.disqualified += 1;
    if (tender.territoryStatus === "target" || tender.territoryStatus === "nationwide") row.targetTerritory += 1;
    if (bid.vsSpecservis) {
      row.metSpecservis += 1;
      if (bid.won) row.beatSpecservis += 1;
      else if (specservisWonTenders.has(bid.t)) row.lostToSpecservis += 1;
    }
    const direction = row.directions.find((item) => item.name === tender.direction);
    if (direction) direction.value += 1;
    else row.directions.push({ name: tender.direction, value: 1 });
    if (tender.publishedAt < row.firstSeen) row.firstSeen = tender.publishedAt;
    if (tender.publishedAt > row.lastSeen) row.lastSeen = tender.publishedAt;
  }

  const items = [...rows.values()].map((row) => ({
    ...row,
    winRate: row.wins + row.losses ? Math.round((row.wins / (row.wins + row.losses)) * 1000) / 10 : 0,
    directions: row.directions.sort((left, right) => right.value - left.value),
  }));

  return { from, items, totals: { tendersInWindow, bidRows, contested, awardedValue, pendingBids } };
}

const sorters: Record<NonNullable<CompetitorQuery["sort"]>, (left: CompetitorRow, right: CompetitorRow) => number> = {
  wonValue: (left, right) => right.wonValue - left.wonValue || right.wins - left.wins,
  wins: (left, right) => right.wins - left.wins || right.wonValue - left.wonValue,
  participations: (left, right) => right.participations - left.participations || right.wonValue - left.wonValue,
  winRate: (left, right) => right.winRate - left.winRate || right.participations - left.participations,
  vsUs: (left, right) => right.metSpecservis - left.metSpecservis || right.beatSpecservis - left.beatSpecservis,
};

export function listCompetitors(query: CompetitorQuery) {
  const { from, items, totals } = aggregate(query);
  const needle = query.search?.trim().toLowerCase() ?? "";
  const filtered = needle
    ? items.filter((item) => `${item.name} ${item.edrpou} ${item.region} ${item.locality}`.toLowerCase().includes(needle))
    : items;
  const sorted = [...filtered].sort(sorters[query.sort ?? "wonValue"]);
  const limit = Math.min(Math.max(query.limit ?? 30, 1), 200);
  const page = Math.max(query.page ?? 1, 1);
  const own = items.find((item) => item.isSpecservis) ?? null;
  // Частка без місця в рейтингу мало що каже, тому рахуємо ранг за сумою договорів.
  const byValue = [...items].sort(sorters.wonValue);
  const ownRank = own ? byValue.findIndex((item) => item.isSpecservis) + 1 : null;
  const top5Value = byValue.slice(0, 5).reduce((sum, item) => sum + item.wonValue, 0);

  return {
    window: { from, to: snapshot.endDate, days: query.days ?? snapshot.days, fullDays: snapshot.days },
    generatedAt: snapshot.generatedAt,
    method: snapshot.method,
    source: snapshot.source,
    scanned: snapshot.scanned,
    failureCount: snapshot.failureCount,
    totals: {
      companies: filtered.length,
      companiesAllPeriod: snapshot.totals.companies,
      tenders: totals.tendersInWindow,
      bids: totals.bidRows,
      contested: totals.contested,
      averageBidders: totals.tendersInWindow ? Math.round((totals.bidRows / totals.tendersInWindow) * 100) / 100 : 0,
      awardedValue: totals.awardedValue,
      pendingBids: totals.pendingBids,
      /** Яку частку всіх укладених договорів зрізу тримає перша пʼятірка. */
      top5Share: totals.awardedValue ? Math.round((top5Value / totals.awardedValue) * 1000) / 10 : 0,
    },
    own,
    ownRank,
    ownShare: own && totals.awardedValue ? Math.round((own.wonValue / totals.awardedValue) * 1000) / 10 : 0,
    page,
    pageCount: Math.max(Math.ceil(sorted.length / limit), 1),
    total: sorted.length,
    items: sorted.slice((page - 1) * limit, page * limit),
  };
}

export function competitorDetail(key: string, query: CompetitorQuery) {
  const from = windowStart(query.days);
  const companyIndex = snapshot.companies.findIndex((company) => company.key === key);
  if (companyIndex < 0) return null;
  const company = snapshot.companies[companyIndex];
  const summary = aggregate(query).items.find((item) => item.key === key) ?? null;

  const tenders: CompetitorTenderRow[] = [];
  for (const bid of snapshot.bids) {
    if (bid.c !== companyIndex) continue;
    const tender = snapshot.tenders[bid.t];
    if (!tender || tender.publishedAt < from) continue;
    if (query.direction && tender.direction !== query.direction) continue;
    tenders.push({
      cdbNumber: tender.cdbNumber,
      title: tender.title,
      buyer: tender.buyer,
      direction: tender.direction,
      publishedAt: tender.publishedAt,
      announcedAmount: tender.announcedAmount,
      bidAmount: bid.amount,
      contractValue: bid.contractValue,
      won: bid.won,
      decided: isSettled(tender.status, bid.disqualified),
      disqualified: bid.disqualified,
      rivals: tender.bidders,
      territoryLabel: tender.territoryLabel,
      territoryStatus: tender.territoryStatus,
      againstSpecservis: bid.vsSpecservis,
      prozorroUrl: tender.prozorroUrl,
    });
  }
  tenders.sort((left, right) => right.publishedAt.localeCompare(left.publishedAt) || right.bidAmount - left.bidAmount);

  const buyers = new Map<string, { name: string; count: number; won: number }>();
  for (const tender of tenders) {
    const current = buyers.get(tender.buyer) ?? { name: tender.buyer, count: 0, won: 0 };
    current.count += 1;
    if (tender.won) current.won += 1;
    buyers.set(tender.buyer, current);
  }

  return {
    company: { ...company, ...summary },
    topBuyers: [...buyers.values()].sort((left, right) => right.count - left.count).slice(0, 6),
    tenders,
  };
}

export const competitorSnapshotMeta = {
  generatedAt: snapshot.generatedAt,
  startDate: snapshot.startDate,
  endDate: snapshot.endDate,
  days: snapshot.days,
};
