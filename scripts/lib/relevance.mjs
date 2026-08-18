const constructionCodeList = [
  "45000000",
  "45100000", "45110000", "45111000", "45112000", "45112700", "45113000",
  "45200000", "45210000", "45211000", "45211100", "45211300", "45212000",
  "45213000", "45214000", "45214100", "45214200", "45214300", "45214400",
  "45215000", "45215100", "45215200", "45216100", "45216200", "45220000",
  "45221000", "45222000", "45223000", "45223100", "45223200", "45231100",
  "45232150", "45233220", "45260000",
  "45300000", "45310000", "45311000", "45312000", "45312100", "45314300",
  "45315000", "45316000", "45317000", "45320000", "45321000", "45323000",
  "45324000", "45331100", "45332000", "45333000", "45340000", "45342000",
  "45343000",
  "45400000", "45410000", "45420000", "45421000", "45421100", "45422000",
  "45430000", "45431000", "45432000", "45440000", "45442100", "45443000",
  "45450000", "45451000", "45452000", "45453000", "45454000",
  "71000000", "71100000", "71110000", "71111000", "71112000", "71120000",
  "71200000", "71210000", "71220000", "71221000", "71222000", "71223000",
  "71240000", "71241000", "71242000", "71243000", "71244000", "71245000",
  "71300000", "71310000", "71311000", "71312000", "71313000", "71313400",
  "71320000", "71321000", "71322000", "71322100", "71322500", "71323000",
  "71324000", "71325000", "71327000", "71328000",
  "71500000", "71510000", "71520000", "71521000", "71530000", "71540000",
  "71630000", "71700000",
];

const serviceCodeList = [
  "50000000", "50400000", "50410000", "50420000", "50430000", "50500000",
  "50530000", "50700000", "50710000", "50711000", "50712000", "50720000",
  "50721000", "50730000",
];

const conditioningCodeList = [
  "39700000", "39710000", "42500000", "42510000", "42513000", "42520000",
  "45330000", "45331000", "45331200",
];

export const constructionCodes = new Set(constructionCodeList);
export const serviceCodes = new Set(serviceCodeList);
export const conditioningCodes = new Set(conditioningCodeList);

const broadConditioningCodes = new Set(["39700000", "39710000", "45330000", "45331000"]);
const broadServiceCodes = new Set(["50000000"]);

const conditioningKeywords = /теплообмін|кондиц|систем.*вентиляц|вентиляційн.*обладнан|вентсистем|димовидален|витяжн.*зонт|морозильн|холодильн|кріоген|ч[іи]л+ер|випарн.*конденсатор|спліт|теплов.*насос|повітрян.*фільтр|кліматичн.*(технік|систем)|рекуператор|приточ|фанкойл|анемостат|руфтоп|повітровод|калорифер|пральн.*обладнан|холодильн.*агрегат|cooper\s*&?\s*hunter|mitsubishi|tosot|olmo|daikin|neoclima|climaveneta|prana|gree|haier|midea|panasonic|aermec|hitachi|samsung|trane|york|60000\s*btu|48000\s*btu|36000\s*btu|24000\s*btu|18000\s*btu|12000\s*btu|9000\s*btu|7000\s*btu/i;

const serviceKeywords = /(ремонт|технічн.*обслугов).*(будівельн.*конструкц|електричн.*устаткуван|механічн.*устаткуван|систем.*опален|охолоджувальн.*установ|насос|клапан|компресор|високоточн.*обладнан|вимірювальн.*прилад|випробувальн.*прилад|контрольн.*прилад|промислов.*обладнан|технологічн.*обладнан)|(будівельн.*конструкц|електричн.*устаткуван|механічн.*устаткуван|систем.*опален|охолоджувальн.*установ|насос|клапан|компресор|високоточн.*обладнан|вимірювальн.*прилад|випробувальн.*прилад|контрольн.*прилад|промислов.*обладнан|технологічн.*обладнан).*(ремонт|технічн.*обслугов)/i;

const conditioningNegative = /штучн.*вентиляц.*леген|апарат.*швл|вентилятор.*підлогов/i;

const excludedInfrastructureCodes = /^(45221|45233|713225)/;
const excludedInfrastructureTitles = /автомобільн.*дорог|автодорожн.{0,30}(переїзд|міст|шлях)|ремонт(?:ування)?.{0,45}дорог|дорожн(?:ього|є|ій|я).{0,30}(покрит|полотн)|капітальн.{0,20}ремонт.{0,35}проїзд.{0,20}тротуар|(?:будівництв|ремонт|реставрац|проєкт|проект).{0,70}(мосту|мостов|тунел)|мостов.{0,20}переход|транспортн.{0,20}інфраструкт|залізничн.{0,20}дорог|аеродром|експлуатаційн.{0,20}утриман.{0,40}дорог|систем.{0,25}зважуван.{0,20}(?:у|в)\s*рус|\bWIM\b|велосипедн.{0,25}(доріж|маршрут)/i;

function exclusionReason(code, title) {
  if (excludedInfrastructureCodes.test(code)) return `excluded-cpv:${code}`;
  if (excludedInfrastructureTitles.test(title)) return "excluded-subject:transport-infrastructure";
  if (conditioningNegative.test(title)) return "excluded-subject:medical-or-household-ventilator";
  return null;
}

export function classifyTender(codeValue, titleValue) {
  const code = String(codeValue ?? "").replace(/\D/g, "").slice(0, 8);
  const title = String(titleValue ?? "");
  const excluded = exclusionReason(code, title);
  if (excluded) return { direction: null, reason: excluded };

  if (conditioningCodes.has(code)) {
    if (broadConditioningCodes.has(code) && !conditioningKeywords.test(title)) {
      return { direction: null, reason: `unconfirmed-broad-cpv:${code}` };
    }
    return { direction: "Кондиціонування", reason: `cpv:${code}` };
  }

  if (serviceCodes.has(code)) {
    if (broadServiceCodes.has(code) && !serviceKeywords.test(title)) {
      return { direction: null, reason: `unconfirmed-broad-cpv:${code}` };
    }
    return { direction: "Сервіс", reason: `cpv:${code}` };
  }

  if (constructionCodes.has(code)) {
    return { direction: "Капбудівництво", reason: `cpv:${code}` };
  }

  if (conditioningKeywords.test(title)) return { direction: "Кондиціонування", reason: "keyword:conditioning" };
  if (serviceKeywords.test(title)) return { direction: "Сервіс", reason: "keyword:service" };
  return { direction: null, reason: "not-in-approved-profile" };
}
