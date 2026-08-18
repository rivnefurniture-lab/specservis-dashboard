import "server-only";

import snapshotJson from "@/data/competitor-snapshot.json";
import type { CompetitorSnapshotFile } from "@/lib/competitors";
import type { AnalyticsV2Input } from "@/lib/analytics-v2-engine";

const snapshot = snapshotJson as unknown as CompetitorSnapshotFile;

function buyerId(tender: CompetitorSnapshotFile["tenders"][number]) {
  return tender.buyerEdrpou || `buyer:${tender.buyer.trim().toLocaleLowerCase("uk-UA")}`;
}

export function legacyCompetitorAnalyticsInput(): AnalyticsV2Input {
  const tenders = snapshot.tenders.map((tender, index) => ({
    id: `legacy:tender:${index}`,
    externalTenderId: tender.cdbNumber,
    prozorroUrl: tender.prozorroUrl,
    title: tender.title,
    publishedAt: tender.publishedAt,
    buyerId: buyerId(tender),
    buyerName: tender.buyer,
    procedureType: tender.method,
    status: tender.status,
    expectedAmount: Number.isFinite(tender.announcedAmount) ? tender.announcedAmount : null,
    expectedCurrency: "UAH",
    awardDataComplete: false,
    direct: false,
    direction: tender.direction,
    cpv: tender.cpvCode,
  }));
  const lots = tenders.map((tender, index) => ({
    id: `legacy:lot:${index}`,
    tenderId: tender.id,
    title: snapshot.tenders[index]?.title ?? null,
    expectedAmount: Number.isFinite(snapshot.tenders[index]?.announcedAmount) ? snapshot.tenders[index].announcedAmount : null,
    expectedCurrency: "UAH",
  }));
  const bids = snapshot.bids.flatMap((bid, index) => {
    const company = snapshot.companies[bid.c];
    const tender = snapshot.tenders[bid.t];
    if (!company || !tender || !lots[bid.t]) return [];
    return [{
      id: `legacy:bid:${index}`,
      lotId: lots[bid.t].id,
      supplierId: company.edrpou || company.key,
      supplierName: company.name,
      status: bid.disqualified ? "unsuccessful" : "active",
      publishedAt: tender.publishedAt,
      amount: Number.isFinite(bid.amount) ? bid.amount : null,
      currency: "UAH",
    }];
  });
  const awards = snapshot.bids.flatMap((bid, index) => {
    if (!bid.won && !bid.disqualified) return [];
    const company = snapshot.companies[bid.c];
    const lot = lots[bid.t];
    if (!company || !lot) return [];
    return [{
      id: `legacy:award:${index}`,
      lotId: lot.id,
      supplierId: company.edrpou || company.key,
      supplierName: company.name,
      status: bid.won ? "active" : "unsuccessful",
      // The legacy snapshot did not retain the award date. Keeping it null is
      // deliberate: publication dates must never masquerade as award dates.
      date: null,
      amount: Number.isFinite(bid.amount) ? bid.amount : null,
      currency: "UAH",
    }];
  });
  const contracts = snapshot.bids.flatMap((bid, index) => {
    if (!bid.won || !bid.contractSigned) return [];
    const company = snapshot.companies[bid.c];
    const tender = snapshot.tenders[bid.t];
    const lot = lots[bid.t];
    if (!company || !tender || !lot) return [];
    return [{
      id: `legacy:contract:${index}`,
      tenderId: lot.tenderId,
      lotId: lot.id,
      supplierId: company.edrpou || company.key,
      supplierName: company.name,
      buyerId: buyerId(tender),
      buyerName: tender.buyer,
      status: "active",
      signedAt: bid.contractSigned,
      originalAmount: null,
      currentAmount: Number.isFinite(bid.contractValue) ? bid.contractValue : null,
      paidAmount: null,
      currency: "UAH",
    }];
  });
  return { tenders, lots, bids, awards, contracts };
}

export const legacyAnalyticsMeta = {
  schemaVersion: "legacy-adapter" as const,
  generatedAt: snapshot.generatedAt,
  from: snapshot.startDate,
  to: snapshot.endDate,
  source: snapshot.source,
  limitations: [
    "У старому зрізі відсутні дати рішень, тому режим «Перемоги» потребує нового імпорту.",
    "Старий зріз не містить прямих договорів, змін договорів і фактичних оплат.",
    "Кожна стара закупівля представлена одним технічним лотом; новий імпорт зберігає справжні лоти.",
  ],
};
