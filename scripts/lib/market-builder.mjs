// @ts-check

/**
 * Обхід ринку Prozorro через SmartTender.
 *
 * Один і той самий код працює у двох режимах:
 *
 *   • **повний** — сканує всі 31 день вікна і будує зріз з нуля. Триває довго
 *     (десятки хвилин), тому запускається руками або з машини розробника.
 *   • **оновлення** — сканує лише останні кілька днів і вливає результат у вже
 *     наявний зріз. Саме цей режим викликає планувальник кожні 3 години і
 *     кнопка «Оновити» на сайті.
 *
 * Режими навмисно не розведені в два файли: правила класифікації, території та
 * зіставлення з Excel мають бути буквально одні й ті самі, інакше дані після
 * оновлення почали б відрізнятися від даних після повної збірки.
 */

import { classifyTender, conditioningCodes, constructionCodes, serviceCodes } from "./relevance.mjs";
import { classifyCoverage } from "./coverage-policy.mjs";
import { classifyTerritory, isTargetTerritory, scopedTerritoryDirections } from "./territory.mjs";
import { createTeamMatcher } from "./team-matcher.mjs";

const SMARTTENDER_ROOT = "https://smarttender.biz";
const SMARTTENDER_API = "https://api.smarttender.biz/prozorro/Tenders";
const WINDOW_DAYS = 31;
const DIRECTIONS = ["Капбудівництво", "Сервіс", "Кондиціонування"];
const KEYWORDS = [
  "кондиціонер",
  "вентиляція",
  "чилер",
  "фанкойл",
  "тепловий насос",
  "холодильне обладнання",
  "теплообмінник",
  "рекуператор",
  "будівництво",
];

const wait = (/** @type {number} */ milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function addDays(/** @type {string} */ date, /** @type {number} */ days) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function uiDate(/** @type {unknown} */ value) {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(String(value ?? ""));
  return match ? `${match[3]}-${match[2]}-${match[1]}` : String(value ?? "").slice(0, 10);
}

function baseSearch(/** @type {string} */ day) {
  return {
    Page: 1, Sorting: 2, ParticipationStatus: 1, Phrase: null, PhraseAfterSearch: null,
    AddressSearchTypes: [1], TenderMode: 1, TradeSegment: 2,
    InitialRateFrom: null, InitialRateFromAfterSearch: null, InitialRateTo: null, InitialRateToAfterSearch: null,
    OrganizerIds: [], TenderStatuses: [], BiddingTypeCodes: [], GroupedBiddingTypeCodes: [], AwardStatusCodes: [],
    RegionInfos: [], CategoryIds: [], MonitoringStatuses: [], MyFilterId: null,
    PublicationFrom: day, PublicationTo: day,
    TenderingFrom: null, TenderingTo: null, TenderingEndDateFrom: null, TenderingEndDateTo: null,
    AuctionFrom: null, AuctionTo: null,
    MainProcurementCategoryIds: [], RationaleIds: [], PaymentTermTypeIds: [],
    CategoriesFromSubscription: false, ParticipantId: null, AssignedManagerIds: [],
    ClassificationGroupId: null, TenderFactoring: null, AggregateTender: null, FunderContactIds: [],
  };
}

function classificationRows(/** @type {any[]} */ tree) {
  /** @type {Array<{id: number, code: string}>} */
  const result = [];
  const visit = (/** @type {any[]} */ nodes) => nodes.forEach((node) => {
    const match = /^(\d{8})-\d\s/.exec(String(node.text ?? ""));
    if (match) result.push({ id: Number(node.id), code: match[1] });
    if (node.children) visit(node.children);
  });
  visit(tree);
  return result;
}

function mapTender(/** @type {any} */ row, /** @type {string} */ fallbackDay) {
  const code = String(row.Classification?.Code ?? "").replace(/\D/g, "").slice(0, 8);
  const title = String(row.Subject ?? "Закупівля без назви").trim();
  const cdbNumber = String(row.CdbNumber ?? row.Number ?? row.Id ?? "");
  const status = String(row.StatusInfo?.Title ?? "Статус не вказано");
  const classification = classifyTender(code, title);
  const organizerRegion = String(row.Organizer?.Address?.RegionTitle ?? "").trim();
  return {
    id: String(row.Id ?? cdbNumber),
    cdbNumber,
    title,
    buyer: String(row.Organizer?.Title ?? "Замовник не вказаний"),
    buyerEdrpou: String(row.Organizer?.Usreou ?? ""),
    publishedAt: uiDate(row.PublishedDateTitle) || fallbackDay,
    deadline: row.TenderingPeriodEnd ? String(row.TenderingPeriodEnd) : null,
    amount: Number(row.InitialRate?.Amount ?? 0) || 0,
    status,
    cpvCode: code,
    direction: classification.direction,
    relevanceReason: classification.reason,
    prozorroUrl: cdbNumber ? `https://prozorro.gov.ua/tender/${encodeURIComponent(cdbNumber)}` : "",
    actionable: /прийом пропозицій|період уточнень|активна/i.test(status),
    organizerRegion,
    deliveryRegions: /** @type {string[]} */ ([]),
    ...classifyTerritory({ direction: classification.direction, title, organizerRegion }),
  };
}

function detailItems(/** @type {any} */ detail) {
  return [...(detail?.items ?? []), ...(detail?.lots ?? []).flatMap((/** @type {any} */ lot) => lot?.items ?? [])];
}

function extractDeliveryLocations(/** @type {any} */ detail) {
  return [...new Set(detailItems(detail).flatMap((/** @type {any} */ item) => {
    const address = item?.deliveryAddress;
    if (!address) return [];
    const label = [String(address.region ?? "").trim(), String(address.locality ?? "").trim()].filter(Boolean).join(" · ");
    return label ? [label] : [];
  }))];
}

/**
 * Багато замовників не заповнюють region/locality, а ставлять «згідно з
 * документацією» і пишуть адресу в описі предмета. Це теж деталі закупівлі, а
 * не адреса організатора, тому такий текст можна читати.
 */
function extractDeliveryDescriptions(/** @type {any} */ detail) {
  return [...new Set(detailItems(detail).flatMap((/** @type {any} */ item) => [item?.description, item?.deliveryAddress?.streetAddress]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)))];
}

export function summarize(/** @type {any[]} */ items) {
  const open = items.filter((item) => item.actionable && isTargetTerritory(item));
  const seen = open.filter((item) => item.coverageStatus === "seen");
  const missed = open.filter((item) => item.coverageStatus === "missed");
  const needsReview = open.filter((item) => item.coverageStatus === "review");
  const untracked = open.filter((item) => item.coverageStatus === "untracked");
  const unavailable = items.filter((item) => !item.actionable);
  const outsideScope = items.filter((item) => item.actionable && item.territoryStatus === "outside");
  const unknownTerritory = items.filter((item) => item.actionable && item.territoryStatus === "unknown");
  const sum = (/** @type {any[]} */ rows) => rows.reduce((total, item) => total + item.amount, 0);
  return {
    market: items.length,
    seen: seen.length,
    missed: missed.length,
    needsReview: needsReview.length,
    untracked: untracked.length,
    unavailable: unavailable.length,
    outsideScope: outsideScope.length,
    unknownTerritory: unknownTerritory.length,
    marketValue: sum(items),
    seenValue: sum(seen),
    missedValue: sum(missed),
    needsReviewValue: sum(needsReview),
    untrackedValue: sum(untracked),
    unavailableValue: sum(unavailable),
    outsideScopeValue: sum(outsideScope),
    unknownTerritoryValue: sum(unknownTerritory),
  };
}

/** Перераховує `seenByTeam` і статус покриття проти переданих рядків Excel. */
export function applyCoverage(/** @type {any[]} */ items, /** @type {any[]} */ internalTenders) {
  const matchTeamTender = createTeamMatcher(internalTenders);
  return items.map((item) => {
    const match = matchTeamTender(item);
    return {
      ...item,
      seenByTeam: Boolean(match),
      teamSource: match ? "SharePoint · закупівлі.xlsx" : null,
      matchedInternalId: match?.id ?? null,
      ...classifyCoverage({ direction: item.direction, cpvCode: item.cpvCode, seenByTeam: Boolean(match) }),
    };
  });
}

/** Щоденні підсумки за всім вікном зрізу. */
export function buildDaily(/** @type {any[]} */ items, /** @type {string} */ startDate, /** @type {string} */ endDate) {
  /** @type {Map<string, any[]>} */
  const byDay = new Map();
  for (const item of items) {
    const rows = byDay.get(item.publishedAt) ?? [];
    rows.push(item);
    byDay.set(item.publishedAt, rows);
  }
  const days = [];
  for (let day = startDate; day <= endDate; day = addDays(day, 1)) days.push(day);
  return days.map((day) => {
    const rows = byDay.get(day) ?? [];
    return {
      date: day,
      ...summarize(rows),
      byDirection: Object.fromEntries(DIRECTIONS.map((direction) => [direction, summarize(rows.filter((item) => item.direction === direction))])),
    };
  });
}

/**
 * Кожен відкритий тендер зберігається повністю: саме з ними команда ще може
 * щось зробити, і ховати їх за лімітом означало б показувати неповний ринок.
 * Обрізається лише закрита історія — і те, скільки з неї відкинуто, пишеться
 * у `retention`, щоб зріз не виглядав повним, коли він таким не є.
 */
function applyRetention(/** @type {any[]} */ items, /** @type {number} */ closedCap) {
  const open = items.filter((item) => item.actionable);
  const closed = items.filter((item) => !item.actionable);
  const closedRetained = DIRECTIONS.flatMap((direction) => closed
    .filter((item) => item.direction === direction)
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || b.amount - a.amount)
    .slice(0, closedCap));
  const retained = [...open, ...closedRetained]
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || Number(a.seenByTeam) - Number(b.seenByTeam) || b.amount - a.amount);
  return {
    retained,
    retention: {
      openTotal: open.length,
      openRetained: open.length,
      closedTotal: closed.length,
      closedRetained: closedRetained.length,
      closedDropped: closed.length - closedRetained.length,
      note: `Усі ${open.length} відкритих закупівель збережено повністю. Із ${closed.length} уже закритих залишено ${closedRetained.length} найновіших по кожному напрямку; підсумки у графіках пораховані за повним ринком.`,
    },
  };
}

/**
 * @param {{
 *   username: string,
 *   password: string,
 *   endDate?: string,
 *   crawlDays?: number,
 *   internalTenders: any[],
 *   base?: any,
 *   closedCap?: number,
 *   pageConcurrency?: number,
 *   detailConcurrency?: number,
 *   log?: (message: string) => void,
 * }} options
 */
export async function buildMarketSnapshot(options) {
  const {
    username, password,
    endDate = new Date().toISOString().slice(0, 10),
    crawlDays = WINDOW_DAYS,
    internalTenders,
    base = null,
    closedCap = 400,
    pageConcurrency = 8,
    detailConcurrency = 4,
    log = () => {},
  } = options;
  if (!username || !password) throw new Error("SMARTTENDER_USERNAME and SMARTTENDER_PASSWORD are required");

  const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
  /** @type {Array<{id: string, error: string}>} */
  const failures = [];

  /** @type {(url: string, init?: RequestInit, attempt?: number) => Promise<any>} */
  const getJson = async (url, init = {}, attempt = 1) => {
    try {
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`SmartTender ${response.status}`);
      return await response.json();
    } catch (error) {
      if (attempt >= 5) throw error;
      await wait(300 * attempt ** 2);
      return getJson(url, init, attempt + 1);
    }
  };

  const searchPage = (/** @type {any} */ searchParam) => getJson(`${SMARTTENDER_ROOT}/ProZorroTenders/GetTenders/`, {
    method: "POST",
    headers: { Authorization: authorization, "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
    body: JSON.stringify({ searchParam }),
  });

  const searchAll = async (/** @type {any} */ searchParam, /** @type {string} */ label) => {
    try {
      const first = await searchPage(searchParam);
      const rows = [...(first.Tenders ?? [])];
      const pages = Math.ceil(Number(first.TotalCount ?? rows.length) / 20);
      for (let page = 2; page <= pages; page += pageConcurrency) {
        const numbers = Array.from({ length: Math.min(pageConcurrency, pages - page + 1) }, (_, index) => page + index);
        const settled = await Promise.allSettled(numbers.map((Page) => searchPage({ ...searchParam, Page })));
        settled.forEach((result, index) => {
          if (result.status === "fulfilled") rows.push(...(result.value.Tenders ?? []));
          else failures.push({ id: `${label}:page-${numbers[index]}`, error: String(result.reason) });
        });
      }
      return rows;
    } catch (error) {
      failures.push({ id: label, error: String(error) });
      return [];
    }
  };

  const tree = await getJson(`${SMARTTENDER_ROOT}/ReferenceBook/GetClassification/?schemeType=1`);
  const classifications = classificationRows(tree);
  const profiles = [
    { id: "construction", label: "будівництво", ids: classifications.filter((item) => constructionCodes.has(item.code)).map((item) => item.id) },
    { id: "service", label: "сервіс", ids: classifications.filter((item) => serviceCodes.has(item.code)).map((item) => item.id) },
    { id: "conditioning", label: "кондиціонування", ids: classifications.filter((item) => conditioningCodes.has(item.code)).map((item) => item.id) },
  ];

  const crawlStart = addDays(endDate, -(crawlDays - 1));
  const raw = [];
  for (let index = 0; index < crawlDays; index += 1) {
    const day = addDays(crawlStart, index);
    for (const profile of profiles) {
      const rows = await searchAll({ ...baseSearch(day), CategoryIds: profile.ids }, `${day}:${profile.id}`);
      raw.push(...rows.map((row) => mapTender(row, day)));
      log(`search ${day} · ${profile.label}: ${rows.length}`);
    }
    for (const phrase of KEYWORDS) {
      const rows = await searchAll({ ...baseSearch(day), Phrase: phrase }, `${day}:keyword:${phrase}`);
      raw.push(...rows.map((row) => mapTender(row, day)));
    }
    log(`keywords ${day}: complete`);
  }

  // Вікно зрізу завжди 31 день і завжди закінчується сьогоднішнім днем, навіть
  // якщо цього разу ми сканували лише три дні: решту дає попередній зріз.
  const windowStart = addDays(endDate, -(WINDOW_DAYS - 1));
  const crawled = [...raw.reduce((map, item) => {
    if (item.direction && item.publishedAt >= crawlStart && item.publishedAt <= endDate) map.set(item.cdbNumber || item.id, item);
    return map;
  }, new Map()).values()];

  /**
   * Місце виконання робіт — властивість самої закупівлі, і воно не змінюється
   * з часом. Тому для закупівлі, яку ми вже бачили і в якої територія вже
   * визначена, деталі вдруге не запитуються: саме ці запити займали більшу
   * частину часу оновлення. Ті, де територія лишилась невідомою, перепитуються
   * — раптом замовник дозаповнив адресу.
   */
  const knownTerritory = new Map(
    (base?.tenders ?? [])
      .filter((/** @type {any} */ item) => item.territoryStatus && item.territoryStatus !== "unknown")
      .map((/** @type {any} */ item) => [item.cdbNumber || item.id, item]),
  );

  const enrichable = crawled.filter((item) => item.actionable && scopedTerritoryDirections.has(item.direction));
  const reused = enrichable.filter((item) => knownTerritory.has(item.cdbNumber || item.id)).length;
  log(`territory: ${enrichable.length - reused} details to fetch, ${reused} reused from the stored snapshot`);
  const enriched = new Array(crawled.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(detailConcurrency, crawled.length) || 1 }, async () => {
    while (cursor < crawled.length) {
      const index = cursor;
      cursor += 1;
      const item = crawled[index];
      const known = knownTerritory.get(item.cdbNumber || item.id);
      if (known) {
        // Свіжі статус, дедлайн і сума — з нового зчитування; територія — зі
        // збереженої, бо вона вже підтверджена деталями закупівлі.
        enriched[index] = {
          ...item,
          deliveryRegions: known.deliveryRegions ?? [],
          territoryStatus: known.territoryStatus,
          territoryLabel: known.territoryLabel,
          territorySource: known.territorySource,
        };
        continue;
      }
      /** @type {string[]} */
      let deliveryLocations = [];
      /** @type {string[]} */
      let deliveryDescriptions = [];
      if (item.actionable && scopedTerritoryDirections.has(item.direction)) {
        try {
          const detail = await getJson(`${SMARTTENDER_API}/${encodeURIComponent(item.id)}`, { headers: { Authorization: authorization } });
          deliveryLocations = extractDeliveryLocations(detail);
          deliveryDescriptions = extractDeliveryDescriptions(detail);
        } catch (error) {
          failures.push({ id: `territory:${item.cdbNumber || item.id}`, error: String(error) });
        }
      }
      enriched[index] = {
        ...item,
        deliveryRegions: deliveryLocations,
        ...classifyTerritory({
          direction: item.direction,
          title: item.title,
          organizerRegion: item.organizerRegion,
          deliveryLocations,
          deliveryDescriptions,
        }),
      };
    }
  }));

  // Свіжо зчитаний рядок завжди перемагає збережений: у ньому новіший статус,
  // дедлайн і сума. Старі рядки поза вікном просто випадають.
  const key = (/** @type {any} */ item) => item.cdbNumber || item.id;
  const baseKeys = new Set((base?.tenders ?? []).map(key));
  const enrichedKeys = new Set(enriched.map(key));
  const merged = new Map((base?.tenders ?? []).map((/** @type {any} */ item) => [key(item), item]));
  enriched.forEach((item) => merged.set(key(item), item));
  const withinWindow = [...merged.values()].filter((item) => item.publishedAt >= windowStart && item.publishedAt <= endDate);
  const dropped = merged.size - withinWindow.length;

  const relevant = applyCoverage(withinWindow, internalTenders)
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || b.amount - a.amount);
  const { retained, retention } = applyRetention(relevant, closedCap);

  // Рахуємо по тому, що реально лишилося у зрізі, а не по всьому, що зчитали.
  // Обхід повертає і вже закриті закупівлі, які відсів прибирає назад: якщо
  // рахувати їх «новими», кожне оновлення рапортувало б про півтори тисячі
  // нових тендерів там, де їх насправді пʼять.
  const added = retained.filter((item) => !baseKeys.has(key(item))).length;
  const updated = retained.filter((item) => baseKeys.has(key(item)) && enrichedKeys.has(key(item))).length;
  const incremental = Boolean(base) && crawlDays < WINDOW_DAYS;

  return {
    snapshot: {
      generatedAt: new Date().toISOString(),
      source: "SmartTender production · повний пошук Prozorro",
      method: "Пошук SmartTender по всій Україні за точним переліком ДК-кодів і ключових слів Спецсервісу. Для будівництва й сервісу KPI покриття рахуються лише по Києву та Київській області за адресою виконання; кондиціонування — по всій Україні.",
      startDate: windowStart,
      endDate,
      scanned: incremental ? (base.scanned ?? crawled.length) : crawled.length,
      failures,
      profileCoverage: {
        scope: "Три профілі Спецсервіс: будівництво, сервіс і кондиціонування",
        limitation: "У пошуку залишено всю Україну без мінімального порогу суми. Покриття команди рахується лише для капбудівництва, бо зараз підключено тільки цей SharePoint-файл. Сервіс і кондиціонування показуються як ринок без внутрішнього джерела, а не як пропущені.",
      },
      refresh: {
        mode: incremental ? "incremental" : "full",
        crawlDays,
        crawlFrom: crawlStart,
        crawlTo: endDate,
        crawled: crawled.length,
        added,
        updated,
        droppedOutOfWindow: dropped,
        note: incremental
          ? `Оновлено ${crawlDays} останніх днів: перевірено ${crawled.length} закупівель, ${added} нових потрапило у зріз, ${updated} наявних оновлено. Дані за старіші дні взяті з попереднього зрізу — вони змінюються лише під час повного обходу.`
          : `Повний обхід усіх ${crawlDays} днів вікна.`,
      },
      daily: buildDaily(relevant, windowStart, endDate),
      retention,
      tenders: retained,
    },
    stats: { crawled: crawled.length, added, retained: retained.length, failures: failures.length, dropped },
  };
}
