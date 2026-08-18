import "server-only";

import { unstable_cache } from "next/cache";
import {
  classifyTender,
  conditioningCodes,
  constructionCodes,
  serviceCodes,
} from "../../scripts/lib/relevance.mjs";
import { classifyTerritory } from "../../scripts/lib/territory.mjs";
import type { Direction, LivePulse, LiveTender, TerritorySource, TerritoryStatus } from "@/lib/types";

const SMARTTENDER_ROOT = "https://smarttender.biz";
const PAGE_SIZE = 20;
const PAGE_CONCURRENCY = 8;

type ClassificationNode = {
  id: string;
  text: string;
  children?: ClassificationNode[];
};

type SearchTender = {
  Id?: number;
  Number?: string;
  Subject?: string;
  CdbNumber?: string;
  InitialRate?: { Amount?: number; CurrencyTitle?: string };
  Organizer?: { Title?: string; Usreou?: string; Address?: { RegionTitle?: string } };
  Classification?: { Code?: string };
  PublishedDateTitle?: string;
  TenderingPeriodEnd?: string;
  BiddingTypeTitle?: string;
  StatusInfo?: { Title?: string };
};

type SearchResponse = {
  TotalCount?: number;
  Tenders?: SearchTender[];
};

type SearchParam = Record<string, unknown> & { Page: number };

function authHeaders() {
  const username = process.env.SMARTTENDER_USERNAME;
  const password = process.env.SMARTTENDER_PASSWORD;
  if (!username || !password) throw new Error("SmartTender credentials are not configured");
  return {
    Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
    "Content-Type": "application/json",
    "X-Requested-With": "XMLHttpRequest",
  };
}

async function fetchJson<T>(url: string, options?: RequestInit, attempt = 1): Promise<T> {
  try {
    const response = await fetch(url, { ...options, cache: "no-store", signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`SmartTender ${response.status}`);
    return await response.json() as T;
  } catch (error) {
    if (attempt >= 4) throw error;
    await new Promise((resolve) => setTimeout(resolve, 250 * attempt ** 2));
    return fetchJson<T>(url, options, attempt + 1);
  }
}

function kyivDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function classificationRows(tree: ClassificationNode[]) {
  const result: Array<{ id: number; code: string }> = [];
  const visit = (nodes: ClassificationNode[]) => nodes.forEach((node) => {
    const match = /^(\d{8})-\d\s/.exec(node.text);
    if (match) result.push({ id: Number(node.id), code: match[1] });
    if (node.children) visit(node.children);
  });
  visit(tree);
  return result;
}

function baseSearch(day: string): SearchParam {
  return {
    Page: 1,
    Sorting: 2,
    ParticipationStatus: 1,
    Phrase: null,
    PhraseAfterSearch: null,
    AddressSearchTypes: [1],
    TenderMode: 1,
    TradeSegment: 2,
    InitialRateFrom: null,
    InitialRateFromAfterSearch: null,
    InitialRateTo: null,
    InitialRateToAfterSearch: null,
    OrganizerIds: [],
    TenderStatuses: [],
    BiddingTypeCodes: [],
    GroupedBiddingTypeCodes: [],
    AwardStatusCodes: [],
    RegionInfos: [],
    CategoryIds: [],
    MonitoringStatuses: [],
    MyFilterId: null,
    PublicationFrom: day,
    PublicationTo: day,
    TenderingFrom: null,
    TenderingTo: null,
    TenderingEndDateFrom: null,
    TenderingEndDateTo: null,
    AuctionFrom: null,
    AuctionTo: null,
    MainProcurementCategoryIds: [],
    RationaleIds: [],
    PaymentTermTypeIds: [],
    CategoriesFromSubscription: false,
    ParticipantId: null,
    AssignedManagerIds: [],
    ClassificationGroupId: null,
    TenderFactoring: null,
    AggregateTender: null,
    FunderContactIds: [],
  };
}

async function searchPage(searchParam: SearchParam) {
  return fetchJson<SearchResponse>(`${SMARTTENDER_ROOT}/ProZorroTenders/GetTenders/`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ searchParam }),
  });
}

async function searchAll(searchParam: SearchParam) {
  const first = await searchPage(searchParam);
  const rows = [...(first.Tenders ?? [])];
  const pages = Math.ceil((first.TotalCount ?? rows.length) / PAGE_SIZE);
  for (let page = 2; page <= pages; page += PAGE_CONCURRENCY) {
    const pageNumbers = Array.from({ length: Math.min(PAGE_CONCURRENCY, pages - page + 1) }, (_, index) => page + index);
    const responses = await Promise.all(pageNumbers.map((Page) => searchPage({ ...searchParam, Page })));
    responses.forEach((response) => rows.push(...(response.Tenders ?? [])));
  }
  return rows;
}

function toLiveTender(row: SearchTender, day: string): LiveTender | null {
  const code = String(row.Classification?.Code ?? "").replace(/\D/g, "").slice(0, 8);
  const title = row.Subject?.trim() || "Закупівля без назви";
  const direction = classifyTender(code, title).direction as Direction | null;
  const tenderAmount = Number(row.InitialRate?.Amount ?? 0) || 0;
  if (!direction) return null;
  const cdbNumber = String(row.CdbNumber ?? row.Number ?? row.Id ?? "");
  const relevance = direction === "Капбудівництво" ? 92 : 84;
  const organizerRegion = row.Organizer?.Address?.RegionTitle ?? "";
  const territory = classifyTerritory({ direction, title, organizerRegion });
  return {
    id: String(row.Id ?? cdbNumber),
    cdbNumber,
    title,
    publishedAt: `${day}T12:00:00Z`,
    modifiedAt: null,
    deadline: row.TenderingPeriodEnd ?? null,
    status: row.StatusInfo?.Title ?? "Статус не вказано",
    method: row.BiddingTypeTitle ?? "—",
    amount: tenderAmount,
    currency: row.InitialRate?.CurrencyTitle?.includes("грн") ? "UAH" : (row.InitialRate?.CurrencyTitle ?? "UAH"),
    buyer: row.Organizer?.Title ?? "Замовник не вказаний",
    buyerEdrpou: row.Organizer?.Usreou ?? "",
    cpv: code ? [code] : [],
    delivery: row.Organizer?.Address?.RegionTitle ?? "Україна",
    organizerRegion,
    deliveryRegions: [],
    territoryStatus: territory.territoryStatus as TerritoryStatus,
    territoryLabel: territory.territoryLabel,
    territorySource: territory.territorySource as TerritorySource,
    direction,
    relevance,
    relevanceLabel: "Висока",
    prozorroUrl: cdbNumber ? `https://prozorro.gov.ua/tender/${encodeURIComponent(cdbNumber)}` : "",
  };
}

async function loadPulse(): Promise<LivePulse> {
  const fetchedAt = new Date().toISOString();
  try {
    const day = kyivDate();
    const tree = await fetchJson<ClassificationNode[]>(`${SMARTTENDER_ROOT}/ReferenceBook/GetClassification/?schemeType=1`);
    const classifications = classificationRows(tree);
    const profiles = [
      { ids: classifications.filter((item) => constructionCodes.has(item.code)).map((item) => item.id), minimum: null },
      { ids: classifications.filter((item) => serviceCodes.has(item.code)).map((item) => item.id), minimum: null },
      { ids: classifications.filter((item) => conditioningCodes.has(item.code)).map((item) => item.id), minimum: null },
    ];
    const keywords = ["кондиціонер", "вентиляція", "чилер", "фанкойл", "тепловий насос", "холодильне обладнання", "теплообмінник", "рекуператор", "будівництво"];
    const raw: SearchTender[] = [];
    const searches = [
      ...profiles.map((profile) => ({ ...baseSearch(day), CategoryIds: profile.ids, InitialRateFrom: profile.minimum })),
      ...keywords.map((Phrase) => ({ ...baseSearch(day), Phrase, InitialRateFrom: null })),
    ];
    for (let index = 0; index < searches.length; index += 3) {
      const batch = await Promise.all(searches.slice(index, index + 3).map((search) => searchAll(search)));
      batch.forEach((rows) => raw.push(...rows));
    }
    const tenders = [...raw.reduce((map, row) => {
      const item = toLiveTender(row, day);
      if (item) map.set(item.cdbNumber || item.id, item);
      return map;
    }, new Map<string, LiveTender>()).values()]
      .sort((left, right) => right.amount - left.amount);
    return {
      fetchedAt,
      status: "online",
      message: "Повний ринок SmartTender · три профілі · оновлення кожні 15 хв",
      scanned: tenders.length,
      relevant: tenders.length,
      highPriority: tenders.filter((item) => item.relevance >= 90).length,
      totalValue: tenders.reduce((sum, item) => sum + item.amount, 0),
      tenders,
    };
  } catch (error) {
    return {
      fetchedAt,
      status: "degraded",
      message: error instanceof Error ? error.message : "SmartTender тимчасово недоступний",
      scanned: 0,
      relevant: 0,
      highPriority: 0,
      totalValue: 0,
      tenders: [],
    };
  }
}

export const getLivePulse = unstable_cache(loadPulse, ["smarttender-approved-profile-v5"], {
  revalidate: 900,
  tags: ["smarttender"],
});
