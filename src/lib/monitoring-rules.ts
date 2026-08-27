export type MonitoringDirectionId =
  | "construction"
  | "design"
  | "conditioning"
  | "ventilation"
  | "heating";

export type MonitoringConfidence = "high" | "medium" | "review";

export type MonitoringTextField =
  | "procurement_title"
  | "procurement_description"
  | "lot_title"
  | "lot_description"
  | "item_description";

export type CpvRule = {
  code: string;
  includeDescendants?: boolean;
};

export type MonitoringTerm = {
  value: string;
  variants?: string[];
  /** Require a relevant CPV or another unambiguous subject term. */
  requiresContext?: boolean;
  /** Match a complete normalized phrase, not an arbitrary substring. */
  exactPhrase?: boolean;
};

export type MonitoringDirectionRule = {
  id: MonitoringDirectionId;
  label: string;
  priority: number;
  enabledForMonitoring: boolean;
  analysisOnly?: boolean;
  cpv: CpvRule[];
  excludedCpv?: CpvRule[];
  terms: MonitoringTerm[];
  brands?: MonitoringTerm[];
  exclusions?: MonitoringTerm[];
  broadCpv?: string[];
};

export type MonitoringRuleSet = {
  id: string;
  version: string;
  directions: MonitoringDirectionRule[];
};

export type MonitoringCandidate = {
  cpvCodes?: string[];
  procurementTitle?: string;
  procurementDescription?: string;
  lotTitle?: string;
  lotDescription?: string;
  itemDescriptions?: string[];
};

export type MonitoringMatchReason = {
  kind: "cpv" | "term" | "brand";
  value: string;
  field: MonitoringTextField | "cpv";
  confidence: MonitoringConfidence;
};

export type MonitoringDirectionMatch = {
  directionId: MonitoringDirectionId;
  directionLabel: string;
  confidence: MonitoringConfidence;
  reasons: MonitoringMatchReason[];
  excludedReasons: string[];
  primary: boolean;
  ruleVersion: string;
};

export type MonitoringClassification = {
  primaryDirectionId: MonitoringDirectionId | null;
  matches: MonitoringDirectionMatch[];
  ruleVersion: string;
};

const TYPO_REPLACEMENTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/кондец(?:і|и)он/gu, "кондиціон"],
  [/кондиц(?:і|и)ан/gu, "кондиціон"],
  [/вент(?:і|и)ляц(?:і|и)я/gu, "вентиляція"],
  [/вент(?:і|и)л(?:я|а)ц/gu, "вентиляц"],
  [/проект/gu, "проєкт"],
  [/кошторисн/gu, "кошторисн"],
  [/отоплен/gu, "опален"],
  [/охлажден/gu, "охолоджен"],
];

const LATIN_MAP: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "h", ґ: "g", д: "d", е: "e", є: "ye",
  ж: "zh", з: "z", и: "y", і: "i", ї: "yi", й: "y", к: "k", л: "l",
  м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u",
  ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch", ь: "",
  ы: "y", э: "e", ю: "yu", я: "ya", ё: "yo", ъ: "",
};

const WORD_ENDINGS = [
  "уваннями", "юваннями", "ування", "ювання", "еннями", "аннями", "іннями",
  "овування", "ювальний", "ювальна", "ювальні", "ічного", "ичного", "ального",
  "овного", "евного", "ення", "ання", "іння", "ового", "евої", "ними", "ному",
  "анням", "енням", "ання", "ення", "ами", "ями", "ого", "ому", "ими", "ій",
  "ий", "ої", "ею", "ою", "ів", "ов", "ам", "ям", "ах", "ях", "и", "і", "а",
  "я", "у", "ю", "е", "о",
].sort((left, right) => right.length - left.length);

export function normalizeMonitoringText(value: unknown): string {
  let normalized = String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("uk-UA")
    .replace(/[’`ʼ]/gu, "'")
    .replace(/&/gu, " and ")
    .replace(/\b(?:dk|дк)\s*0*/giu, "дк ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();

  for (const [pattern, replacement] of TYPO_REPLACEMENTS) {
    normalized = normalized.replace(pattern, replacement);
  }

  return normalized;
}

export function transliterateMonitoringText(value: unknown): string {
  return [...normalizeMonitoringText(value)]
    .map((character) => LATIN_MAP[character] ?? character)
    .join("");
}

function stemToken(token: string): string {
  if (token.length < 6 || /\d/u.test(token)) return token;
  const ending = WORD_ENDINGS.find((candidate) => token.endsWith(candidate) && token.length - candidate.length >= 4);
  return ending ? token.slice(0, -ending.length) : token;
}

export function stemMonitoringText(value: unknown): string {
  return normalizeMonitoringText(value).split(" ").map(stemToken).join(" ");
}

export function normalizeCpvCode(value: unknown): string {
  return String(value ?? "").replace(/\D/gu, "").slice(0, 8).padEnd(8, "0");
}

function cpvPrefix(code: string): string {
  const normalized = normalizeCpvCode(code);
  return normalized.replace(/0+$/u, "") || normalized;
}

export function matchesCpvRule(candidateValue: unknown, rule: CpvRule): boolean {
  const candidate = normalizeCpvCode(candidateValue);
  const ruleCode = normalizeCpvCode(rule.code);
  if (!candidate || candidate === "00000000") return false;
  return rule.includeDescendants ? candidate.startsWith(cpvPrefix(ruleCode)) : candidate === ruleCode;
}

type PreparedField = {
  field: MonitoringTextField;
  normalized: string;
  stemmed: string;
  transliterated: string;
};

function prepareFields(candidate: MonitoringCandidate): PreparedField[] {
  const rawFields: Array<[MonitoringTextField, unknown]> = [
    ["procurement_title", candidate.procurementTitle],
    ["procurement_description", candidate.procurementDescription],
    ["lot_title", candidate.lotTitle],
    ["lot_description", candidate.lotDescription],
    ...((candidate.itemDescriptions ?? []).map<[MonitoringTextField, unknown]>((value) => ["item_description", value])),
  ];

  return rawFields
    .filter(([, value]) => Boolean(String(value ?? "").trim()))
    .map(([field, value]) => ({
      field,
      normalized: normalizeMonitoringText(value),
      stemmed: stemMonitoringText(value),
      transliterated: transliterateMonitoringText(value),
    }));
}

function termForms(term: MonitoringTerm): string[] {
  return [term.value, ...(term.variants ?? [])]
    .flatMap((value) => [normalizeMonitoringText(value), stemMonitoringText(value), transliterateMonitoringText(value)])
    .filter((value, index, all) => Boolean(value) && all.indexOf(value) === index);
}

function findTerm(term: MonitoringTerm, fields: PreparedField[]): PreparedField | null {
  const forms = termForms(term);
  const contains = (haystack: string, needle: string) => term.exactPhrase
    ? ` ${haystack} `.includes(` ${needle} `)
    : haystack.includes(needle);
  return fields.find((field) => forms.some((form) => (
    contains(field.normalized, form)
    || contains(field.stemmed, form)
    || contains(field.transliterated, form)
  ))) ?? null;
}

function confidenceRank(value: MonitoringConfidence): number {
  return value === "high" ? 3 : value === "medium" ? 2 : 1;
}

function weakestConfidence(reasons: MonitoringMatchReason[]): MonitoringConfidence {
  if (reasons.some((reason) => reason.confidence === "high")) return "high";
  if (reasons.some((reason) => reason.confidence === "medium")) return "medium";
  return "review";
}

export function classifyMonitoringCandidate(
  candidate: MonitoringCandidate,
  ruleSet: MonitoringRuleSet = DEFAULT_MONITORING_RULE_SET,
): MonitoringClassification {
  const fields = prepareFields(candidate);
  const cpvCodes = (candidate.cpvCodes ?? []).map(normalizeCpvCode).filter((code) => code !== "00000000");

  const matches = ruleSet.directions.flatMap<MonitoringDirectionMatch>((direction) => {
    const excludedReasons: string[] = [];
    const excludedCpv = cpvCodes.find((code) => (direction.excludedCpv ?? []).some((rule) => matchesCpvRule(code, rule)));
    if (excludedCpv) excludedReasons.push(`cpv:${excludedCpv}`);

    for (const exclusion of direction.exclusions ?? []) {
      const found = findTerm(exclusion, fields);
      if (found) excludedReasons.push(`${found.field}:${exclusion.value}`);
    }

    if (excludedReasons.length > 0) return [];

    const reasons: MonitoringMatchReason[] = [];
    for (const code of cpvCodes) {
      const rule = direction.cpv.find((candidateRule) => matchesCpvRule(code, candidateRule));
      if (!rule) continue;
      const broad = (direction.broadCpv ?? []).map(normalizeCpvCode).includes(normalizeCpvCode(rule.code));
      reasons.push({ kind: "cpv", value: code, field: "cpv", confidence: broad ? "review" : "high" });
    }

    const foundTerms = direction.terms
      .map((term) => ({ term, field: findTerm(term, fields) }))
      .filter((item): item is { term: MonitoringTerm; field: PreparedField } => Boolean(item.field));
    const hasHighCpv = reasons.some((reason) => reason.kind === "cpv" && reason.confidence === "high");
    const hasUnambiguousTerm = foundTerms.some(({ term }) => !term.requiresContext);
    for (const { term, field } of foundTerms) {
      if (term.requiresContext && !hasHighCpv && !hasUnambiguousTerm) continue;
      reasons.push({ kind: "term", value: term.value, field: field.field, confidence: "medium" });
    }

    for (const brand of direction.brands ?? []) {
      const found = findTerm(brand, fields);
      if (!found || (brand.requiresContext && !hasHighCpv && !hasUnambiguousTerm)) continue;
      reasons.push({ kind: "brand", value: brand.value, field: found.field, confidence: "medium" });
    }

    if (reasons.length === 0) return [];

    const hasSupportingText = reasons.some((reason) => reason.kind !== "cpv");
    const onlyBroadCpv = reasons.every((reason) => reason.kind === "cpv" && reason.confidence === "review");
    if (onlyBroadCpv && !hasSupportingText) {
      return [];
    }

    const confidence = reasons.some((reason) => reason.kind === "cpv" && reason.confidence === "high") && hasSupportingText
      ? "high"
      : weakestConfidence(reasons);

    return [{
      directionId: direction.id,
      directionLabel: direction.label,
      confidence,
      reasons,
      excludedReasons,
      primary: false,
      ruleVersion: ruleSet.version,
    }];
  });

  matches.sort((left, right) => {
    const leftDirection = ruleSet.directions.find((direction) => direction.id === left.directionId);
    const rightDirection = ruleSet.directions.find((direction) => direction.id === right.directionId);
    return (rightDirection?.priority ?? 0) - (leftDirection?.priority ?? 0)
      || confidenceRank(right.confidence) - confidenceRank(left.confidence);
  });

  if (matches[0]) matches[0].primary = true;
  return {
    primaryDirectionId: matches[0]?.directionId ?? null,
    matches,
    ruleVersion: ruleSet.version,
  };
}

const term = (
  value: string,
  variants: string[] = [],
  options: Pick<MonitoringTerm, "requiresContext" | "exactPhrase"> = {},
): MonitoringTerm => ({ value, variants, ...options });
const cpv = (code: string, includeDescendants = true): CpvRule => ({ code, includeDescendants });

export const DEFAULT_MONITORING_RULE_SET: MonitoringRuleSet = {
  id: "monitoring-default",
  version: "2026.08.25.2",
  directions: [
    {
      id: "conditioning",
      label: "Кондиціонування",
      priority: 500,
      enabledForMonitoring: true,
      cpv: [cpv("39717200"), cpv("42500000"), cpv("45331220"), cpv("50730000"), cpv("45331000"), cpv("50700000"), cpv("50720000"), cpv("71315410"), cpv("71321400")],
      broadCpv: ["45331000", "50700000", "50720000", "71315410", "71321400"],
      terms: [
        term("кондиціонер", ["кондиціонери", "кондиционер", "кондиционеры", "conditioner", "air conditioner"]),
        term("кондиціонування", ["кондиціювання повітря", "кондиционирование", "air conditioning"]),
        term("система кондиціонування", ["клімат система", "кліматична система", "кліматична техніка", "система кондиционирования"]),
        term("спліт система", ["сплит система", "split system", "мультиспліт", "мультисплит"]),
        term("настінний кондиціонер", ["мобільний кондиціонер", "канальний кондиціонер", "касетний кондиціонер", "підлогово стельовий кондиціонер", "даховий кондиціонер", "прецизійний кондиціонер"]),
        term("руфтоп", ["дахова кліматична установка", "rooftop"]),
        term("чилер", ["чиллер", "чілер", "chiller"]),
        term("фанкойл", ["фанкойли", "fan coil", "fancoil"]),
        term("тепловий насос", ["теплові насоси", "тепловой насос"]),
        term("теплова завіса", ["повітряна теплова завіса", "тепловая завеса", "калорифер"]),
        term("холодильна камера", ["холодильні камери", "морозильна камера", "холодильная камера"]),
        term("холодильний агрегат", ["холодильне обладнання", "низькотемпературне холодильне обладнання", "низькотемпературний холодильний агрегат", "холодильное оборудование"]),
        term("випарний конденсатор", ["випарні конденсатори", "испарительный конденсатор"]),
        term("охолоджувальна установка", ["охолоджувальні установки", "охлаждающая установка"]),
        term("BTU", ["БТО", "БТЕ", "7000 btu", "9000 btu", "12000 btu", "18000 btu", "24000 btu", "36000 btu", "48000 btu", "60000 btu"], { requiresContext: true }),
        term("кріогенна камера", ["криогенная камера"], { requiresContext: true }),
        term("компресор", ["компресори", "холодильний компресор", "компрессор"], { requiresContext: true }),
        term("теплообмінник", ["теплообменник"], { requiresContext: true }),
        term("повітряний фільтр", ["воздушный фильтр"], { requiresContext: true }),
      ],
      brands: [
        term("Cooper&Hunter", ["Cooper & Hunter", "Cooper-Hunter", "Cooper Hunter"]),
        term("C&H", [], { exactPhrase: true }), term("TOSOT"), term("OLMO"), term("Daikin"),
        term("Neoclima"), term("Climaveneta"), term("PRANA"), term("Gree"), term("Aermec"),
        term("BITZER", ["Bitzer", "Бітцер", "Бітсер"]), term("CLINT"), term("Trane"), term("Sakata"),
        ...["Mitsubishi", "Mitsubishi Electric", "Mitsubishi Heavy Industries", "AUX", "TCL", "Toshiba", "LG", "Haier", "Midea", "Panasonic", "Samsung", "Hitachi", "York", "VENTS", "ВЕНТС", "Baltimore Aircoil", "BAC", "WITO", "DAIKO"]
          .map((value) => term(value, [], { requiresContext: true })),
      ],
      exclusions: [
        term("апарат штучної вентиляції легень", ["аппарат искусственной вентиляции легких", "ШВЛ", "медичне дихальне обладнання"]),
        term("автомобільний кондиціонер", ["автокондиціонер", "автомобильный кондиционер"]),
        term("побутовий вентилятор", ["настільний вентилятор", "підлоговий вентилятор"]),
        term("побутовий холодильник", ["морозильна скриня", "холодильник побутовий"]),
        term("пральне обладнання", ["кухонне обладнання", "обладнання харчоблоку"]),
      ],
    },
    {
      id: "ventilation",
      label: "Вентиляція",
      priority: 490,
      enabledForMonitoring: true,
      cpv: [cpv("42500000"), cpv("45331200"), cpv("50730000"), cpv("45331000"), cpv("50700000"), cpv("71315410"), cpv("71321400")],
      broadCpv: ["45331000", "50700000", "71315410", "71321400"],
      terms: [
        term("система вентиляції", ["вентиляція", "вентиляционное оборудование", "вентиляційне обладнання", "вентиляційна установка", "вентсистема"]),
        term("припливна установка", ["приточна установка", "витяжна установка", "припливно витяжна установка", "приточно вытяжная установка"]),
        term("вентиляційна камера", ["витяжна камера", "вентиляционная камера"]),
        term("димовидалення", ["вентиляція димовидалення", "система димовидалення", "дымоудаление"]),
        term("рекуператор", ["система рекуперації"]),
        term("повітровід", ["повітроводи", "повітровод", "воздуховод"]),
        term("анемостат"),
        term("витяжний зонт", ["витяжні зонти для харчоблоку", "вытяжной зонт"]),
        term("повітряний фільтр", ["воздушный фильтр"], { requiresContext: true }),
      ],
      exclusions: [term("апарат штучної вентиляції легень", ["аппарат искусственной вентиляции легких", "ШВЛ"]), term("вентилятор підлоговий", ["побутовий вентилятор", "настільний вентилятор"])],
    },
    {
      id: "heating",
      label: "Опалення",
      priority: 480,
      enabledForMonitoring: false,
      analysisOnly: true,
      cpv: [cpv("39715000"), cpv("42160000"), cpv("44620000"), cpv("45331000"), cpv("50720000")],
      broadCpv: ["45331000"],
      terms: [
        term("система опалення", ["система отопления"]),
        term("теплопостачання", ["теплоснабжение"]),
        term("котельня", ["котельная"]),
        term("радіатор опалення", ["радиатор отопления"]),
      ],
    },
    {
      id: "design",
      label: "Проєктування та кошториси",
      priority: 300,
      enabledForMonitoring: true,
      cpv: [cpv("71200000"), cpv("71300000")],
      excludedCpv: [cpv("71322500")],
      terms: [
        term("проєктно кошторисна документація", ["проектно сметная документация", "проектно кошторисна документація"]),
        term("розроблення проєкту", ["разработка проекта"]),
        term("кошторис", ["смета", "сметный расчет"]),
      ],
      exclusions: [term("автомобільна дорога", ["автомобильная дорога"]), term("міст через", ["мост через"])],
    },
    {
      id: "construction",
      label: "Будівництво та ремонти",
      priority: 200,
      enabledForMonitoring: true,
      cpv: [cpv("45000000"), cpv("45100000"), cpv("45200000"), cpv("45300000"), cpv("45400000")],
      excludedCpv: [cpv("45221000"), cpv("45233000"), cpv("45233100")],
      terms: [
        term("капітальний ремонт", ["капитальный ремонт"]),
        term("поточний ремонт", ["текущий ремонт"]),
        term("реконструкція", ["реконструкция"]),
        term("будівництво", ["строительство"]),
        term("реставрація", ["реставрация"]),
      ],
      exclusions: [
        term("автомобільна дорога", ["автомобильная дорога"]),
        term("дорожнє покриття", ["дорожное покрытие"]),
        term("велосипедна доріжка"),
        term("залізнична дорога"),
        term("міст через", ["мост через"]),
      ],
    },
  ],
};
