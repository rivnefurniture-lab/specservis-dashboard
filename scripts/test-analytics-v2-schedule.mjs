import assert from "node:assert/strict";
import {
  ANALYTICS_CRON_INTERVAL_MINUTES,
  analyticsControlWindow,
  analyticsDiscoveryWindow,
} from "../src/lib/analytics-v2-schedule.ts";

assert.equal(ANALYTICS_CRON_INTERVAL_MINUTES, 5);

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

console.log("analytics v2 schedule: discovery and durable control slots passed");
