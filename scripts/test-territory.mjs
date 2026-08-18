import assert from "node:assert/strict";
import { classifyTerritory, isTargetTerritory } from "./lib/territory.mjs";

const classify = (input) => classifyTerritory({ title: "", organizerRegion: "", deliveryLocations: [], deliveryDescriptions: [], ...input });

assert.equal(classify({ direction: "Кондиціонування", deliveryLocations: ["Одеська область"] }).territoryStatus, "nationwide");
assert.equal(classify({ direction: "Капбудівництво", deliveryLocations: ["Київська область · Бровари"] }).territoryStatus, "target");
assert.equal(classify({ direction: "Сервіс", deliveryLocations: ["місто Київ · Солом’янський район"] }).territoryStatus, "target");
assert.equal(classify({ direction: "Капбудівництво", deliveryLocations: ["Одеська область · Рені"] }).territoryStatus, "outside");
assert.equal(classify({ direction: "Сервіс", deliveryLocations: ["Львівська область"] }).territoryStatus, "outside");
assert.equal(classify({ direction: "Капбудівництво", title: "Ремонт школи у м. Київ" }).territoryStatus, "target");
assert.equal(classify({ direction: "Капбудівництво", title: "Ремонт будівлі, Одеська область" }).territoryStatus, "outside");
assert.equal(classify({ direction: "Сервіс", organizerRegion: "Київська область" }).territoryStatus, "unknown");
assert.equal(classify({ direction: "Сервіс", organizerRegion: "Львівська область" }).territoryStatus, "unknown");
assert.equal(classify({ direction: "Капбудівництво", title: "Нове будівництво казарми в м. Тернопіль" }).territoryStatus, "outside");
assert.equal(classify({ direction: "Капбудівництво", title: "Ремонт об'єкта в м. Харків" }).territoryStatus, "outside");
assert.equal(classify({ direction: "Капбудівництво", title: "Ремонт будівлі в м. Хуст" }).territoryStatus, "outside");
assert.equal(classify({ direction: "Сервіс" }).territoryStatus, "unknown");
// Адреса всередині опису предмета — теж деталі закупівлі, а не адреса замовника.
assert.equal(classify({ direction: "Капбудівництво", deliveryDescriptions: ["Капітальний ремонт покрівлі за адресою: м. Київ, вул. Хрещатик, 1"] }).territoryStatus, "target");
assert.equal(classify({ direction: "Капбудівництво", deliveryDescriptions: ["Ремонт даху, Харківська область, м. Ізюм"] }).territoryStatus, "outside");
assert.equal(classify({ direction: "Капбудівництво", deliveryDescriptions: ["Ремонт покрівлі згідно з документацією"] }).territoryStatus, "unknown");
// Явна адреса виконання завжди сильніша за опис.
assert.equal(classify({ direction: "Капбудівництво", deliveryLocations: ["Львівська область"], deliveryDescriptions: ["м. Київ"] }).territoryStatus, "outside");
assert.equal(classify({ direction: "Капбудівництво", deliveryDescriptions: ["м. Київ"] }).territorySource, "delivery-description");
// Регіон замовника не робить тендер київським за жодних обставин.
assert.equal(classify({ direction: "Капбудівництво", organizerRegion: "місто Київ" }).territoryStatus, "unknown");

assert.equal(isTargetTerritory({ territoryStatus: "nationwide" }), true);
assert.equal(isTargetTerritory({ territoryStatus: "outside" }), false);

console.log("territory classification: ok");
