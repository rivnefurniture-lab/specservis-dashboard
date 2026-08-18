import assert from "node:assert/strict";
import {
  canonicalReasons,
  canonicalStatuses,
  resolveReason,
  resolveStatus,
} from "../src/lib/workbook-dictionary.mjs";

// Довідник «База» містить рівно 18 статусів; кожен має унікальний код.
assert.equal(canonicalStatuses.length, 18);
assert.equal(new Set(canonicalStatuses.map((item) => item.code)).size, 18);
assert.equal(canonicalReasons.length, 8);

// Кожне значення довідника має розпізнаватися саме собою.
for (const status of canonicalStatuses) {
  assert.equal(resolveStatus(status.label).code, status.code, `status ${status.label}`);
  assert.equal(resolveStatus(status.label).canonical, true);
}
for (const reason of canonicalReasons) {
  assert.equal(resolveReason(reason.source).code, reason.code, `reason ${reason.source}`);
}

// Головна регресія: «Інший переможець» — це програш, а не перемога.
assert.equal(resolveStatus("Інший переможець").group, "lost");
assert.equal(resolveStatus("Обрані переможцем").group, "won");
assert.equal(resolveStatus("Укладено договір").group, "won");
assert.equal(resolveStatus("Дискваліфіковано").group, "lost");
assert.equal(resolveStatus("Всіх дискваліфіковано").group, "cancelled");

// Активна черга — рівно за визначенням власника.
const workQueue = canonicalStatuses.filter((item) => item.workQueue).map((item) => item.label).sort();
assert.deepEqual(workQueue, [
  "Аналіз закупівлі",
  "Готуємо пропозицію",
  "Документи подано",
  "Кваліфікація",
  "Скарга від нас на конкурента",
  "Скарга від нас на нашу дискваліфікацію",
  "Скарга від нас на умови",
].sort());
assert.equal(resolveStatus("Скарга на нас").workQueue, false);
assert.equal(resolveStatus("Відмова від участі").workQueue, false);

// Порожня клітинка — окремий стан, а не «нічого».
assert.equal(resolveStatus("").code, "none");
assert.equal(resolveStatus(null).code, "none");
assert.equal(resolveStatus("   ").code, "none");

// Зворотний хід: мітка, збережена в snapshot, має розпізнаватися тим самим кодом.
// Без цього «Без статусу» рахувався б як невідомий статус.
for (const status of [...canonicalStatuses, resolveStatus("")]) {
  const roundTrip = resolveStatus(status.label);
  assert.equal(roundTrip.code, status.code, `round-trip ${status.label}`);
  assert.equal(roundTrip.canonical, true, `round-trip canonical ${status.label}`);
}

// Невідомий статус не підганяється під схожий, а позначається як розбіжність.
const unknown = resolveStatus("Новий статус якого немає в довіднику");
assert.equal(unknown.code, "unrecognised");
assert.equal(unknown.canonical, false);
assert.equal(unknown.label, "Новий статус якого немає в довіднику");
assert.equal(unknown.workQueue, false);

// Різна кількість пробілів і пробіли навколо слеша не мають значення.
assert.equal(resolveStatus("  Аналіз   закупівлі ").code, "analysis");
assert.equal(resolveReason("нецікавий бюджет / рентабельність / логістика").code, "budget");
assert.equal(resolveReason("недостатньо ресурсів або часу для підготовки").code, "resources");

// Регресія: «Відмова від участі» більше не читається як причина «час»
// через збіг підрядка «час» усередині слова «участі».
assert.equal(resolveReason("Відмова від участі").code, "manual");
assert.equal(resolveReason("").code, "none");
assert.equal(resolveReason("").label, "Не вказано");

// Довільний текст зберігає окремий код і не отримує вигаданої категорії.
const manual = resolveReason("Давайте не надо, намучаемся с подготовкой");
assert.equal(manual.code, "manual");
assert.equal(manual.canonical, false);

console.log(`workbook dictionary: ${canonicalStatuses.length} statuses and ${canonicalReasons.length} reasons passed`);
