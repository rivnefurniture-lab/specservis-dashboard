import type { CompetitorRadar, InternalSnapshot, LivePulse, MarketCoverageSnapshotView, OwnerControl, SharePointSync } from "@/lib/types";

export type DashboardViewer = {
  id: string;
  username: string;
  label: string;
  role: "owner" | "manager" | "employee";
  direction: "Капбудівництво" | "Сервіс" | "Кондиціонування" | null;
  financeAccess: boolean;
  tenderWorkspaceAccess: "manager" | "employee" | null;
  availableDirections: Array<"Капбудівництво" | "Сервіс" | "Кондиціонування">;
};

export type DashboardPayload = {
  viewer: DashboardViewer;
  snapshot: InternalSnapshot;
  sharePointSync: SharePointSync;
  coverage: MarketCoverageSnapshotView;
  live: LivePulse;
  control: OwnerControl;
  competitorRadar: CompetitorRadar;
};

export const money = (value: number, maximumFractionDigits = 1) =>
  new Intl.NumberFormat("uk-UA", {
    style: "currency",
    currency: "UAH",
    notation: value >= 1_000_000 ? "compact" : "standard",
    maximumFractionDigits,
  }).format(value);

export const integer = (value: number) => new Intl.NumberFormat("uk-UA").format(value);

export const date = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("uk-UA", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value))
    : "Не вказано";

export const dateTime = (value: string) =>
  new Intl.DateTimeFormat("uk-UA", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
