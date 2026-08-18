import assert from "node:assert/strict";
import {
  ANALYTICS_CRON_INTERVAL_MINUTES,
  analyticsDiscoveryWindow,
} from "../src/lib/analytics-v2-schedule.ts";

assert.equal(ANALYTICS_CRON_INTERVAL_MINUTES, 10);

const windows = [0, 10, 20, 30, 40, 50].map((minute) =>
  analyticsDiscoveryWindow(new Date(`2026-08-13T09:${String(minute).padStart(2, "0")}:00Z`)),
);

assert.deepEqual(windows, [
  "today",
  "historical",
  "yesterday",
  "historical",
  "historical",
  "historical",
]);
assert.equal(windows.filter((window) => window === "historical").length, 4);

console.log("analytics v2 schedule: four historical and two freshness slots passed");
