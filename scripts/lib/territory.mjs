const KYIV_TEXT = /(?:м(?:істо)?\.?\s*київ|київськ(?:а|ої|ій|у|ою)\s+(?:област(?:ь|і|ю)|обл\.?))/i;
const OUTSIDE_REGION_TEXT = /(?:вінницьк|волинськ|дніпропетровськ|донецьк|житомирськ|закарпатськ|запорізьк|івано-франківськ|кіровоградськ|львівськ|миколаївськ|одеськ|полтавськ|рівненськ|сумськ|тернопільськ|харківськ|херсонськ|хмельницьк|черкаськ|чернівецьк|чернігівськ|луганськ)(?:а|ої|ій|у|ою)?\s+(?:област(?:ь|і|ю)|обл\.?)/i;
const OUTSIDE_CITY_TEXT = /м(?:істо)?\.?\s*(?:вінниц|дніпр|донецьк|житомир|ужгород|запоріжж|івано-франківськ|кропивницьк|луцьк|львів|миколаїв|одес|полтав|рівн|сум|тернопіл|харків|херсон|хмельницьк|черкас|чернівц|чернігів|луганськ|хуст)/i;

export const scopedTerritoryDirections = new Set(["Капбудівництво", "Сервіс"]);

function isKyivTerritory(value) {
  return KYIV_TEXT.test(String(value ?? "").trim());
}

function isOutsideTerritory(value) {
  const text = String(value ?? "");
  return OUTSIDE_REGION_TEXT.test(text) || OUTSIDE_CITY_TEXT.test(text);
}

/**
 * Джерела місця робіт, у порядку довіри:
 *   1. адреса виконання з деталей закупівлі;
 *   2. адреса всередині опису предмета закупівлі (теж деталі, але текстом);
 *   3. точна адреса чи область у назві;
 *   4. інакше — «уточнити місце робіт».
 * Адреса організатора доказом не є ніколи.
 *
 * @param {{
 *   direction: string | null,
 *   title: string,
 *   organizerRegion?: string,
 *   deliveryLocations?: string[],
 *   deliveryDescriptions?: string[],
 * }} input
 */
export function classifyTerritory({ direction, title, organizerRegion, deliveryLocations = [], deliveryDescriptions = [] }) {
  if (!scopedTerritoryDirections.has(direction)) {
    return {
      territoryStatus: "nationwide",
      territoryLabel: "Вся Україна",
      territorySource: "profile",
    };
  }

  const actualLocations = deliveryLocations.map((value) => String(value ?? "").trim()).filter(Boolean);
  if (actualLocations.length) {
    const isTarget = actualLocations.some(isKyivTerritory);
    return {
      territoryStatus: isTarget ? "target" : "outside",
      territoryLabel: isTarget ? "Київ та Київська область" : actualLocations.join(" · "),
      territorySource: "delivery-address",
    };
  }

  const described = deliveryDescriptions.map((value) => String(value ?? "").trim()).filter(Boolean);
  if (described.some(isKyivTerritory)) {
    return {
      territoryStatus: "target",
      territoryLabel: "Київ та Київська область",
      territorySource: "delivery-description",
    };
  }
  if (described.some(isOutsideTerritory)) {
    return {
      territoryStatus: "outside",
      territoryLabel: "Інша область України",
      territorySource: "delivery-description",
    };
  }

  if (isKyivTerritory(title)) {
    return {
      territoryStatus: "target",
      territoryLabel: "Київ та Київська область",
      territorySource: "title",
    };
  }

  if (isOutsideTerritory(title)) {
    return {
      territoryStatus: "outside",
      territoryLabel: "Інша область України",
      territorySource: "title",
    };
  }

  return {
    territoryStatus: "unknown",
    territoryLabel: organizerRegion ? `Місце робіт не вказано · замовник: ${organizerRegion}` : "Місце робіт не вказано",
    territorySource: organizerRegion ? "organizer-fallback" : "unknown",
  };
}

export function isTargetTerritory(item) {
  return item.territoryStatus === "target" || item.territoryStatus === "nationwide";
}
