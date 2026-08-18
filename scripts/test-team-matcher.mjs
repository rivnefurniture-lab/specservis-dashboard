// @ts-check

/**
 * Захист для зіставлення ринкової закупівлі з рядком Excel.
 *
 * Тут перевіряється не «щось знайшлося», а саме межі правила: пороги 0,42 і
 * 0,72 підібрані під міру Жаккара, і будь-яка спроба «трохи спростити»
 * нормалізацію чи схожість тихо зсуває покриття всього ринку.
 *
 * Запуск: node scripts/test-team-matcher.mjs
 */

import assert from "node:assert/strict";
import { createTeamMatcher, tokenSimilarity, tokens } from "./lib/team-matcher.mjs";

let checks = 0;
const check = (/** @type {string} */ name, /** @type {() => void} */ fn) => {
  fn();
  checks += 1;
  console.log(`  ✓ ${name}`);
};

console.log("міра схожості");

check("однакові назви дають одиницю", () => {
  const a = tokens("Капітальний ремонт покрівлі школи №112");
  assert.equal(tokenSimilarity(a, a), 1);
});

check("порожня множина дає нуль", () => {
  assert.equal(tokenSimilarity(new Set(), tokens("ремонт покрівлі")), 0);
});

check("знаменник — об'єднання, а не менша множина", () => {
  const a = new Set(["алфа", "бета"]);
  const b = new Set(["алфа", "бета", "гама", "дельта"]);
  // Спільних 2, різних усього 4 → 0,5. Якби ділили на меншу множину, вийшла б
  // одиниця, і поріг 0,72 спрацьовував би на зовсім різних назвах.
  assert.equal(tokenSimilarity(a, b), 0.5);
});

check("службові слова не створюють схожості", () => {
  // Після нормалізації в обох назвах не лишається спільних значущих слів.
  const score = tokenSimilarity(tokens("Роботи згідно з ДК 021:2015"), tokens("Послуги за кодом ДК 021:2015"));
  assert.ok(score < 0.42, `очікували менше за 0,42, отримали ${score}`);
});

console.log("\nзіставлення з реєстром");

const registry = [
  { id: 1, title: "Капітальний ремонт покрівлі школи №112 у місті Києві", buyerEdrpou: "12345678", value: 1_000_000 },
  { id: 2, title: "Нове будівництво газової котельні", buyerEdrpou: "87654321", value: 5_000_000 },
];
const match = createTeamMatcher(registry);

check("той самий замовник і та сама сума — збіг", () => {
  assert.equal(match({ title: "Зовсім інша назва", buyerEdrpou: "12345678", amount: 1_000_000 })?.id, 1);
});

check("той самий замовник, але інша сума — не збіг", () => {
  assert.equal(match({ title: "Зовсім інша назва", buyerEdrpou: "12345678", amount: 400_000 }), undefined);
});

check("майже однакова назва — збіг навіть без замовника", () => {
  assert.equal(match({ title: "Капітальний ремонт покрівлі школи №112 у місті Києві", buyerEdrpou: "", amount: 0 })?.id, 1);
});

check("одна назва всередині іншої — збіг", () => {
  assert.equal(match({ title: "Нове будівництво газової котельні за адресою вулиця Лесі Українки 5", buyerEdrpou: "", amount: 0 })?.id, 2);
});

check("схожа тема, але інший об'єкт — не збіг", () => {
  assert.equal(match({ title: "Поточний ремонт фасаду дитячого садка", buyerEdrpou: "", amount: 0 }), undefined);
});

check("порожній реєстр нікого не знаходить", () => {
  assert.equal(createTeamMatcher([])({ title: "Будь-що", buyerEdrpou: "1", amount: 1 }), undefined);
});

console.log(`\n${checks} перевірок пройдено`);
