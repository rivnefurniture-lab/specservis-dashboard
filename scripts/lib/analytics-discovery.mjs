// @ts-check

const ROOT = "https://smarttender.biz";
const DETAIL = "https://api.smarttender.biz/prozorro/Tenders";
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
 * cpvPrefixes?: string[], phrases?: string[], monitoringRules?: boolean, monitoringRuleSet?: any, detailConcurrency?: number}} options
 */
export async function discoverAnalyticsTenders({
  day,
  username,
  password,
  pageConcurrency = 6,
  cpvPrefixes = [],
  phrases = [],
  monitoringRules = false,
  monitoringRuleSet = null,
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
  const activeRules = monitoringRules && monitoringRuleSet?.directions
    ? monitoringRuleSet.directions
    : [];
  const ruleCodes = activeRules.flatMap((/** @type {any} */ direction) => direction.cpv ?? []);
  const rulePhrases = activeRules.flatMap((/** @type {any} */ direction) => [
    ...(direction.terms ?? []), ...(direction.brands ?? []),
  ]).flatMap((/** @type {any} */ entry) => [entry.value, ...(entry.variants ?? [])]);
  const profiles = monitoringRules
    ? activeRules.map((/** @type {any} */ direction) => {
        const directionCodes = direction.cpv ?? [];
        return classifications.filter((item) => directionCodes.some((/** @type {any} */ rule) => {
          const code = String(rule.code ?? "").replace(/\D/g, "").slice(0, 8).padEnd(8, "0");
          const prefix = code.replace(/0+$/, "") || code;
          return rule.includeDescendants ? item.code.startsWith(prefix) : item.code === code;
        })).map((item) => item.id);
      })
    : cpvPrefixes.length
      ? [classifications.filter((item) => cpvPrefixes.some((prefix) => item.code.startsWith(prefix))).map((item) => item.id)]
      : [];
  const raw = [];
  for (const ids of profiles) if (ids.length) raw.push(...await all({ ...search(day), CategoryIds: ids }));
  for (const phrase of monitoringRules ? [...new Set(rulePhrases)].filter(Boolean) : phrases) {
    raw.push(...await all({ ...search(day), Phrase: phrase }));
  }

  const candidates = [...new Map(raw.map((row) => [String(row.Id), row])).values()].filter((row) => {
    if (publicationDay(row.PublishedDateTitle) !== day) return false;
    if (!monitoringRules) return true;
    const code = String(row.Classification?.Code ?? "").replace(/\D/g, "").slice(0, 8).padEnd(8, "0");
    const byCode = ruleCodes.some((/** @type {any} */ rule) => {
      const ruleCode = String(rule.code ?? "").replace(/\D/g, "").slice(0, 8).padEnd(8, "0");
      const prefix = ruleCode.replace(/0+$/, "") || ruleCode;
      return rule.includeDescendants ? code.startsWith(prefix) : code === ruleCode;
    });
    return byCode || Boolean(String(row.Subject ?? "").trim());
  });
  let cursor = 0;
  const results = new Array(candidates.length);
  await Promise.all(Array.from({ length: Math.min(detailConcurrency, candidates.length) || 1 }, async () => {
    while (cursor < candidates.length) {
      const index = cursor++;
      const row = candidates[index];
      const detail = await json(`${DETAIL}/${encodeURIComponent(String(row.Id))}`, { headers: { Authorization: authorization } });
      const id = typeof detail?.cdbId === "string" ? detail.cdbId : null;
      results[index] = id ? { id, direction: null } : null;
    }
  }));
  return results.filter(Boolean);
}

/** @param {{day: string, username: string, password: string, pageConcurrency?: number, detailConcurrency?: number, monitoringRuleSet?: any}} options */
export function discoverMonitoringTenders(options) {
  return discoverAnalyticsTenders({ ...options, monitoringRules: true });
}
