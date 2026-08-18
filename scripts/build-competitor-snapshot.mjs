/**
 * Реальні конкуренти з Prozorro.
 *
 * Джерело — не здогади, а `lots[].bids[]` кожної конкурентної закупівлі: назва
 * учасника, ЄДРПОУ, сума ставки, статус і підписаний договір. Тому «виграв» тут
 * означає рішення замовника у Prozorro, а не оцінку.
 *
 * Беруться лише конкурентні процедури (відкриті торги, спрощена, запит цін).
 * Прямі договори без електронної системи — 81 % ринку — свідомо пропускаються:
 * у них немає учасників, з якими можна конкурувати.
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { classifyTender } from "./lib/relevance.mjs";
import { classifyTerritory } from "./lib/territory.mjs";

const SMARTTENDER_ROOT = "https://smarttender.biz";
const SMARTTENDER_API = "https://api.smarttender.biz/prozorro/Tenders";
const SPECSERVIS_EDRPOU = "30518990";

const username = process.env.SMARTTENDER_USERNAME;
const password = process.env.SMARTTENDER_PASSWORD;
if (!username || !password) throw new Error("SMARTTENDER_USERNAME and SMARTTENDER_PASSWORD are required");
const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;

const historyDays = Number(process.env.COMPETITOR_HISTORY_DAYS ?? 120);
const endDate = process.env.COMPETITOR_END ?? new Date().toISOString().slice(0, 10);
const pageConcurrency = Number(process.env.COMPETITOR_PAGE_CONCURRENCY ?? 8);
const detailConcurrency = Number(process.env.COMPETITOR_DETAIL_CONCURRENCY ?? 5);

const competitiveMethod = /Відкриті торги|Спрощена закупівля|Запит \(ціни\) пропозицій|Торги за правилами організатора/i;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getJson(url, options = {}, attempt = 1) {
  try {
    const response = await fetch(url, { ...options, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`SmartTender ${response.status}`);
    return await response.json();
  } catch (error) {
    if (attempt >= 5) throw error;
    await wait(300 * attempt ** 2);
    return getJson(url, options, attempt + 1);
  }
}

function addDays(date, days) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function uiDate(value) {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(String(value ?? ""));
  return match ? `${match[3]}-${match[2]}-${match[1]}` : String(value ?? "").slice(0, 10);
}

function baseSearch(day, categoryIds) {
  return {
    Page: 1, Sorting: 2, ParticipationStatus: 1, Phrase: null, PhraseAfterSearch: null,
    AddressSearchTypes: [1], TenderMode: 1, TradeSegment: 2,
    InitialRateFrom: null, InitialRateFromAfterSearch: null, InitialRateTo: null, InitialRateToAfterSearch: null,
    OrganizerIds: [], TenderStatuses: [], BiddingTypeCodes: [], GroupedBiddingTypeCodes: [], AwardStatusCodes: [],
    RegionInfos: [], CategoryIds: categoryIds, MonitoringStatuses: [], MyFilterId: null,
    PublicationFrom: day, PublicationTo: day,
    TenderingFrom: null, TenderingTo: null, TenderingEndDateFrom: null, TenderingEndDateTo: null,
    AuctionFrom: null, AuctionTo: null, MainProcurementCategoryIds: [], RationaleIds: [], PaymentTermTypeIds: [],
    CategoriesFromSubscription: false, ParticipantId: null, AssignedManagerIds: [], ClassificationGroupId: null,
    TenderFactoring: null, AggregateTender: null, FunderContactIds: [],
  };
}

const searchPage = (searchParam) => getJson(`${SMARTTENDER_ROOT}/ProZorroTenders/GetTenders/`, {
  method: "POST",
  headers: { Authorization: authorization, "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
  body: JSON.stringify({ searchParam }),
});

async function searchDay(day, categoryIds, failures) {
  try {
    const first = await searchPage(baseSearch(day, categoryIds));
    const rows = [...(first.Tenders ?? [])];
    const pages = Math.ceil(Number(first.TotalCount ?? rows.length) / 20);
    for (let page = 2; page <= pages; page += pageConcurrency) {
      const numbers = Array.from({ length: Math.min(pageConcurrency, pages - page + 1) }, (_, index) => page + index);
      const settled = await Promise.allSettled(numbers.map((Page) => searchPage({ ...baseSearch(day, categoryIds), Page })));
      settled.forEach((result, index) => {
        if (result.status === "fulfilled") rows.push(...(result.value.Tenders ?? []));
        else failures.push({ id: `${day}:page-${numbers[index]}`, error: String(result.reason) });
      });
    }
    return rows;
  } catch (error) {
    failures.push({ id: day, error: String(error) });
    return [];
  }
}

function classificationRows(tree) {
  const result = [];
  const visit = (nodes) => nodes.forEach((node) => {
    const match = /^(\d{8})-\d\s/.exec(String(node.text ?? ""));
    if (match) result.push({ id: Number(node.id), code: match[1] });
    if (node.children) visit(node.children);
  });
  visit(tree);
  return result;
}

/** Назва компанії для групування; ЄДРПОУ надійніший, тому він у пріоритеті. */
function normalizedName(value) {
  return String(value ?? "")
    .toUpperCase()
    .replace(/[«»""'`’]/g, "")
    .replace(/\b(ТОВАРИСТВО З ОБМЕЖЕНОЮ ВІДПОВІДАЛЬНІСТЮ|ПРИВАТНЕ ПІДПРИЄМСТВО|ФІЗИЧНА ОСОБА-ПІДПРИЄМЕЦЬ|ФІЗИЧНА ОСОБА ПІДПРИЄМЕЦЬ|ПРИВАТНЕ АКЦІОНЕРНЕ ТОВАРИСТВО|ТОВ|ПП|ФОП|ПРАТ|АТ|БК)\b/g, " ")
    .replace(/[^А-ЯІЇЄҐA-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function shortName(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function extractDeliveryLocations(detail) {
  const items = [
    ...(detail?.items ?? []),
    ...(detail?.lots ?? []).flatMap((lot) => lot?.items ?? []),
  ];
  return [...new Set(items.flatMap((item) => {
    const address = item?.deliveryAddress;
    if (!address) return [];
    const region = String(address.region ?? "").trim();
    const locality = String(address.locality ?? "").trim();
    const label = [region, locality].filter(Boolean).join(" · ");
    return label ? [label] : [];
  }))];
}

/** Одна ставка = один рядок участі. `won` читається зі статусу award у Prozorro. */
function extractBids(detail) {
  return (detail?.lots ?? []).flatMap((lot) => (lot?.bids ?? []).map((bid) => {
    const awards = bid.awards ?? [];
    const activeAward = awards.find((award) => award.status === "active");
    const contract = activeAward?.contracts?.find((item) => item.status === "active") ?? activeAward?.contracts?.[0];
    return {
      name: shortName(bid.bidder?.title),
      edrpou: String(bid.bidder?.usreou ?? "").trim(),
      region: String(bid.bidder?.address?.region ?? "").trim(),
      locality: String(bid.bidder?.address?.locality ?? "").trim(),
      amount: Number(bid.value?.amount ?? 0) || 0,
      won: Boolean(activeAward) || bid.status === "contractSigned",
      disqualified: awards.some((award) => award.status === "unsuccessful"),
      contractValue: Number(contract?.value?.amount ?? 0) || 0,
      contractSigned: contract?.dateSigned ? String(contract.dateSigned).slice(0, 10) : null,
    };
  }));
}

const startDate = addDays(endDate, -(historyDays - 1));
const failures = [];
console.log(`competitor crawl ${startDate} … ${endDate} (${historyDays} days)`);

const tree = await getJson(`${SMARTTENDER_ROOT}/ReferenceBook/GetClassification/?schemeType=1`);
const classifications = classificationRows(tree);
const { constructionCodes, serviceCodes, conditioningCodes } = await import("./lib/relevance.mjs");
const profileCodes = new Set([...constructionCodes, ...serviceCodes, ...conditioningCodes]);
const categoryIds = classifications.filter((item) => profileCodes.has(item.code)).map((item) => item.id);

const candidates = new Map();
let searched = 0;
for (let index = 0; index < historyDays; index += 1) {
  const day = addDays(startDate, index);
  const rows = await searchDay(day, categoryIds, failures);
  searched += rows.length;
  let kept = 0;
  for (const row of rows) {
    if (!competitiveMethod.test(String(row.BiddingTypeTitle ?? ""))) continue;
    const code = String(row.Classification?.Code ?? "").replace(/\D/g, "").slice(0, 8);
    const title = String(row.Subject ?? "").trim();
    const classification = classifyTender(code, title);
    if (!classification.direction) continue;
    const id = String(row.Id ?? "");
    if (!id || candidates.has(id)) continue;
    candidates.set(id, {
      id,
      cdbNumber: String(row.CdbNumber ?? row.Number ?? id),
      title,
      buyer: String(row.Organizer?.Title ?? "Замовник не вказаний"),
      buyerEdrpou: String(row.Organizer?.Usreou ?? ""),
      organizerRegion: String(row.Organizer?.Address?.RegionTitle ?? "").trim(),
      publishedAt: uiDate(row.PublishedDateTitle) || day,
      amount: Number(row.InitialRate?.Amount ?? 0) || 0,
      status: String(row.StatusInfo?.Title ?? ""),
      method: String(row.BiddingTypeTitle ?? ""),
      cpvCode: code,
      direction: classification.direction,
      prozorroUrl: row.CdbNumber ? `https://prozorro.gov.ua/tender/${encodeURIComponent(String(row.CdbNumber))}` : "",
    });
    kept += 1;
  }
  console.log(`  ${day}: ${rows.length} found, ${kept} competitive+relevant (total ${candidates.size})`);
}

const list = [...candidates.values()];
console.log(`\nsearch done: ${searched} scanned, ${list.length} competitive relevant tenders. fetching details…`);

const detailed = [];
let cursor = 0;
let done = 0;
await Promise.all(Array.from({ length: Math.min(detailConcurrency, list.length) }, async () => {
  while (cursor < list.length) {
    const tender = list[cursor++];
    try {
      const detail = await getJson(`${SMARTTENDER_API}/${encodeURIComponent(tender.id)}`, { headers: { Authorization: authorization } });
      const bids = extractBids(detail);
      if (bids.length) {
        const deliveryLocations = extractDeliveryLocations(detail);
        detailed.push({
          ...tender,
          deliveryRegions: deliveryLocations,
          ...classifyTerritory({ direction: tender.direction, title: tender.title, organizerRegion: tender.organizerRegion, deliveryLocations }),
          bids,
        });
      }
    } catch (error) {
      failures.push({ id: `detail:${tender.cdbNumber}`, error: String(error) });
    }
    done += 1;
    if (done % 500 === 0) console.log(`  details ${done}/${list.length} · ${detailed.length} with bids · ${failures.length} failures`);
  }
}));


console.log(`\ndetails done: ${detailed.length} tenders with bids, ${failures.length} failures. normalising…`);

/**
 * Зріз зберігається нормалізовано: окремо закупівлі, окремо компанії, окремо
 * ставки з посиланнями на індекси. Так будь-який період можна перерахувати
 * чесно з первинних рядків, а не з готових підсумків за все вікно.
 */
const companyIndex = new Map();
const companies = [];
const bids = [];

detailed.sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));

const tenders = detailed.map((tender, tenderIndex) => {
  const specservisBid = tender.bids.find((bid) => bid.edrpou === SPECSERVIS_EDRPOU);
  for (const bid of tender.bids) {
    if (!bid.name) continue;
    const key = bid.edrpou || normalizedName(bid.name);
    if (!key) continue;
    let index = companyIndex.get(key);
    if (index === undefined) {
      index = companies.length;
      companyIndex.set(key, index);
      companies.push({
        key,
        edrpou: bid.edrpou,
        name: bid.name,
        aliases: [],
        region: bid.region,
        locality: bid.locality,
        isSpecservis: bid.edrpou === SPECSERVIS_EDRPOU,
      });
    }
    const company = companies[index];
    if (!company.region && bid.region) company.region = bid.region;
    if (!company.locality && bid.locality) company.locality = bid.locality;
    if (bid.name !== company.name && !company.aliases.includes(bid.name) && company.aliases.length < 4) {
      company.aliases.push(bid.name);
    }
    bids.push({
      t: tenderIndex,
      c: index,
      amount: Math.round(bid.amount),
      won: bid.won,
      disqualified: bid.disqualified,
      contractValue: Math.round(bid.contractValue),
      contractSigned: bid.contractSigned,
      vsSpecservis: Boolean(specservisBid) && bid.edrpou !== SPECSERVIS_EDRPOU,
    });
  }
  return {
    cdbNumber: tender.cdbNumber,
    title: tender.title,
    buyer: tender.buyer,
    buyerEdrpou: tender.buyerEdrpou,
    direction: tender.direction,
    cpvCode: tender.cpvCode,
    publishedAt: tender.publishedAt,
    announcedAmount: Math.round(tender.amount),
    status: tender.status,
    method: tender.method,
    territoryStatus: tender.territoryStatus,
    territoryLabel: tender.territoryLabel,
    territorySource: tender.territorySource,
    bidders: tender.bids.length,
    prozorroUrl: tender.prozorroUrl,
  };
});

const totals = {
  companies: companies.length,
  tendersAnalysed: tenders.length,
  bidRows: bids.length,
  contestedTenders: tenders.filter((tender) => tender.bidders > 1).length,
  averageBidders: tenders.length ? Math.round((bids.length / tenders.length) * 100) / 100 : 0,
  awardedValue: bids.filter((bid) => bid.won).reduce((sum, bid) => sum + (bid.contractValue || bid.amount), 0),
  specservisBids: bids.filter((bid) => companies[bid.c].isSpecservis).length,
};

const output = {
  generatedAt: new Date().toISOString(),
  source: "SmartTender production · Prozorro bids and awards",
  method: "Учасники та переможці зчитані з lots[].bids[] кожної конкурентної закупівлі профілю Спецсервісу. Прямі договори без електронної процедури не включені: у них немає учасників, з якими можна конкурувати.",
  startDate,
  endDate,
  days: historyDays,
  scanned: { searched, competitiveRelevant: list.length, withBids: detailed.length },
  failures: failures.slice(0, 200),
  failureCount: failures.length,
  totals,
  companies,
  tenders,
  bids,
};

const outputPath = path.join(process.cwd(), "src/data/competitor-snapshot.json");
await writeFile(outputPath, `${JSON.stringify(output)}\n`);
console.log(`saved ${outputPath}`);
console.log(JSON.stringify(totals, null, 1));
