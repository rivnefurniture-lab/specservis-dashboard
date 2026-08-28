export type AnalyticsDiscoveryWindow = "today" | "yesterday" | "historical";
export type AnalyticsControlWindow = "recent-30-days" | "contracts" | "full-history";

export const ANALYTICS_CRON_INTERVAL_MINUTES = 5;
export const DEFAULT_ANALYTICS_HISTORY_FROM = "2023-01-01";

function validIsoDay(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Resolve a stable inclusive boundary for the historical analytics crawl. */
export function analyticsHistoryStart(configured: string | null | undefined, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const candidate = configured?.trim() ?? "";
  if (validIsoDay(candidate) && candidate <= today) return candidate;
  return DEFAULT_ANALYTICS_HISTORY_FROM <= today ? DEFAULT_ANALYTICS_HISTORY_FROM : today;
}

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
