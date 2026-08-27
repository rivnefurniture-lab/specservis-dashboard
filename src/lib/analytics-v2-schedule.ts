export type AnalyticsDiscoveryWindow = "today" | "yesterday" | "historical";
export type AnalyticsControlWindow = "recent-30-days" | "contracts" | "full-history";

export const ANALYTICS_CRON_INTERVAL_MINUTES = 5;

const discoveryWindows: readonly AnalyticsDiscoveryWindow[] = [
  "today",
  "historical",
  "yesterday",
  "historical",
  "historical",
  "historical",
];

/**
 * Keep current data fresh while assigning four of six five-minute slots to the
 * initial historical backfill. The mapping is deterministic across instances,
 * so distributed leases still prevent duplicate work when invocations overlap.
 */
export function analyticsDiscoveryWindow(date: Date): AnalyticsDiscoveryWindow {
  const slot = Math.floor(date.getUTCMinutes() / ANALYTICS_CRON_INTERVAL_MINUTES);
  return discoveryWindows[slot % discoveryWindows.length];
}

const controlWindows: readonly AnalyticsControlWindow[] = [
  "recent-30-days",
  "contracts",
  "full-history",
  "recent-30-days",
  "contracts",
  "full-history",
];

/**
 * Every cron invocation advances exactly one durable control stream. Daily
 * streams re-fetch the recent window and every known contract; the monthly
 * stream walks the complete stored history. Stream cursors make repeated
 * invocations cheap after a pass has completed.
 */
export function analyticsControlWindow(date: Date): AnalyticsControlWindow {
  const slot = Math.floor(date.getUTCMinutes() / ANALYTICS_CRON_INTERVAL_MINUTES);
  return controlWindows[slot % controlWindows.length];
}
