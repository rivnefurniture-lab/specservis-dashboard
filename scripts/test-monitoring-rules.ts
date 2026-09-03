import assert from "node:assert/strict";
import {
  classifyMonitoringCandidate,
  DEFAULT_MONITORING_RULE_SET,
  matchesCpvRule,
  normalizeMonitoringText,
  stemMonitoringText,
  transliterateMonitoringText,
  type MonitoringRuleSet,
} from "../src/lib/monitoring-rules";
import {
  collapseDirectionRows,
  directionsForAccount,
  expandDirectionGroups,
} from "../src/lib/tender-scope";

assert.equal(
  normalizeMonitoringText("  ПРОЕКТНО–кошторисна, документація!  "),
  "проєктно кошторисна документація",
);
assert.equal(normalizeMonitoringText("Кондеціонер"), "кондиціонер");
assert.equal(transliterateMonitoringText("Тепловий насос"), "teplovyy nasos");
assert.equal(stemMonitoringText("кондиціонерами"), stemMonitoringText("кондиціонер"));
assert.deepEqual(expandDirectionGroups(["construction"]), ["construction", "design", "Капбудівництво"]);
assert.ok(directionsForAccount("Сервіс").includes("conditioning"));
assert.deepEqual(collapseDirectionRows([
  { id: "conditioning", slug: "conditioning", label: "Кондиціонування", primary: true },
  { id: "ventilation", slug: "ventilation", label: "Вентиляція", primary: false },
]), [{ id: "service-climate", slug: "service-climate", label: "Сервіс і кондиціонування", primary: true }]);

assert.equal(matchesCpvRule("45331220-4", { code: "45300000", includeDescendants: true }), true);
assert.equal(matchesCpvRule("45331220-4", { code: "45300000", includeDescendants: false }), false);
assert.equal(matchesCpvRule("45233142-6", { code: "45233000", includeDescendants: true }), true);

const overlap = classifyMonitoringCandidate({
  cpvCodes: ["45331220-4"],
  procurementTitle: "Капітальний ремонт: монтаж кондиціонерів та припливно-витяжної вентиляції",
  itemDescriptions: ["Спліт-система Cooper & Hunter та рекуператор"],
});

assert.equal(overlap.primaryDirectionId, "conditioning");
assert.deepEqual(
  overlap.matches.map((match) => match.directionId),
  ["conditioning", "ventilation", "construction"],
);
assert.equal(overlap.matches.filter((match) => match.primary).length, 1);
assert.equal(overlap.matches[0]?.confidence, "high");
assert.ok(overlap.matches[0]?.reasons.some((reason) => reason.field === "item_description"));
assert.equal(overlap.ruleVersion, DEFAULT_MONITORING_RULE_SET.version);

const russianDesign = classifyMonitoringCandidate({
  cpvCodes: ["71242000"],
  procurementTitle: "Разработка проектно-сметной документации для здания",
});
assert.equal(russianDesign.primaryDirectionId, "design");
assert.equal(russianDesign.matches[0]?.confidence, "high");

const heating = classifyMonitoringCandidate({
  cpvCodes: ["45331000"],
  procurementTitle: "Реконструкція системи опалення та котельні",
});
assert.equal(heating.primaryDirectionId, "heating");
assert.equal(
  DEFAULT_MONITORING_RULE_SET.directions.find((direction) => direction.id === "heating")?.analysisOnly,
  true,
);

const broadNeedsReview = classifyMonitoringCandidate({
  cpvCodes: ["45331000"],
  procurementTitle: "Загальні монтажні роботи",
});
assert.equal(broadNeedsReview.primaryDirectionId, "construction");
assert.equal(broadNeedsReview.matches.some((match) => match.directionId === "conditioning"), false);
assert.equal(broadNeedsReview.matches.some((match) => match.directionId === "ventilation"), false);

const contextualCpv = classifyMonitoringCandidate({
  cpvCodes: ["45331000"],
  procurementTitle: "Монтаж системи кондиціонування та вентиляції",
});
assert.equal(contextualCpv.primaryDirectionId, "conditioning");
assert.deepEqual(contextualCpv.matches.map((match) => match.directionId), ["conditioning", "ventilation", "construction"]);

const excludedRoad = classifyMonitoringCandidate({
  cpvCodes: ["45233142"],
  procurementTitle: "Поточний ремонт автомобільної дороги державного значення",
});
assert.equal(excludedRoad.primaryDirectionId, null);
assert.equal(excludedRoad.matches.length, 0);

const latinVariant = classifyMonitoringCandidate({
  procurementTitle: "Supply and installation of split system Daikin",
});
assert.equal(latinVariant.primaryDirectionId, "conditioning");
assert.ok(latinVariant.matches[0]?.reasons.some((reason) => reason.kind === "brand"));

const broadBrandWithoutContext = classifyMonitoringCandidate({ procurementTitle: "Телевізор Samsung" });
assert.equal(broadBrandWithoutContext.primaryDirectionId, null);

const broadBrandWithContext = classifyMonitoringCandidate({ procurementTitle: "Кондиціонер Samsung 12000 BTU" });
assert.equal(broadBrandWithContext.primaryDirectionId, "conditioning");

const exactShortBrand = classifyMonitoringCandidate({ procurementTitle: "Спліт-система C&H" });
assert.equal(exactShortBrand.primaryDirectionId, "conditioning");
const lettersAreNotBrand = classifyMonitoringCandidate({ procurementTitle: "Послуги секції C H 12" });
assert.equal(lettersAreNotBrand.primaryDirectionId, null);

for (const brand of ["OLMO", "Climaveneta", "PRANA", "Aermec", "Бітцер", "CLINT", "Trane", "Sakata"]) {
  assert.equal(classifyMonitoringCandidate({ procurementTitle: `Поставка обладнання ${brand}` }).primaryDirectionId, "conditioning");
}

for (const title of [
  "Апарат штучної вентиляції легень для лікарні",
  "Автомобільний кондиціонер та запчастини",
  "Побутовий холодильник для гуртожитку",
]) {
  assert.equal(classifyMonitoringCandidate({ procurementTitle: title }).primaryDirectionId, null);
}

const customRuleSet: MonitoringRuleSet = {
  id: "custom",
  version: "test.1",
  directions: [{
    id: "construction",
    label: "Будівництво",
    priority: 1,
    enabledForMonitoring: true,
    cpv: [{ code: "45000000", includeDescendants: true }],
    excludedCpv: [{ code: "45233000", includeDescendants: true }],
    terms: [],
  }],
};

assert.equal(classifyMonitoringCandidate({ cpvCodes: ["45453000"] }, customRuleSet).primaryDirectionId, "construction");
assert.equal(classifyMonitoringCandidate({ cpvCodes: ["45233142"] }, customRuleSet).primaryDirectionId, null);

console.log("monitoring rules: normalization, CPV hierarchy, overlap, priority, exclusions and confidence passed");
