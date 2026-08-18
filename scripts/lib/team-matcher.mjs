// @ts-check

/**
 * Єдине правило, за яким ринкова закупівля вважається знайденою у внутрішньому
 * файлі команди.
 *
 * Раніше воно жило всередині скрипта збірки, тож зріз ринку носив у собі
 * `seenByTeam`, заморожений на момент побудови. Через це додавання рядка в
 * закупівлі.xlsx не прибирало тендер зі списку «підтверджено не в Excel» —
 * треба було чекати наступної повної перебудови. Тепер це правило спільне:
 * скрипт рахує ним початковий зріз, а застосунок перераховує ним же на кожному
 * запиті, звіряючись із тим Excel, що лежить у SharePoint просто зараз.
 */

/**
 * Ці три функції перенесені зі скрипта збірки дослівно. Пороги схожості нижче
 * (0,42 і 0,72) підібрані саме під них: зокрема під міру Жаккара зі знаменником
 * по об'єднанню множин і під відсіювання службових слів на кшталт «роботи» чи
 * «закупівля», без яких будь-які дві назви виглядали б схожими. Змінювати їх
 * можна лише разом із порогами.
 *
 * @param {string} value
 */
function normalize(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[«»“”"'`]/g, "")
    .replace(/[^а-яіїєґa-z0-9]+/gi, " ")
    .replace(/\b(дк|код|послуги|роботи|закупівля|згідно|за|та|і|на|для|з|у|в)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** @param {string} value */
export function tokens(value) {
  return new Set(normalize(value).split(" ").filter((item) => item.length > 2));
}

/**
 * Міра Жаккара: спільні слова, поділені на всі різні слова обох назв.
 *
 * Розмір об'єднання рахується арифметично (|A| + |B| − |A∩B|), а не побудовою
 * ще однієї множини. Результат той самий до останнього знаку, але без цього
 * перерахунок покриття всього ринку тривав понад чотири секунди: множина
 * створювалася заново для кожного кандидата, а їх на кожну закупівлю сотні.
 *
 * @param {Set<string>} a @param {Set<string>} b
 */
export function tokenSimilarity(a, b) {
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  small.forEach((item) => { if (large.has(item)) intersection += 1; });
  return intersection / (a.size + b.size - intersection);
}

/**
 * @typedef {{ id: number, title: string, buyerEdrpou: string, value: number }} InternalRow
 * @typedef {{ title: string, buyerEdrpou: string, amount: number }} MarketRow
 */

/**
 * Будує індекс за ЄДРПОУ замовника і за словами назви, щоб не звіряти кожну
 * ринкову закупівлю з кожним рядком файлу. Індекс будується один раз на версію
 * файлу, далі кожен пошук перевіряє лише десяток кандидатів.
 *
 * @param {InternalRow[]} internalTenders
 */
export function createTeamMatcher(internalTenders) {
  const prepared = internalTenders.map((item) => ({
    ...item,
    normalizedTitle: normalize(item.title),
    titleTokens: tokens(item.title),
  }));
  /** @type {Map<string, typeof prepared>} */
  const byBuyer = new Map();
  /** @type {Map<string, typeof prepared>} */
  const byToken = new Map();
  prepared.forEach((item) => {
    if (item.buyerEdrpou) {
      const rows = byBuyer.get(item.buyerEdrpou) ?? [];
      rows.push(item);
      byBuyer.set(item.buyerEdrpou, rows);
    }
    item.titleTokens.forEach((token) => {
      if (token.length < 5) return;
      const rows = byToken.get(token) ?? [];
      rows.push(item);
      byToken.set(token, rows);
    });
  });

  /** @param {MarketRow} marketTender */
  return (marketTender) => {
    const marketTitle = normalize(marketTender.title);
    const marketTokens = tokens(marketTender.title);
    const candidates = new Set(byBuyer.get(marketTender.buyerEdrpou) ?? []);
    [...marketTokens]
      .filter((token) => token.length >= 5)
      .sort((left, right) => right.length - left.length)
      .slice(0, 10)
      .forEach((token) => (byToken.get(token) ?? []).forEach((item) => candidates.add(item)));

    for (const item of candidates) {
      const amountDelta = marketTender.amount > 0 && item.value > 0
        ? Math.abs(item.value - marketTender.amount) / marketTender.amount
        : 1;
      const closeAmount = amountDelta <= 0.02;
      // Найдешевша умова — першою: збіг ЄДРПОУ замовника при близькій сумі
      // вирішує справу без жодного порівняння назв.
      if (closeAmount && marketTender.buyerEdrpou && item.buyerEdrpou === marketTender.buyerEdrpou) return item;

      // Точна межа, а не евристика: |A∩B| ніколи не більше за меншу з множин,
      // тому Жаккар не може перевищити min(|A|,|B|) / max(|A|,|B|). Якщо це
      // відношення вже нижче за потрібний поріг, рахувати схожість немає сенсу —
      // відповідь відома наперед. Саме ця відсічка й прибирає більшість
      // кандидатів, не торкаючись їхніх слів.
      const threshold = closeAmount ? 0.42 : 0.72;
      const sizes = [marketTokens.size, item.titleTokens.size];
      const ratio = Math.max(...sizes) ? Math.min(...sizes) / Math.max(...sizes) : 0;
      if (ratio >= threshold && tokenSimilarity(marketTokens, item.titleTokens) >= threshold) return item;

      if (marketTitle.length > 24 && item.normalizedTitle.length > 24
        && (marketTitle.includes(item.normalizedTitle) || item.normalizedTitle.includes(marketTitle))) return item;
    }
    return undefined;
  };
}
