// @ts-check

import { classifyTender, conditioningCodes, constructionCodes, serviceCodes } from "./relevance.mjs";
import { classifyTerritory, isTargetTerritory, scopedTerritoryDirections } from "./territory.mjs";

const ROOT = "https://smarttender.biz";
const DETAIL = "https://api.smarttender.biz/prozorro/Tenders";
const KEYWORDS = ["кондиціонер", "вентиляція", "чилер", "фанкойл", "тепловий насос", "холодильне обладнання", "теплообмінник", "рекуператор", "будівництво"];
const wait = (/** @type {number} */ milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function search(/** @type {string} */ day) {
  return {
    Page: 1, Sorting: 2, ParticipationStatus: 1, Phrase: null, PhraseAfterSearch: null,
    AddressSearchTypes: [1], TenderMode: 1, TradeSegment: 2, InitialRateFrom: null,
    InitialRateFromAfterSearch: null, InitialRateTo: null, InitialRateToAfterSearch: null,
    OrganizerIds: [], TenderStatuses: [], BiddingTypeCodes: [], GroupedBiddingTypeCodes: [], AwardStatusCodes: [],
    RegionInfos: [], CategoryIds: [], MonitoringStatuses: [], MyFilterId: null, PublicationFrom: day, PublicationTo: day,
    TenderingFrom: null, TenderingTo: null, TenderingEndDateFrom: null, TenderingEndDateTo: null,
    AuctionFrom: null, AuctionTo: null, MainProcurementCategoryIds: [], RationaleIds: [], PaymentTermTypeIds: [],
    CategoriesFromSubscription: false, ParticipantId: null, AssignedManagerIds: [], ClassificationGroupId: null,
    TenderFactoring: null, AggregateTender: null, FunderContactIds: [],
  };
}

function publicationDay(/** @type {unknown} */ value) {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(String(value ?? "").trim());
  return match ? `${match[3]}-${match[2]}-${match[1]}` : String(value ?? "").slice(0, 10);
}

function detailItems(/** @type {any} */ detail) {
  return [...(detail?.items ?? []), ...(detail?.lots ?? []).flatMap((/** @type {any} */ lot) => lot?.items ?? [])];
}

function deliveryLocations(/** @type {any} */ detail) {
  return [...new Set(detailItems(detail).flatMap((/** @type {any} */ item) => {
    const address = item?.deliveryAddress;
    const label = [address?.region, address?.locality].map((value) => String(value ?? "").trim()).filter(Boolean).join(" · ");
    return label ? [label] : [];
  }))];
}

function deliveryDescriptions(/** @type {any} */ detail) {
  return [...new Set(detailItems(detail).flatMap((/** @type {any} */ item) => [item?.description, item?.deliveryAddress?.streetAddress]
    .map((value) => String(value ?? "").trim()).filter(Boolean)))];
}

async function json(/** @type {string} */ url, /** @type {RequestInit} */ init = {}, attempt = 1) {
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`SmartTender request failed (${response.status})`);
    return await response.json();
  } catch (error) {
    if (attempt >= 4) throw error;
    await wait(250 * attempt ** 2);
    return json(url, init, attempt + 1);
  }
}

function classificationRows(/** @type {any[]} */ tree) {
  /** @type {Array<{id: number, code: string}>} */
  const result = [];
  const visit = (/** @type {any[]} */ nodes) => nodes.forEach((/** @type {any} */ node) => {
    const match = /^(\d{8})-\d\s/.exec(String(node.text ?? ""));
    if (match) result.push({ id: Number(node.id), code: match[1] });
    if (node.children) visit(node.children);
  });
  visit(tree);
  return result;
}

/**
 * Discover exact official Prozorro UUIDs through SmartTender search.
 * @param {{day: string, username: string, password: string, pageConcurrency?: number,
 * cpvPrefixes?: string[], phrases?: string[], monitoringRules?: boolean, detailConcurrency?: number}} options
 */
export async function discoverAnalyticsTenders({
  day,
  username,
  password,
  pageConcurrency = 6,
  cpvPrefixes = [],
  phrases = [],
  monitoringRules = false,
  detailConcurrency = 4,
}) {
  if (!username || !password) throw new Error("SMARTTENDER_USERNAME and SMARTTENDER_PASSWORD are required");
  const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
  const headers = { Authorization: authorization, "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" };
  const requestPage = (/** @type {Record<string, any>} */ searchParam) => json(`${ROOT}/ProZorroTenders/GetTenders/`, { method: "POST", headers, body: JSON.stringify({ searchParam }) });
  const all = async (/** @type {Record<string, any>} */ searchParam) => {
    const first = await requestPage(searchParam);
    const rows = [...(first.Tenders ?? [])];
    const pages = Math.ceil(Number(first.TotalCount ?? rows.length) / 20);
    for (let page = 2; page <= pages; page += pageConcurrency) {
      const numbers = Array.from({ length: Math.min(pageConcurrency, pages - page + 1) }, (_, index) => page + index);
      const results = await Promise.all(numbers.map((Page) => requestPage({ ...searchParam, Page })));
      for (const result of results) rows.push(...(result.Tenders ?? []));
    }
    return rows;
  };
  const tree = await json(`${ROOT}/ReferenceBook/GetClassification/?schemeType=1`);
  const classifications = classificationRows(tree);
  const profiles = monitoringRules
    ? [constructionCodes, serviceCodes, conditioningCodes]
      .map((codes) => classifications.filter((item) => codes.has(item.code)).map((item) => item.id))
    : cpvPrefixes.length
      ? [classifications.filter((item) => cpvPrefixes.some((prefix) => item.code.startsWith(prefix))).map((item) => item.id)]
      : [];
  const raw = [];
  for (const ids of profiles) if (ids.length) raw.push(...await all({ ...search(day), CategoryIds: ids }));
  for (const phrase of monitoringRules ? KEYWORDS : phrases) raw.push(...await all({ ...search(day), Phrase: phrase }));

  const candidates = [...new Map(raw.map((row) => [String(row.Id), row])).values()].filter((row) => {
    if (publicationDay(row.PublishedDateTitle) !== day) return false;
    const code = String(row.Classification?.Code ?? "").replace(/\D/g, "").slice(0, 8);
    return monitoringRules ? Boolean(classifyTender(code, String(row.Subject ?? "")).direction) : true;
  });
  let cursor = 0;
  const results = new Array(candidates.length);
  await Promise.all(Array.from({ length: Math.min(detailConcurrency, candidates.length) || 1 }, async () => {
    while (cursor < candidates.length) {
      const index = cursor++;
      const row = candidates[index];
      const detail = await json(`${DETAIL}/${encodeURIComponent(String(row.Id))}`, { headers: { Authorization: authorization } });
      const id = typeof detail?.cdbId === "string" ? detail.cdbId : null;
      const code = String(row.Classification?.Code ?? "").replace(/\D/g, "").slice(0, 8);
      const direction = classifyTender(code, String(row.Subject ?? "")).direction;
      const organizerRegion = String(row.Organizer?.Address?.RegionTitle ?? "").trim();
      const territory = monitoringRules && direction && scopedTerritoryDirections.has(direction)
        ? classifyTerritory({
            direction,
            title: String(row.Subject ?? ""),
            organizerRegion,
            deliveryLocations: deliveryLocations(detail),
            deliveryDescriptions: deliveryDescriptions(detail),
          })
        : null;
      results[index] = id && (!territory || isTargetTerritory(territory)) ? { id, direction } : null;
    }
  }));
  return results.filter(Boolean);
}

/** @param {{day: string, username: string, password: string, pageConcurrency?: number, detailConcurrency?: number}} options */
export function discoverMonitoringTenders(options) {
  return discoverAnalyticsTenders({ ...options, monitoringRules: true });
}
