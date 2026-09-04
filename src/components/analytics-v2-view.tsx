"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Bookmark,
  Download,
  CalendarDays,
  ChevronRight,
  CircleHelp,
  Database,
  Filter,
  LoaderCircle,
  RefreshCw,
  Save,
  Search,
  SlidersHorizontal,
  TableProperties,
  X,
} from "lucide-react";
import styles from "./analytics-v2-view.module.css";
import { directionGroupIdFor, TENDER_DIRECTION_GROUPS } from "@/lib/tender-scope";
import type {
  AnalyticsV2Filters as EngineFilters,
  AnalyticsV2Result,
  CurrencyAggregate,
} from "@/lib/analytics-v2-engine";

export type AnalyticsConfidence = "high" | "medium" | "low" | null;

export type AnalyticsFacetOption = {
  value: string;
  label: string;
  count?: number;
};

export type AnalyticsSource = {
  id: string;
  label: string;
  state: "live" | "snapshot" | "partial" | "unavailable";
  updatedAt: string | null;
  note: string | null;
};

export type AnalyticsKpi = {
  id: string;
  label: string;
  value: number | null;
  format: "integer" | "money" | "percent" | "decimal";
  currency?: string;
  note: string | null;
  source: string | null;
  confidence: AnalyticsConfidence;
};

export type AnalyticsParticipantRow = {
  id: string;
  tenderId: string | null;
  prozorroUrl: string | null;
  title: string | null;
  lotId: string | null;
  bidId: string | null;
  awardId: string | null;
  contractIds: string[];
  date: string | null;
  buyerId: string | null;
  buyer: string | null;
  supplierId: string | null;
  supplier: string | null;
  participants: number | null;
  offerValue: number | null;
  offerCurrency: string | null;
  lowestRejected: boolean | null;
  rejectionReason: string | null;
  participantDetails: string | null;
  winner: boolean | null;
  awardValue: number | null;
  awardCurrency: string | null;
  originalContractValue: number | null;
  originalContractCurrency: string | null;
  contractValue: number | null;
  contractCurrency: string | null;
  paidAmount: number | null;
  paidCurrency: string | null;
  hasContractChanges: boolean | null;
  contractDetails: string | null;
  status: string | null;
  source: string | null;
  confidence: AnalyticsConfidence;
};

export type AnalyticsMatrixCell = {
  id: string;
  supplierId: string;
  supplier: string;
  buyerId: string;
  buyer: string;
  procurements: number | null;
  lots: number | null;
  participations: number | null;
  wins: number | null;
  contractValue: number | null;
  contractCurrency: string | null;
  source: string | null;
  confidence: AnalyticsConfidence;
  tenders?: AnalyticsParticipantRow[];
};

type FacetKey =
  | "department"
  | "cpv"
  | "subject"
  | "category"
  | "procedure"
  | "status"
  | "region"
  | "buyer"
  | "address"
  | "supplier"
  | "lowestSupplier"
  | "currency"
  | "winner"
  | "ourStatus";

type AnalyticsV2ViewData = {
  generatedAt: string | null;
  period: {
    from: string | null;
    to: string | null;
    dateLens: string;
    scope: string;
  };
  sources: AnalyticsSource[];
  warnings?: string[];
  facets: Partial<Record<FacetKey, AnalyticsFacetOption[]>>;
  kpis: AnalyticsKpi[];
  leaders: Array<{ id: string; criterion: string; buyer: string; value: string }>;
  participants: {
    total: number;
    items: AnalyticsParticipantRow[];
  };
  matrix: {
    cells: AnalyticsMatrixCell[];
  };
  yearly: Array<{
    year: string;
    tenders: number;
    lots: number;
    participations: number;
    wins: number;
    contracts: number;
    winRate: number | null;
    contractValueUah: number;
  }>;
};

export type AnalyticsV2Response = {
  meta: {
    schemaVersion?: string | number;
    generatedAt?: string | null;
    from?: string | null;
    to?: string | null;
    source?: string | null;
    storage?: string;
    complete?: boolean;
    syncStatus?: string;
    sync?: { backfillComplete?: boolean; cursor?: string | null; queued?: number; lastSuccessAt?: string | null; degraded?: boolean };
    limitations?: string[];
    sourceStates?: Record<string, string>;
  };
  filters: EngineFilters;
  facets: {
    directions?: string[];
    procedures?: string[];
    buyers?: Array<{ id: string; name: string }>;
    categories?: string[];
    currencies?: string[];
    statuses?: string[];
    regions?: string[];
    ourStatuses?: string[];
    suppliers?: Array<{ id: string; name: string }>;
  };
  result: AnalyticsV2Result;
  yearly?: AnalyticsV2ViewData["yearly"];
  truncated?: {
    suppliers?: boolean;
    matrix?: boolean;
    drilldown?: boolean;
    totals?: { suppliers?: number; matrix?: number; drilldown?: number };
  };
};

type FilterState = {
  dateLens: "publication" | "award" | "contract";
  period: "all" | "30d" | "90d" | "year" | "custom";
  audience: "all" | "ours" | "competitors";
  from: string;
  to: string;
  scope: "monitoring" | "expanded";
  department: string;
  cpv: string;
  subject: string;
  category: string;
  procedure: string;
  status: string;
  region: string;
  buyer: string;
  address: string;
  minValue: string;
  maxValue: string;
  currency: string;
  minParticipants: string;
  maxParticipants: string;
  supplier: string;
  lowestSupplier: string;
  minLowestBid: string;
  maxLowestBid: string;
  lowestRejection: "" | "yes" | "no";
  rejectionReason: string;
  winner: string;
  minAward: string;
  maxAward: string;
  contract: "" | "yes" | "no";
  minOriginalContract: string;
  maxOriginalContract: string;
  minCurrentContract: string;
  maxCurrentContract: string;
  minCompletedAmount: string;
  maxCompletedAmount: string;
  paid: "" | "yes" | "no";
  changes: "" | "yes" | "no";
  ourStatus: string;
};

type SavedPreset = { id: string; name: string; filters: FilterState };

const defaultFilters: FilterState = {
  dateLens: "publication",
  period: "all",
  audience: "all",
  from: "",
  to: "",
  scope: "monitoring",
  department: "",
  cpv: "",
  subject: "",
  category: "",
  procedure: "",
  status: "",
  region: "",
  buyer: "",
  address: "",
  minValue: "",
  maxValue: "",
  currency: "",
  minParticipants: "",
  maxParticipants: "",
  supplier: "",
  lowestSupplier: "",
  minLowestBid: "",
  maxLowestBid: "",
  lowestRejection: "",
  rejectionReason: "",
  winner: "",
  minAward: "",
  maxAward: "",
  contract: "",
  minOriginalContract: "",
  maxOriginalContract: "",
  minCurrentContract: "",
  maxCurrentContract: "",
  minCompletedAmount: "",
  maxCompletedAmount: "",
  paid: "",
  changes: "",
  ourStatus: "",
};

const STORAGE_KEY = "specservis.analytics-v2.presets";
const PRESETS_ENDPOINT = "/api/analytics-v2/presets";
const ANALYTICS_CACHE_PREFIX = "specservis.analytics-v2:";
const ANALYTICS_CACHE_TTL_MS = 5 * 60_000;

function readAnalyticsCache(key: string) {
  try {
    const raw = window.sessionStorage.getItem(`${ANALYTICS_CACHE_PREFIX}${key}`);
    if (!raw) return null;
    const cached = JSON.parse(raw) as { savedAt: number; payload: AnalyticsV2Response };
    if (!cached.savedAt || Date.now() - cached.savedAt > ANALYTICS_CACHE_TTL_MS) {
      window.sessionStorage.removeItem(`${ANALYTICS_CACHE_PREFIX}${key}`);
      return null;
    }
    return cached.payload;
  } catch {
    return null;
  }
}

function writeAnalyticsCache(key: string, payload: AnalyticsV2Response) {
  try {
    window.sessionStorage.setItem(
      `${ANALYTICS_CACHE_PREFIX}${key}`,
      JSON.stringify({ savedAt: Date.now(), payload }),
    );
  } catch {
    // Live loading remains available when browser storage is unavailable.
  }
}
const dateLenses: Array<{ id: FilterState["dateLens"]; label: string; hint: string }> = [
  { id: "publication", label: "Оголошено", hint: "Дата публікації закупівлі" },
  { id: "award", label: "Рішення", hint: "Дата рішення про переможця" },
  { id: "contract", label: "Договір", hint: "Дата підписання договору" },
];

const confidenceLabel: Record<Exclude<AnalyticsConfidence, null>, string> = {
  high: "Висока довіра",
  medium: "Середня довіра",
  low: "Низька довіра",
};

const integerFormatter = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 });
const decimalFormatter = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 2 });
const moneyFormatter = new Intl.NumberFormat("uk-UA", { notation: "compact", maximumFractionDigits: 1 });

function formatNumber(value: number | null, format: AnalyticsKpi["format"] = "integer", currency?: string | null) {
  if (value === null || !Number.isFinite(value)) return "—";
  if (format === "money") return `${moneyFormatter.format(value)} ${currency || "валюта невідома"}`;
  if (format === "percent") return `${decimalFormatter.format(value)}%`;
  if (format === "decimal") return decimalFormatter.format(value);
  return integerFormatter.format(value);
}

function formatDate(value: string | null) {
  if (!value) return "дата відсутня";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Intl.DateTimeFormat("uk-UA", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Kyiv",
  }).format(timestamp);
}

function queryOf(filters: FilterState) {
  const params = new URLSearchParams();
  const today = new Date();
  const isoDay = (date: Date) => date.toISOString().slice(0, 10);
  let from = filters.from;
  let to = filters.to;
  if (filters.period !== "custom") {
    to = isoDay(today);
    const start = new Date(today);
    if (filters.period === "all") {
      from = "2023-01-01";
      start.setUTCFullYear(2023, 0, 1);
    } else if (filters.period === "year") start.setUTCMonth(0, 1);
    else start.setUTCDate(start.getUTCDate() - (filters.period === "30d" ? 29 : 89));
    if (filters.period !== "all") from = isoDay(start);
  }
  params.set("dateLens", filters.dateLens);
  params.set("audience", filters.audience);
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  if (filters.department) params.set("direction", filters.department);
  if (filters.cpv) params.set("cpv", filters.cpv);
  if (filters.buyer) params.set("buyer", filters.buyer);
  if (filters.supplier) params.set("supplier", filters.supplier);
  if (filters.procedure) params.set("procedure", filters.procedure);
  if (filters.currency) params.set("currency", filters.currency);
  for (const key of [
    "scope", "subject", "category", "status", "region", "address", "minValue", "maxValue",
    "minParticipants", "maxParticipants", "lowestSupplier", "minLowestBid", "maxLowestBid",
    "lowestRejection", "rejectionReason", "winner", "minAward", "maxAward", "contract",
    "minOriginalContract", "maxOriginalContract", "minCurrentContract", "maxCurrentContract",
    "minCompletedAmount", "maxCompletedAmount", "paid", "changes", "ourStatus",
  ] as const) {
    if (filters[key]) params.set(key, filters[key]);
  }
  return params;
}

function singleAggregate(values: CurrencyAggregate[]) {
  return values.length === 1 ? values[0] : null;
}

function normalizeResponse(payload: AnalyticsV2Response): AnalyticsV2ViewData {
  const { result, meta } = payload;
  const provenance = meta.source || meta.storage || null;
  const confidence: AnalyticsConfidence = meta.complete ? "high" : "medium";
  const queued = meta.sync?.queued ?? 0;
  const lastSyncAt = meta.sync?.lastSuccessAt ? Date.parse(meta.sync.lastSuccessAt) : NaN;
  const queueIsStalled = queued > 0 && (
    meta.sync?.degraded === true
    || !Number.isFinite(lastSyncAt)
    || Date.now() - lastSyncAt > 12 * 60 * 60 * 1000
  );
  const queueWarning = queued > 0
    ? `${queueIsStalled ? "Оновлення історії зупинилося" : "Історичні дані ще неповні"}: не оброблено ${integerFormatter.format(queued)} закупівель.`
    : null;
  const kpis: AnalyticsKpi[] = [
    { id: "tenders", label: "Закупівель", value: result.summary.tenders, format: "integer", note: "У часовій лінзі", source: provenance, confidence },
    { id: "participations", label: "Участей", value: result.summary.participations, format: "integer", note: "Остання ставка постачальника на лот", source: provenance, confidence },
    { id: "disqualified", label: "Дискваліфікованих участей", value: result.summary.disqualifiedParticipations, format: "integer", note: "Входять до участей, результат показано окремо", source: provenance, confidence },
    { id: "wins", label: "Перемог", value: result.summary.wins, format: "integer", note: "Активні рішення про переможця", source: provenance, confidence },
    { id: "contracts", label: "Підписаних договорів", value: result.summary.signedContracts, format: "integer", note: "Активні та завершені", source: provenance, confidence },
    { id: "completed-contracts", label: "Завершених договорів", value: result.summary.completedContracts, format: "integer", note: "Завершення підтверджене джерелом", source: provenance, confidence },
    { id: "terminated-contracts", label: "Розірваних договорів", value: result.summary.earlyTerminatedContracts, format: "integer", note: "Показані окремо, але входять до укладених", source: provenance, confidence },
    { id: "win-rate", label: "Конверсія в перемогу", value: result.summary.winRate === null ? null : result.summary.winRate * 100, format: "percent", note: "Перемоги ÷ участі", source: "Розраховано", confidence },
    { id: "contract-conversion", label: "Перемога → договір", value: result.summary.contractConversion === null ? null : result.summary.contractConversion * 100, format: "percent", note: "Конкурентні договори ÷ перемоги", source: "Розраховано", confidence },
    { id: "other-bidders", label: "Інших учасників", value: result.summary.avgOtherBidders, format: "decimal", note: "Середнє на одну участь", source: "Розраховано", confidence },
  ];
  const appendMoneyKpis = (prefix: string, label: string, amounts: CurrencyAggregate[]) => amounts.forEach((amount) => kpis.push({
    id: `${prefix}-${amount.currency}`,
    label: `${label} · ${amount.currency}`,
    value: amount.value,
    format: "money",
    currency: amount.currency,
    note: `${amount.known} із ${amount.total} значень відомі`,
    source: provenance,
    confidence: amount.known === amount.total ? confidence : "low",
  }));
  appendMoneyKpis("bids", "Сума участей", result.summary.bidAmount);
  appendMoneyKpis("awards", "Сума перемог", result.summary.awardAmount);
  appendMoneyKpis("original-contracts", "Первинна сума договорів", result.summary.originalAmount);
  result.summary.currentAmount.forEach((amount) => kpis.push({
    id: `contracts-${amount.currency}`,
    label: `Поточна сума договорів · ${amount.currency}`,
    value: amount.value,
    format: "money",
    currency: amount.currency,
    note: `${amount.known} із ${amount.total} значень відомі`,
    source: provenance,
    confidence: amount.known === amount.total ? confidence : "low",
  }));
  appendMoneyKpis("completed-contracts", "Сума завершених договорів", result.summary.completedAmount);
  appendMoneyKpis("early-terminated-contracts", "Сума розірваних договорів", result.summary.earlyTerminatedAmount);
  result.summary.paidAmount.forEach((amount) => kpis.push({
    id: `paid-${amount.currency}`,
    label: `Фактично сплачено · ${amount.currency}`,
    value: amount.value,
    format: "money",
    currency: amount.currency,
    note: `${amount.known} із ${amount.total} значень відомі`,
    source: provenance,
    confidence: amount.known === amount.total ? confidence : "low",
  }));

  const participants: AnalyticsParticipantRow[] = result.drilldown.map((row) => {
    const contract = singleAggregate(row.currentAmount);
    const originalContract = singleAggregate(row.originalAmount);
    const paid = singleAggregate(row.paidAmount);
    const hasContractChanges = row.contracts.length
      ? row.contracts.some((contract) => contract.hasChanges === true)
      : null;
    return {
      id: row.key,
      tenderId: row.externalTenderId || row.tenderId,
      prozorroUrl: row.prozorroUrl,
      title: row.lotTitle || row.tenderTitle,
      lotId: row.lotId,
      bidId: row.bidId,
      awardId: row.awardId,
      contractIds: row.contractIds,
      date: payload.filters.dateLens === "award" ? row.awardDate
        : payload.filters.dateLens === "contract" ? row.contractDate : row.publishedAt,
      buyerId: row.buyerId || null,
      buyer: row.buyerName || null,
      supplierId: row.supplierId || null,
      supplier: row.supplierName || null,
      participants: row.participantCount,
      offerValue: row.bid?.amount ?? null,
      offerCurrency: row.bid?.currency ?? null,
      lowestRejected: row.lowestRejected,
      rejectionReason: row.rejectionReason,
      participantDetails: row.lotParticipants.length
        ? row.lotParticipants.map((item) => `${item.supplierName}: ${formatNumber(item.bid.amount, "money", item.bid.currency)}${item.won ? " · переможець" : ""}`).join("; ")
        : null,
      winner: row.won,
      awardValue: row.award?.amount ?? null,
      awardCurrency: row.award?.currency ?? null,
      originalContractValue: originalContract?.value ?? null,
      originalContractCurrency: originalContract?.currency ?? null,
      contractValue: contract?.value ?? null,
      contractCurrency: contract?.currency ?? null,
      paidAmount: paid?.value ?? null,
      paidCurrency: paid?.currency ?? null,
      hasContractChanges,
      contractDetails: row.contracts.length
        ? row.contracts.map((item) => [
          item.number ? `№${item.number}` : item.id,
          item.status,
          item.signedAt ? `підписано ${item.signedAt.slice(0, 10)}` : null,
          item.hasChanges === true ? "є зміни" : item.hasChanges === false ? "без змін" : null,
        ].filter(Boolean).join(" · ")).join("; ")
        : null,
      status: row.direct ? "Прямий договір" : row.contractStatuses.join(", ") || null,
      source: provenance,
      confidence,
    };
  });

  const matrix: AnalyticsMatrixCell[] = result.matrix.map((row) => {
    const contract = singleAggregate(row.currentAmount);
    const tenders = participants.filter((item) => item.supplierId === row.supplierId && item.buyerId === row.buyerId);
    return {
      id: `${row.supplierId}\u0000${row.buyerId}`,
      supplierId: row.supplierId,
      supplier: row.supplierName,
      buyerId: row.buyerId,
      buyer: row.buyerName,
      procurements: row.tenders,
      lots: row.lots,
      participations: row.participations,
      wins: row.wins,
      contractValue: contract?.value ?? null,
      contractCurrency: contract?.currency ?? null,
      source: provenance,
      confidence,
      tenders,
    };
  });

  const options = (values: string[] | undefined) => values?.map((value) => ({ value, label: value })) ?? [];
  return {
    generatedAt: meta.generatedAt ?? null,
    period: {
      from: payload.filters.from ?? meta.from ?? null,
      to: payload.filters.to ?? meta.to ?? null,
      dateLens: payload.filters.dateLens ?? "publication",
      scope: payload.filters.scope ?? "monitoring",
    },
    sources: [{
      id: "analytics-source",
      label: meta.source?.toLowerCase().includes("prozorro") ? "Джерело: Prozorro" : meta.source || "Джерело не вказано",
      state: meta.storage === "bundled-fallback" ? "snapshot" : meta.complete ? "live" : "partial",
      updatedAt: meta.generatedAt ?? null,
      note: meta.complete === false ? "Неповне джерело: відсутні частина подій або полів." : null,
    }],
    warnings: [...new Set([
      ...(queueWarning ? [queueWarning] : []),
      ...(meta.limitations ?? []).filter((value) => !/backfill|durable queue|завантажується історія|серверними лімітами|агрегати KPI|відповідь обрізана/i.test(value)),
    ])],
    facets: {
      department: TENDER_DIRECTION_GROUPS.map((group) => ({ value: group.id, label: group.label })),
      procedure: options(payload.facets.procedures),
      category: options(payload.facets.categories),
      status: options(payload.facets.statuses),
      region: options(payload.facets.regions),
      buyer: payload.facets.buyers?.map((buyer) => ({ value: buyer.id, label: buyer.name })) ?? [],
      supplier: (payload.facets.suppliers ?? result.suppliers).map((supplier) => ({ value: supplier.id, label: supplier.name })),
      lowestSupplier: (payload.facets.suppliers ?? result.suppliers).map((supplier) => ({ value: supplier.id, label: supplier.name })),
      winner: (payload.facets.suppliers ?? result.suppliers).map((supplier) => ({ value: supplier.id, label: supplier.name })),
      ourStatus: options(payload.facets.ourStatuses),
      currency: options(payload.facets.currencies),
    },
    kpis,
    leaders: [
      ...(result.mainBuyersByCount[0] ? [{
        id: "main-buyer-count",
        criterion: "Найбільше укладених договорів",
        buyer: result.mainBuyersByCount[0].name,
        value: integerFormatter.format(result.mainBuyersByCount[0].signedContracts),
      }] : []),
      ...result.mainBuyersBySum.flatMap((group) => group.buyers[0] ? [{
        id: `main-buyer-sum-${group.currency}`,
        criterion: `Найбільша сума договорів · ${group.currency}`,
        buyer: group.buyers[0].name,
        value: formatNumber(group.buyers[0].currentAmount.find((item) => item.currency === group.currency)?.value ?? null, "money", group.currency),
      }] : []),
    ],
    participants: { total: payload.truncated?.totals?.drilldown ?? participants.length, items: participants },
    matrix: { cells: matrix },
    yearly: payload.yearly ?? [],
  };
}

function readPresets(): SavedPreset[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]") as SavedPreset[];
    return Array.isArray(parsed) ? parsed.filter((item) => item?.id && item?.name && item?.filters) : [];
  } catch {
    return [];
  }
}

function normalizedPresetFilters(value: unknown): FilterState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return defaultFilters;
  const record = value as Record<string, unknown>;
  const next = { ...defaultFilters };
  for (const key of Object.keys(next) as Array<keyof FilterState>) {
    if (typeof record[key] === "string") Object.assign(next, { [key]: record[key] });
  }
  if (!dateLenses.some((lens) => lens.id === next.dateLens)) next.dateLens = defaultFilters.dateLens;
  if (!(["all", "30d", "90d", "year", "custom"] as string[]).includes(next.period)) next.period = defaultFilters.period;
  if (!(["all", "ours", "competitors"] as string[]).includes(next.audience)) next.audience = defaultFilters.audience;
  if (!(["monitoring", "expanded"] as string[]).includes(next.scope)) next.scope = defaultFilters.scope;
  return next;
}

function ConfidenceBadge({ value }: { value: AnalyticsConfidence }) {
  if (!value) return <span className={`${styles.confidence} ${styles.unknown}`}>Довіру не оцінено</span>;
  return <span className={`${styles.confidence} ${styles[value]}`}>{confidenceLabel[value]}</span>;
}

function SourceLine({ source, confidence }: { source: string | null; confidence: AnalyticsConfidence }) {
  return (
    <span className={styles.sourceLine}>
      <Database size={11} aria-hidden="true" />
      <span>{source || "Джерело не вказано"}</span>
      <ConfidenceBadge value={confidence} />
    </span>
  );
}

function FacetInput({
  id,
  label,
  value,
  options,
  placeholder,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options?: AnalyticsFacetOption[];
  placeholder: string;
  onChange: (value: string) => void;
}) {
  const listId = `${id}-options`;
  return (
    <label className={styles.field}>
      <span>{label}</span>
      <input id={id} list={options?.length ? listId : undefined} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
      {options?.length ? (
        <datalist id={listId}>
          {options.map((option) => <option key={option.value} value={option.value}>{option.label}{option.count === undefined ? "" : ` · ${option.count}`}</option>)}
        </datalist>
      ) : null}
    </label>
  );
}

function TriState({ id, label, value, onChange }: {
  id: string;
  label: string;
  value: "" | "yes" | "no";
  onChange: (value: "" | "yes" | "no") => void;
}) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value as "" | "yes" | "no")}>
        <option value="">Будь-яке значення</option>
        <option value="yes">Так</option>
        <option value="no">Ні</option>
      </select>
    </label>
  );
}

function NumberFilter({ id, label, value, placeholder, onChange }: {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className={styles.field} htmlFor={id}>
      <span>{label}</span>
      <input id={id} inputMode="decimal" type="number" min="0" step="any" value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

export function AnalyticsV2View({
  initialData,
  endpoint = "/api/analytics-v2",
  initialDirection = null,
}: {
  initialData?: AnalyticsV2Response | null;
  endpoint?: string;
  initialDirection?: string | null;
}) {
  const [baseFilters] = useState<FilterState>(() => ({
    ...defaultFilters,
    department: directionGroupIdFor(initialDirection) ?? "",
  }));
  const [data, setData] = useState<AnalyticsV2ViewData | null>(() => initialData ? normalizeResponse(initialData) : null);
  const [draft, setDraft] = useState<FilterState>(baseFilters);
  const [applied, setApplied] = useState<FilterState>(baseFilters);
  const [loading, setLoading] = useState(!initialData);
  const [error, setError] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [presets, setPresets] = useState<SavedPreset[]>([]);
  const [selectedCell, setSelectedCell] = useState<AnalyticsMatrixCell | null>(null);

  const load = useCallback(async (filters: FilterState, signal?: AbortSignal) => {
    const requestKey = queryOf(filters).toString();
    const cached = readAnalyticsCache(requestKey);
    if (cached) {
      setData(normalizeResponse(cached));
      setLoading(false);
    } else {
      setLoading(true);
    }
    try {
      const response = await fetch(`${endpoint}?${requestKey}`, { cache: "no-store", signal });
      const payload = await response.json() as AnalyticsV2Response & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Не вдалося завантажити аналітику");
      writeAnalyticsCache(requestKey, payload);
      setData(normalizeResponse(payload));
      setError("");
      setSelectedCell(null);
    } catch (cause) {
      if ((cause as Error).name !== "AbortError") setError(cause instanceof Error ? cause.message : "Невідома помилка");
    } finally {
      setLoading(false);
    }
  }, [endpoint]);

  useEffect(() => {
    const loadPresets = async () => {
      try {
        const response = await fetch(PRESETS_ENDPOINT, { cache: "no-store" });
        if (!response.ok) throw new Error("Preset request failed");
        const payload = await response.json() as { storage?: "database" | "browser"; items?: Array<{ id: string; name: string; filters: unknown }> };
        if (payload.storage === "database") {
          setPresets((payload.items ?? []).map((item) => ({ id: item.id, name: item.name, filters: normalizedPresetFilters(item.filters) })));
          return;
        }
      } catch {
        // Локальне сховище є заявленим fallback, якщо БД пресетів недоступна.
      }
      setPresets(readPresets());
    };
    void loadPresets();
    if (initialData) return;
    const controller = new AbortController();
    const requestKey = queryOf(baseFilters).toString();
    const cached = readAnalyticsCache(requestKey);
    const timer = window.setTimeout(() => {
      if (cached) {
        setData(normalizeResponse(cached));
        setLoading(false);
      }
      void fetch(`${endpoint}?${requestKey}`, { cache: "no-store", signal: controller.signal })
        .then(async (response) => {
          const payload = await response.json() as AnalyticsV2Response & { error?: string };
          if (!response.ok) throw new Error(payload.error || "Не вдалося завантажити аналітику");
          writeAnalyticsCache(requestKey, payload);
          setData(normalizeResponse(payload));
          setError("");
        })
        .catch((cause: unknown) => {
          if ((cause as Error).name !== "AbortError") setError(cause instanceof Error ? cause.message : "Невідома помилка");
        })
        .finally(() => setLoading(false));
    }, 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [baseFilters, endpoint, initialData]);

  const update = <K extends keyof FilterState>(key: K, value: FilterState[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const applyFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setApplied(draft);
    void load(draft);
  };

  const resetFilters = () => {
    setDraft(baseFilters);
    setApplied(baseFilters);
    void load(baseFilters);
  };

  const savePreset = async () => {
    const name = presetName.trim();
    if (!name) return;
    let saved: SavedPreset | null = null;
    let browserFallback = false;
    try {
      const response = await fetch(PRESETS_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, filters: draft }),
      });
      if (response.ok) {
        const payload = await response.json() as { item?: { id: string; name: string; filters: unknown } };
        if (payload.item) saved = { id: payload.item.id, name: payload.item.name, filters: normalizedPresetFilters(payload.item.filters) };
      } else if (response.status === 503) {
        browserFallback = true;
      } else {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error || "Не вдалося зберегти пресет");
      }
    } catch (cause) {
      if (cause instanceof TypeError) browserFallback = true;
      else {
        setError(cause instanceof Error ? cause.message : "Не вдалося зберегти пресет");
        return;
      }
    }
    if (!saved && !browserFallback) return;
    saved ??= { id: `local:${globalThis.crypto.randomUUID()}`, name, filters: draft };
    const next = [...presets.filter((item) => item.name.toLocaleLowerCase("uk-UA") !== name.toLocaleLowerCase("uk-UA")), saved];
    setPresets(next);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next.filter((item) => item.id.startsWith("local:"))));
    setPresetName("");
  };

  const applyPreset = (id: string) => {
    const preset = presets.find((item) => item.id === id);
    if (!preset) return;
    setDraft(preset.filters);
    setApplied(preset.filters);
    void load(preset.filters);
  };

  const removePreset = async (id: string) => {
    if (!id.startsWith("local:")) {
      const response = await fetch(`${PRESETS_ENDPOINT}?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok && response.status !== 404) {
        setError("Не вдалося видалити серверний пресет");
        return;
      }
    }
    const next = presets.filter((item) => item.id !== id);
    setPresets(next);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next.filter((item) => item.id.startsWith("local:"))));
  };

  const activeFilterCount = Object.entries(applied).filter(([key, value]) => value && baseFilters[key as keyof FilterState] !== value).length;
  const suppliers = useMemo(() => [...new Map(data?.matrix.cells.map((cell) => [cell.supplierId, { id: cell.supplierId, name: cell.supplier }]) ?? []).values()].slice(0, 20), [data]);
  const buyers = useMemo(() => [...new Map(data?.matrix.cells.map((cell) => [cell.buyerId, { id: cell.buyerId, name: cell.buyer }]) ?? []).values()].slice(0, 12), [data]);
  const matrixMap = useMemo(() => new Map(data?.matrix.cells.map((cell) => [cell.id, cell]) ?? []), [data]);
  const hasRows = Boolean(data?.participants.items.length || data?.matrix.cells.length);
  const displayKpis = useMemo(() => {
    const preferred = ["tenders", "participations", "wins", "contracts-UAH"];
    const selected = preferred.flatMap((id) => data?.kpis.find((kpi) => kpi.id === id) ?? []);
    return selected.length ? selected : (data?.kpis.slice(0, 4) ?? []);
  }, [data]);
  const maxAnnualValue = Math.max(1, ...(data?.yearly.map((row) => row.contractValueUah) ?? [1]));
  const exportHref = `${endpoint}?${queryOf(applied).toString()}&format=xlsx`;

  return (
    <div className={styles.analytics} aria-busy={loading}>
      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <span className={styles.eyebrow}>АНАЛІТИКА РИНКУ</span>
          <h1>Ринок за роками</h1>
          <p>Закупівлі, участі, перемоги та договори за вибраний період.</p>
          <div className={styles.heroMeta}>
            <span><CalendarDays size={13} />{data?.period.from || data?.period.to ? `${data.period.from || "…"} — ${data.period.to || "…"}` : "Період визначає запит"}</span>
            <span><Database size={13} />Оновлено: {formatDate(data?.generatedAt ?? null)}</span>
            <span><Filter size={13} />{activeFilterCount ? `Активних фільтрів: ${activeFilterCount}` : "Без додаткових фільтрів"}</span>
          </div>
        </div>
        <div className={styles.heroSignal}>
          <span>ЗАРАЗ ПОКАЗАНО</span>
          <strong>{applied.audience === "ours" ? "Ми" : applied.audience === "competitors" ? "Конкуренти" : "Весь ринок"}</strong>
          <small>{applied.department ? TENDER_DIRECTION_GROUPS.find((group) => group.id === applied.department)?.label : "Обидва напрямки"}</small>
        </div>
      </section>

      <form className={styles.filterShell} onSubmit={applyFilters}>
        <div className={styles.filterTop}>
          <div className={`${styles.toggleField} ${styles.audienceField}`}>
            <span className={styles.controlLabel}>Кого показати</span>
            <fieldset className={styles.scopeToggle}>
              <legend>Кого показати</legend>
              <button type="button" className={draft.audience === "all" ? styles.active : ""} onClick={() => update("audience", "all")}>Весь ринок</button>
              <button type="button" className={draft.audience === "ours" ? styles.active : ""} onClick={() => update("audience", "ours")}>Ми</button>
              <button type="button" className={draft.audience === "competitors" ? styles.active : ""} onClick={() => update("audience", "competitors")}>Конкуренти</button>
            </fieldset>
          </div>
          <label className={`${styles.compactField} ${styles.directionField}`}>
            <span>Напрямок</span>
            <select value={draft.department} onChange={(event) => update("department", event.target.value)}>
              <option value="">Обидва напрямки</option>
              {TENDER_DIRECTION_GROUPS.map((group) => <option value={group.id} key={group.id}>{group.label}</option>)}
            </select>
          </label>
          <div className={`${styles.toggleField} ${styles.dateField}`}>
            <span className={styles.controlLabel}>Рахувати за датою</span>
            <fieldset className={styles.segmented}>
              <legend>Рахувати за датою</legend>
              {dateLenses.map((lens) => (
                <button key={lens.id} type="button" className={draft.dateLens === lens.id ? styles.active : ""} onClick={() => update("dateLens", lens.id)} title={lens.hint}>
                  {lens.label}
                </button>
              ))}
            </fieldset>
          </div>
          <label className={`${styles.compactField} ${styles.periodField}`}>
            <span>Період</span>
            <select value={draft.period} onChange={(event) => update("period", event.target.value as FilterState["period"])}>
              <option value="all">Усі роки</option>
              <option value="30d">30 днів</option>
              <option value="90d">90 днів</option>
              <option value="year">Поточний рік</option>
              <option value="custom">Власний період</option>
            </select>
          </label>
          <button type="button" className={styles.filterToggle} aria-expanded={filtersOpen} onClick={() => setFiltersOpen((value) => !value)}>
            <SlidersHorizontal size={16} /> Додаткові фільтри {activeFilterCount ? <b>{activeFilterCount}</b> : null}
          </button>
          <a className={styles.exportButton} href={exportHref}><Download size={16} />Excel</a>
          <button type="submit" className={styles.applyButton} disabled={loading}>{loading ? <LoaderCircle className={styles.spin} size={16} /> : <Search size={16} />}Застосувати</button>
        </div>

        {draft.period === "custom" ? (
          <div className={styles.customDates}>
            <label><span>Від</span><input type="date" value={draft.from} max={draft.to || undefined} onChange={(event) => update("from", event.target.value)} /></label>
            <label><span>До</span><input type="date" value={draft.to} min={draft.from || undefined} onChange={(event) => update("to", event.target.value)} /></label>
          </div>
        ) : null}

        {filtersOpen ? (
          <div className={styles.advancedFilters}>
            <label className={styles.field}><span>Охоплення</span><select value={draft.scope} onChange={(event) => update("scope", event.target.value as FilterState["scope"])}><option value="monitoring">Наші правила моніторингу</option><option value="expanded">Інші ДК і предметні терміни</option></select></label>
            <FacetInput id="analytics-cpv" label="CPV" value={draft.cpv} options={data?.facets.cpv} placeholder="Код або група CPV" onChange={(value) => update("cpv", value)} />
            <FacetInput id="analytics-subject" label="Предмет" value={draft.subject} options={data?.facets.subject} placeholder="Слова у предметі" onChange={(value) => update("subject", value)} />
            <FacetInput id="analytics-category" label="Категорія" value={draft.category} options={data?.facets.category} placeholder="Усі категорії" onChange={(value) => update("category", value)} />
            <FacetInput id="analytics-procedure" label="Процедура" value={draft.procedure} options={data?.facets.procedure} placeholder="Усі процедури" onChange={(value) => update("procedure", value)} />
            <FacetInput id="analytics-status" label="Статус" value={draft.status} options={data?.facets.status} placeholder="Усі статуси" onChange={(value) => update("status", value)} />
            <FacetInput id="analytics-region" label="Регіон" value={draft.region} options={data?.facets.region} placeholder="Усі регіони" onChange={(value) => update("region", value)} />
            <FacetInput id="analytics-buyer" label="Замовник" value={draft.buyer} options={data?.facets.buyer} placeholder="Назва або ЄДРПОУ" onChange={(value) => update("buyer", value)} />
            <FacetInput id="analytics-address" label="Адреса виконання" value={draft.address} options={data?.facets.address} placeholder="Місто, область, адреса" onChange={(value) => update("address", value)} />
            <NumberFilter id="analytics-min-value" label="Очікувана вартість від" value={draft.minValue} placeholder="Без мінімуму" onChange={(value) => update("minValue", value)} />
            <NumberFilter id="analytics-max-value" label="Очікувана вартість до" value={draft.maxValue} placeholder="Без максимуму" onChange={(value) => update("maxValue", value)} />
            <FacetInput id="analytics-currency" label="Валюта вартості" value={draft.currency} options={data?.facets.currency} placeholder="Усі валюти" onChange={(value) => update("currency", value)} />
            <NumberFilter id="analytics-min-participants" label="Учасників від" value={draft.minParticipants} placeholder="Без мінімуму" onChange={(value) => update("minParticipants", value)} />
            <NumberFilter id="analytics-max-participants" label="Учасників до" value={draft.maxParticipants} placeholder="Без максимуму" onChange={(value) => update("maxParticipants", value)} />
            <FacetInput id="analytics-supplier" label="Постачальник" value={draft.supplier} options={data?.facets.supplier} placeholder="Назва або ЄДРПОУ" onChange={(value) => update("supplier", value)} />
            <FacetInput id="analytics-lowest-supplier" label="Учасник із найнижчою ціною" value={draft.lowestSupplier} options={data?.facets.lowestSupplier} placeholder="Назва або ЄДРПОУ" onChange={(value) => update("lowestSupplier", value)} />
            <NumberFilter id="analytics-min-lowest-bid" label="Найнижча пропозиція від" value={draft.minLowestBid} placeholder="Без мінімуму" onChange={(value) => update("minLowestBid", value)} />
            <NumberFilter id="analytics-max-lowest-bid" label="Найнижча пропозиція до" value={draft.maxLowestBid} placeholder="Без максимуму" onChange={(value) => update("maxLowestBid", value)} />
            <TriState id="analytics-lowest-rejection" label="Відхилена найнижча" value={draft.lowestRejection} onChange={(value) => update("lowestRejection", value)} />
            <FacetInput id="analytics-rejection-reason" label="Причина відхилення" value={draft.rejectionReason} placeholder="Слова у причині" onChange={(value) => update("rejectionReason", value)} />
            <FacetInput id="analytics-winner" label="Переможець" value={draft.winner} options={data?.facets.winner} placeholder="Будь-який переможець" onChange={(value) => update("winner", value)} />
            <NumberFilter id="analytics-min-award" label="Сума рішення про перемогу від" value={draft.minAward} placeholder="Без мінімуму" onChange={(value) => update("minAward", value)} />
            <NumberFilter id="analytics-max-award" label="Сума рішення про перемогу до" value={draft.maxAward} placeholder="Без максимуму" onChange={(value) => update("maxAward", value)} />
            <TriState id="analytics-contract" label="Є договір" value={draft.contract} onChange={(value) => update("contract", value)} />
            <NumberFilter id="analytics-min-original-contract" label="Первинна сума договору від" value={draft.minOriginalContract} placeholder="Без мінімуму" onChange={(value) => update("minOriginalContract", value)} />
            <NumberFilter id="analytics-max-original-contract" label="Первинна сума договору до" value={draft.maxOriginalContract} placeholder="Без максимуму" onChange={(value) => update("maxOriginalContract", value)} />
            <NumberFilter id="analytics-min-current-contract" label="Поточна сума договору від" value={draft.minCurrentContract} placeholder="Без мінімуму" onChange={(value) => update("minCurrentContract", value)} />
            <NumberFilter id="analytics-max-current-contract" label="Поточна сума договору до" value={draft.maxCurrentContract} placeholder="Без максимуму" onChange={(value) => update("maxCurrentContract", value)} />
            <NumberFilter id="analytics-min-completed-amount" label="Після виконання сплачено від" value={draft.minCompletedAmount} placeholder="Без мінімуму" onChange={(value) => update("minCompletedAmount", value)} />
            <NumberFilter id="analytics-max-completed-amount" label="Після виконання сплачено до" value={draft.maxCompletedAmount} placeholder="Без максимуму" onChange={(value) => update("maxCompletedAmount", value)} />
            <TriState id="analytics-paid" label="Є оплата" value={draft.paid} onChange={(value) => update("paid", value)} />
            <TriState id="analytics-changes" label="Є зміни договору" value={draft.changes} onChange={(value) => update("changes", value)} />
            <FacetInput id="analytics-our-status" label="Наш статус" value={draft.ourStatus} options={data?.facets.ourStatus} placeholder="Будь-який статус" onChange={(value) => update("ourStatus", value)} />
            <button type="button" className={styles.resetButton} onClick={resetFilters}><RefreshCw size={14} />Скинути все</button>
          </div>
        ) : null}

        <div className={styles.presetBar}>
          <span><Bookmark size={14} />Збережені зрізи</span>
          <div className={styles.presetList}>
            {presets.map((preset) => (
              <span key={preset.id} className={styles.presetChip}>
                <button type="button" onClick={() => applyPreset(preset.id)}>{preset.name}</button>
                <button type="button" aria-label={`Видалити пресет ${preset.name}`} onClick={() => void removePreset(preset.id)}><X size={12} /></button>
              </span>
            ))}
            {!presets.length ? <small>Ще немає збережених пресетів</small> : null}
          </div>
          <label className={styles.presetName}><span className={styles.srOnly}>Назва нового пресету</span><input value={presetName} maxLength={48} placeholder="Назва пресету" onChange={(event) => setPresetName(event.target.value)} /></label>
          <button type="button" className={styles.savePreset} disabled={!presetName.trim()} onClick={() => void savePreset()}><Save size={14} />Зберегти</button>
        </div>
      </form>

      {error ? (
        <div className={styles.errorBanner} role="alert">
          <AlertTriangle size={17} /><span><b>Аналітика недоступна.</b>{error}</span>
          <button type="button" onClick={() => void load(applied)}>Спробувати ще</button>
        </div>
      ) : null}

      {data?.warnings?.map((warning) => <div className={styles.warning} key={warning}><CircleHelp size={16} /><span>{warning}</span></div>)}

      {loading && !data ? (
        <div className={styles.loadingState}><LoaderCircle className={styles.spin} size={28} /><b>Зводимо дані…</b><span>Збираємо закупівлі, участі, договори й оплати.</span></div>
      ) : data ? (
        <>
          <div className={styles.dataStatus}><Database size={15} /><span>{data.sources[0]?.label || "Prozorro"}</span><small>Оновлено {formatDate(data.generatedAt)}</small></div>

          <section className={styles.yearPanel} aria-label="Ринок за роками">
            <header><div><span>ПОРІВНЯННЯ РОКІВ</span><h2>Як змінювався ринок</h2></div><small>Сума договорів у гривні; точні значення видно в рядках</small></header>
            <div className={styles.yearRows}>
              {data.yearly.map((row) => (
                <article key={row.year}>
                  <strong>{row.year}</strong>
                  <div className={styles.yearBar} title={`${integerFormatter.format(row.contractValueUah)} грн`}><i style={{ width: `${Math.max(2, row.contractValueUah / maxAnnualValue * 100)}%` }} /></div>
                  <dl>
                    <div><dt>Лотів</dt><dd>{integerFormatter.format(row.lots)}</dd></div>
                    <div><dt>Участей</dt><dd>{integerFormatter.format(row.participations)}</dd></div>
                    <div><dt>Перемог</dt><dd>{integerFormatter.format(row.wins)}</dd></div>
                    <div><dt>Договорів</dt><dd>{integerFormatter.format(row.contracts)}</dd></div>
                    <div><dt>Сума договорів</dt><dd>{integerFormatter.format(row.contractValueUah)} грн</dd></div>
                  </dl>
                </article>
              ))}
              {!data.yearly.length ? <div className={styles.emptyInline}>За вибраним періодом немає річних даних.</div> : null}
            </div>
          </section>

          <section className={styles.kpiGrid} aria-label="Ключові показники">
            {displayKpis.map((kpi) => (
              <article key={kpi.id} className={styles.kpiCard}>
                <span>{kpi.label}</span>
                <strong className={kpi.value === null ? styles.nullValue : ""}>{formatNumber(kpi.value, kpi.format, kpi.currency)}</strong>
                <small>{kpi.value === null ? "Джерело не надало значення" : kpi.note || "Без додаткового пояснення"}</small>
              </article>
            ))}
            {!displayKpis.length ? <div className={styles.emptyInline}>Для цього зрізу немає показників.</div> : null}
          </section>

          {!hasRows && !data.leaders.length ? (
            <section className={styles.emptyState}>
              <Search size={25} />
              <h2>У вибраному зрізі немає записів</h2>
              <p>Це порожній результат відповіді, а не нульовий показник. Розширте період або послабте фільтри.</p>
              <button type="button" onClick={resetFilters}>Повернути базовий зріз</button>
            </section>
          ) : (
            <details className={styles.detailDisclosure}>
              <summary><span><b>Деталі закупівель</b><small>Замовники, участі, договори та звʼязки</small></span><ChevronRight size={17} /></summary>
              <div className={styles.detailStack}>
              {data.leaders.length ? (
                <section className={styles.panel}>
                  <header className={styles.panelHead}><div><span>ЗАМОВНИКИ</span><h2>Основні замовники</h2><p>Лідери за кількістю та сумою договорів</p></div><Database size={22} aria-hidden="true" /></header>
                  <div className={styles.tableWrap}>
                    <table className={styles.dataTable}><thead><tr><th>Критерій</th><th>Замовник</th><th>Значення</th></tr></thead><tbody>{data.leaders.map((leader) => <tr key={leader.id}><td>{leader.criterion}</td><td><strong>{leader.buyer}</strong></td><td>{leader.value}</td></tr>)}</tbody></table>
                  </div>
                </section>
              ) : null}

              {!hasRows ? (
                <section className={styles.emptyState}>
                  <Search size={25} />
                  <h2>Немає детальних записів</h2>
                  <p>За вибраними фільтрами доступні лише зведені показники.</p>
                </section>
              ) : (
                <>
              <details className={styles.detailDisclosure}>
                <summary><span><b>Участі та договори</b><small>{integerFormatter.format(data.participants.total)} детальних записів</small></span><ChevronRight size={17} /></summary>
                <section className={styles.panel}>
                <header className={styles.panelHead}>
                  <div><span>УЧАСНИКИ · ФАКТИ</span><h2>Таблиця участей</h2><p>{integerFormatter.format(data.participants.total)} записів у відповіді</p></div>
                  <TableProperties size={22} aria-hidden="true" />
                </header>
                <div className={styles.tableWrap}>
                  <table className={styles.dataTable}>
                    <thead><tr><th>Закупівля</th><th>Замовник</th><th>Постачальник</th><th>Учасники</th><th>Пропозиція</th><th>Результат</th><th>Договір / сплачено</th><th>Якість даних</th></tr></thead>
                    <tbody>
                      {data.participants.items.map((row) => (
                        <tr key={row.id}>
                          <td>
                            <strong>{row.prozorroUrl ? <a href={row.prozorroUrl} target="_blank" rel="noreferrer">{row.title || "Предмет відсутній"}</a> : row.title || "Предмет відсутній"}</strong>
                            <small>{row.tenderId || "ID відсутній"} · {row.date || "дата відсутня у джерелі"}</small>
                            <small>Лот: {row.lotId || "не вказано"} · пропозиція: {row.bidId || "не подана"} · рішення: {row.awardId || "немає"}</small>
                          </td>
                          <td>{row.buyer || <em>Немає даних</em>}</td>
                          <td>{row.supplier || <em>Немає даних</em>}</td>
                          <td title={row.participantDetails ?? undefined}>{row.participants === null ? <em>Немає даних</em> : integerFormatter.format(row.participants)}{row.participantDetails ? <small>Усі пропозиції доступні в підказці</small> : null}</td>
                          <td>{row.offerValue === null ? <em>Немає даних</em> : formatNumber(row.offerValue, "money", row.offerCurrency)}{row.lowestRejected === true ? <small className={styles.riskText}>Найнижчу відхилено{row.rejectionReason ? `: ${row.rejectionReason}` : ""}</small> : row.lowestRejected === null ? <small>Відхилення: немає даних</small> : null}</td>
                          <td><span className={row.winner === true ? styles.winPill : row.winner === false ? styles.lossPill : styles.neutralPill}>{row.winner === true ? "Переможець" : row.winner === false ? row.status || "Не переміг" : row.status || "Немає рішення"}</span>{row.awardValue !== null ? <small>Рішення: {formatNumber(row.awardValue, "money", row.awardCurrency)}</small> : null}</td>
                          <td title={row.contractDetails ?? undefined}>
                            <strong>{row.contractValue === null ? "—" : formatNumber(row.contractValue, "money", row.contractCurrency)}</strong>
                            <small>Первинна: {row.originalContractValue === null ? "немає даних" : formatNumber(row.originalContractValue, "money", row.originalContractCurrency)}</small>
                            <small>Сплачено: {row.paidAmount === null ? "немає даних" : formatNumber(row.paidAmount, "money", row.paidCurrency)}</small>
                            {row.contractIds.length ? <small>ID: {row.contractIds.join(", ")}</small> : null}
                            {row.hasContractChanges !== null ? <small>{row.hasContractChanges ? "Є оприлюднені зміни" : "Оприлюднених змін немає"}</small> : null}
                            {row.status ? <small>Статус: {row.status}</small> : null}
                          </td>
                          <td><SourceLine source={row.source} confidence={row.confidence} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!data.participants.items.length ? <div className={styles.emptyInline}>У відповіді немає рядків участей.</div> : null}
                </div>
                </section>
              </details>

              <details className={styles.detailDisclosure}>
                <summary><span><b>Постачальники та замовники</b><small>Матриця звʼязків із переходом до закупівель</small></span><ChevronRight size={17} /></summary>
                <section className={styles.matrixLayout}>
                <div className={styles.panel}>
                  <header className={styles.panelHead}>
                    <div><span>ЗВʼЯЗКИ · DRILLDOWN</span><h2>Постачальник × замовник</h2><p>Натисніть фактичну комірку. На екрані — до 20 постачальників × 12 замовників із порядку API.</p></div>
                    <TableProperties size={22} aria-hidden="true" />
                  </header>
                  <div className={styles.matrixWrap}>
                    {suppliers.length && buyers.length ? (
                      <table className={styles.matrixTable}>
                        <thead><tr><th>Постачальник</th>{buyers.map((buyer) => <th key={buyer.id}>{buyer.name}</th>)}</tr></thead>
                        <tbody>
                          {suppliers.map((supplier) => (
                            <tr key={supplier.id}>
                              <th>{supplier.name}</th>
                              {buyers.map((buyer) => {
                                const cell = matrixMap.get(`${supplier.id}\u0000${buyer.id}`);
                                return (
                                  <td key={buyer.id}>
                                    {cell ? (
                                      <button type="button" aria-expanded={selectedCell?.id === cell.id} onClick={() => setSelectedCell(cell)}>
                                        <strong>{cell.participations === null ? "—" : integerFormatter.format(cell.participations)}</strong>
                                        <small>{cell.wins === null ? "перемоги: —" : `перемог: ${integerFormatter.format(cell.wins)}`}</small>
                                      </button>
                                    ) : <span aria-label="Звʼязок відсутній">—</span>}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : <div className={styles.emptyInline}>Матриця не містить фактичних пар.</div>}
                  </div>
                </div>

                <aside className={`${styles.drilldown} ${selectedCell ? styles.open : ""}`} aria-live="polite">
                  {selectedCell ? (
                    <>
                      <header><div><span>ОБРАНА ПАРА</span><h2>{selectedCell.supplier}</h2><p>{selectedCell.buyer}</p></div><button type="button" aria-label="Закрити деталізацію" onClick={() => setSelectedCell(null)}><X size={17} /></button></header>
                      <dl>
                        <div><dt>Закупівель</dt><dd>{formatNumber(selectedCell.procurements)}</dd></div>
                        <div><dt>Лотів</dt><dd>{formatNumber(selectedCell.lots)}</dd></div>
                        <div><dt>Участей</dt><dd>{formatNumber(selectedCell.participations)}</dd></div>
                        <div><dt>Перемог</dt><dd>{formatNumber(selectedCell.wins)}</dd></div>
                        <div><dt>Договорів</dt><dd>{formatNumber(selectedCell.contractValue, "money", selectedCell.contractCurrency)}</dd></div>
                      </dl>
                      <SourceLine source={selectedCell.source} confidence={selectedCell.confidence} />
                      <div className={styles.drillList}>
                        <h3>Закупівлі в комірці</h3>
                        {selectedCell.tenders?.map((tender) => (
                          <article key={tender.id}>
                            <span>{tender.tenderId || "ID відсутній"}</span>
                            <strong>{tender.prozorroUrl ? <a href={tender.prozorroUrl} target="_blank" rel="noreferrer">{tender.title || "Предмет відсутній"}</a> : tender.title || "Предмет відсутній"}</strong>
                            <small>Лот: {tender.lotId || "не вказано"} · пропозиція: {tender.bidId || "не подана"} · рішення: {tender.awardId || "немає"}</small>
                            <small>{tender.participantDetails ? `Усі учасники: ${tender.participantDetails}` : "Учасники: немає даних"}</small>
                            {tender.rejectionReason ? <small className={styles.riskText}>Причина відхилення: {tender.rejectionReason}</small> : null}
                            <small>{tender.contractValue === null ? "Договір: немає даних" : `Договір: ${formatNumber(tender.contractValue, "money", tender.contractCurrency)}`}</small>
                            {tender.contractDetails ? <small>{tender.contractDetails}</small> : null}
                            <ChevronRight size={14} aria-hidden="true" />
                          </article>
                        ))}
                        {!selectedCell.tenders?.length ? <p className={styles.nullNotice}>API повернув агреговану пару без переліку закупівель. Деталізацію не вигадано.</p> : null}
                      </div>
                    </>
                  ) : (
                    <div className={styles.drillPlaceholder}><TableProperties size={25} /><b>Оберіть комірку матриці</b><span>Тут зʼявляться лише факти, які повернув API.</span></div>
                  )}
                </aside>
                </section>
              </details>
                </>
              )}
              </div>
            </details>
          )}
        </>
      ) : null}
    </div>
  );
}
