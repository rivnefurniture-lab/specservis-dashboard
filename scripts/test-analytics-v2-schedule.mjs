import assert from "node:assert/strict";
import {
  ANALYTICS_CRON_INTERVAL_MINUTES,
  DEFAULT_ANALYTICS_HISTORY_FROM,
  analyticsControlWindow,
  analyticsDiscoveryWindow,
  analyticsHistoryStart,
} from "../src/lib/analytics-v2-schedule.ts";

assert.equal(ANALYTICS_CRON_INTERVAL_MINUTES, 5);
assert.equal(DEFAULT_ANALYTICS_HISTORY_FROM, "2023-01-01");
assert.equal(analyticsHistoryStart(undefined, new Date("2026-08-28T12:00:00Z")), "2023-01-01");
assert.equal(analyticsHistoryStart(" 2024-02-29 ", new Date("2026-08-28T12:00:00Z")), "2024-02-29");
assert.equal(analyticsHistoryStart("2024-02-30", new Date("2026-08-28T12:00:00Z")), "2023-01-01");
assert.equal(analyticsHistoryStart("2030-01-01", new Date("2026-08-28T12:00:00Z")), "2023-01-01");

const minutes = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];
const windows = minutes.map((minute) =>
  analyticsDiscoveryWindow(new Date(`2026-08-13T09:${String(minute).padStart(2, "0")}:00Z`)),
);

assert.deepEqual(windows.slice(0, 6), [
  "today",
  "historical",
  "yesterday",
  "historical",
  "historical",
  "historical",
]);
assert.equal(windows.filter((window) => window === "historical").length, 8);

assert.deepEqual(
  minutes.map((minute) =>
    analyticsControlWindow(new Date(`2026-08-13T09:${String(minute).padStart(2, "0")}:00Z`)),
  ),
  ["recent-30-days", "contracts", "full-history", "recent-30-days", "contracts", "full-history",
    "recent-30-days", "contracts", "full-history", "recent-30-days", "contracts", "full-history"],
);

console.log("analytics v2 schedule: history boundary, discovery and durable control slots passed");
