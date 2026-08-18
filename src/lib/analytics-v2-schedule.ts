export type AnalyticsDiscoveryWindow = "today" | "yesterday" | "historical";

export const ANALYTICS_CRON_INTERVAL_MINUTES = 10;

const discoveryWindows: readonly AnalyticsDiscoveryWindow[] = [
  "today",
  "historical",
  "yesterday",
  "historical",
  "historical",
  "historical",
];

/**
 * Keep current data fresh while assigning four of six ten-minute slots to the
 * initial historical backfill. The mapping is deterministic across instances,
 * so distributed leases still prevent duplicate work when invocations overlap.
 */
export function analyticsDiscoveryWindow(date: Date): AnalyticsDiscoveryWindow {
  const slot = Math.floor(date.getUTCMinutes() / ANALYTICS_CRON_INTERVAL_MINUTES);
  return discoveryWindows[slot % discoveryWindows.length];
}
