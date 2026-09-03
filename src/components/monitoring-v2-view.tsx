"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, ArrowDown, ArrowUp, BellRing, Check, ChevronDown, ChevronLeft, ChevronRight,
  Columns3, Download, ExternalLink, Filter, RefreshCw, Save, Search, Settings2, SlidersHorizontal, Trash2, X,
} from "lucide-react";
import type {
  MonitoringFacet,
  MonitoringCpvNode,
  MonitoringReviewStatus,
  MonitoringRuleEntry,
  MonitoringV2Filters,
  MonitoringV2Payload,
  MonitoringV2Row,
} from "@/lib/monitoring-v2-types";
import styles from "./monitoring-v2-view.module.css";

type Props = { initialDirection?: string | null; canManage: boolean; canConfigureIntegrations?: boolean; onTotalChange?: (total: number) => void };
type Preset = { id: string; name: string; filters: Record<string, unknown> };
type IntegrationStatus = {
  email: { enabled: boolean; reason: string | null; subscriptions: number; lastSuccessAt: string | null; lastError: string | null };
  excel: { enabled: boolean; reason: string | null; lastSuccessAt: string | null; lastError: string | null };
  subscriptionItems: Array<{ id: string; name: string; recipients: string[] }>;
};
type ColumnId = "subject" | "direction" | "deadline" | "buyer" | "cpv" | "reason" | "confidence" | "participants" | "amount" | "status" | "review";
type Column = { id: ColumnId; label: string; defaultVisible: boolean };

const columns: Column[] = [
  { id: "subject", label: "Закупівля / лот", defaultVisible: true },
  { id: "direction", label: "Напрям", defaultVisible: true },
  { id: "deadline", label: "Дедлайн", defaultVisible: true },
  { id: "buyer", label: "Замовник", defaultVisible: true },
  { id: "cpv", label: "ДК 021:2015", defaultVisible: true },
  { id: "reason", label: "Чому відібрано", defaultVisible: true },
  { id: "confidence", label: "Точність", defaultVisible: true },
  { id: "participants", label: "Учасники", defaultVisible: false },
  { id: "amount", label: "Очікувана сума", defaultVisible: true },
  { id: "status", label: "Статус", defaultVisible: false },
  { id: "review", label: "Рішення команди", defaultVisible: true },
];

const directionMap: Record<string, string[]> = {
  "Капбудівництво": ["construction"],
  "Кондиціонування": ["service-climate"],
  "Сервіс": ["service-climate"],
};

const monitoringCachePrefix = "specservis-monitoring-v2:";
const monitoringCacheTtlMs = 5 * 60_000;

function readMonitoringCache(key: string) {
  try {
    const raw = window.sessionStorage.getItem(`${monitoringCachePrefix}${key}`);
    if (!raw) return null;
    const cached = JSON.parse(raw) as { savedAt: number; payload: MonitoringV2Payload };
    if (!cached.savedAt || Date.now() - cached.savedAt > monitoringCacheTtlMs) {
      window.sessionStorage.removeItem(`${monitoringCachePrefix}${key}`);
      return null;
    }
    return cached.payload;
  } catch {
    return null;
  }
}

function writeMonitoringCache(key: string, payload: MonitoringV2Payload) {
  try {
    window.sessionStorage.setItem(`${monitoringCachePrefix}${key}`, JSON.stringify({ savedAt: Date.now(), payload }));
  } catch {
    // The dashboard remains fully functional when browser storage is unavailable.
  }
}

const emptyFilters = (initialDirection?: string | null): MonitoringV2Filters => ({
  directions: initialDirection ? directionMap[initialDirection] ?? [initialDirection] : [],
  confidence: [], geography: initialDirection === "Капбудівництво" ? ["м. Київ", "Київська область"] : [], categories: [], procedures: [], statuses: [], reviewStatuses: [],
  cpvCodes: [], cpvExclusions: [], cpvIncludeDescendants: true, sort: "newest", page: 1, pageSize: 50,
});

const confidenceLabels = { high: "Висока", medium: "Середня", review: "Перевірити" } as const;
const reviewLabels: Record<MonitoringReviewStatus, string> = {
  relevant: "Релевантна", not_relevant: "Нерелевантна", needs_review: "Потребує перевірки", missed: "Пропущена правилом",
};
const kindLabels: Record<MonitoringRuleEntry["kind"], string> = {
  cpv_include: "ДК включення", cpv_exclude: "ДК виключення", term: "Термін", brand: "Бренд", exclusion: "Текстове виключення",
};

const date = (value: string | null) => value
  ? new Intl.DateTimeFormat("uk-UA", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value))
  : "Не вказано";
const dateTime = (value: string | null) => value
  ? new Intl.DateTimeFormat("uk-UA", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value))
  : "ще не було";
const money = (value: number | null, currency = "UAH") => value == null
  ? "Не вказано"
  : new Intl.NumberFormat("uk-UA", { style: "currency", currency: currency || "UAH", maximumFractionDigits: 0 }).format(value);

function appendArray(params: URLSearchParams, name: string, values?: string[]) {
  for (const value of values ?? []) params.append(name, value);
}

function toParams(filters: MonitoringV2Filters) {
  const params = new URLSearchParams();
  const values: Array<[string, string | number | boolean | null | undefined]> = [
    ["q", filters.q], ["from", filters.from], ["to", filters.to], ["deadlineFrom", filters.deadlineFrom],
    ["deadlineTo", filters.deadlineTo], ["buyer", filters.buyer], ["cpv", filters.cpv],
    ["cpvIncludeDescendants", filters.cpvIncludeDescendants], ["keyword", filters.keyword],
    ["amountMin", filters.amountMin], ["amountMax", filters.amountMax], ["participantsMin", filters.participantsMin],
    ["participantsMax", filters.participantsMax], ["sort", filters.sort], ["page", filters.page], ["pageSize", filters.pageSize],
  ];
  for (const [key, value] of values) if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  appendArray(params, "direction", filters.directions);
  appendArray(params, "category", filters.categories);
  appendArray(params, "procedure", filters.procedures);
  appendArray(params, "status", filters.statuses);
  appendArray(params, "cpvExclude", filters.cpvExclusions);
  appendArray(params, "cpvCode", filters.cpvCodes);
  appendArray(params, "confidence", filters.confidence);
  appendArray(params, "geography", filters.geography);
  appendArray(params, "reviewStatus", filters.reviewStatuses);
  return params;
}

function CpvTreeSelect({ values, options, onChange }: {
  values: string[]; options: MonitoringCpvNode[]; onChange: (values: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const normalized = query.trim().toLocaleLowerCase("uk-UA");
  const shown = options.filter((option) => !normalized || option.code.includes(normalized) || option.label.toLocaleLowerCase("uk-UA").includes(normalized));
  return <details className={styles.multiSelect}>
    <summary><span>ДК 021:2015 · дерево</span><b>{values.length || "Усі"}</b><ChevronDown size={14} /></summary>
    <div>
      <label><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Код або назва" /></label>
      {shown.slice(0, 250).map((option) => {
        const checked = values.includes(option.value);
        return <label key={option.code} style={{ paddingLeft: `${12 + option.depth * 14}px` }}><input type="checkbox" checked={checked} onChange={() => onChange(checked ? values.filter((value) => value !== option.value) : [...values, option.value])} /><span><b>{option.code}</b> · {option.label}</span><small>{option.count}</small></label>;
      })}
    </div>
  </details>;
}

function MultiSelect({ label, values, options, onChange }: {
  label: string; values: string[]; options: MonitoringFacet[]; onChange: (values: string[]) => void;
}) {
  return (
    <details className={styles.multiSelect}>
      <summary><span>{label}</span><b>{values.length || "Усі"}</b><ChevronDown size={14} /></summary>
      <div>{options.map((option) => {
        const checked = values.includes(option.value);
        return <label key={option.value}><input type="checkbox" checked={checked} onChange={() => onChange(checked ? values.filter((value) => value !== option.value) : [...values, option.value])} /><span>{option.label}</span>{option.count == null ? null : <small>{option.count}</small>}</label>;
      })}</div>
    </details>
  );
}

function Cell({ column, row, onOpen }: { column: ColumnId; row: MonitoringV2Row; onOpen: () => void }) {
  if (column === "subject") {
    const title = /^whole procurement$/i.test(row.title.trim()) ? "Закупівля без окремих лотів" : row.title;
    return <button type="button" className={styles.subject} onClick={onOpen}><b>{title}</b><small>{row.tenderId} · лот {row.lotId.slice(-12)}</small></button>;
  }
  if (column === "direction") return <div className={styles.tags}>{row.directions.map((direction) => <span className={direction.primary ? styles.primaryTag : ""} key={direction.id}>{direction.label}</span>)}</div>;
  if (column === "deadline") return <div className={styles.stack}><b>{date(row.deadlineAt)}</b><small>{row.publishedAt ? `Оприлюднено ${date(row.publishedAt)}` : "Дата публікації відсутня"}</small></div>;
  if (column === "buyer") return <div className={styles.stack}><b>{row.buyerName}</b><small>{row.buyerCode || "Код не вказано"}</small></div>;
  if (column === "cpv") return <div className={styles.stack}><b>{row.cpvCodes.join(", ") || "Не вказано"}</b><small>{row.cpvNames.join(" · ")}</small></div>;
  if (column === "reason") return <div className={styles.stack}><b>{row.matchedTerms.join(", ") || row.reasons[0]?.value || "Збіг за попереднім правилом"}</b><small>{row.matchedFields.join(", ") || "Очікує перевірки новими правилами"}</small></div>;
  if (column === "confidence") return <span className={`${styles.confidence} ${styles[row.confidence]}`}>{confidenceLabels[row.confidence]}</span>;
  if (column === "participants") return <b className={styles.number}>{row.participantCount}</b>;
  if (column === "amount") return <b className={styles.amount}>{money(row.expectedAmount, row.currency ?? "UAH")}</b>;
  if (column === "status") return <span>{row.status || "Не вказано"}</span>;
  return <span className={row.reviewStatus ? styles.reviewDone : styles.reviewEmpty}>{row.reviewStatus ? reviewLabels[row.reviewStatus] : "Рішення не внесено"}</span>;
}

function RowDetails({ row, canManage, onSaved }: { row: MonitoringV2Row; canManage: boolean; onSaved: () => void }) {
  const [status, setStatus] = useState<MonitoringReviewStatus>(row.reviewStatus ?? "needs_review");
  const [comment, setComment] = useState(row.reviewComment ?? "");
  const [suggestedRule, setSuggestedRule] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const save = async (nextStatus = status) => {
    if (nextStatus === "not_relevant" && !comment.trim()) {
      setError("Щоб прибрати закупівлю, додайте короткий коментар для менеджера.");
      return;
    }
    setSaving(true); setError("");
    const response = await fetch("/api/monitoring-v2", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        procurementId: row.procurementId,
        lotId: row.lotId,
        directionId: row.directions.find((item) => item.primary)?.id === "service-climate"
          ? "conditioning"
          : row.directions.find((item) => item.primary)?.id ?? null,
        status: nextStatus,
        comment,
        suggestedRule,
      }),
    });
    setSaving(false);
    if (!response.ok) { setError(response.status === 403 ? "Рішення може вносити керівник або директор." : "Не вдалося зберегти рішення."); return; }
    onSaved();
  };
  return (
    <div className={styles.details}>
      <div className={styles.detailGrid}>
        <div><span>Місце виконання</span><b>{row.geography}</b><small>{row.deliveryAddress || "Адреса не оприлюднена"}</small></div>
        <div><span>Чому потрапило</span><b>{row.reasons.map((reason) => reason.value || reason.label).filter(Boolean).join(", ") || "Збіг за класифікатором"}</b><small>{row.needsGeographyReview ? "Географію треба перевірити" : `Джерело географії: ${row.geographyBasis ?? "не вказано"}`}</small></div>
        <div><span>Версія правил</span><b>{row.ruleVersion || "Не вказана"}</b><small>Результат можна відтворити за цією версією</small></div>
        <a href={row.prozorroUrl} target="_blank" rel="noreferrer"><ExternalLink size={16} />Відкрити у Prozorro</a>
      </div>
      {canManage ? <div className={styles.reviewForm}><select value={status} onChange={(event) => setStatus(event.target.value as MonitoringReviewStatus)}><option value="needs_review">Потребує перевірки</option><option value="relevant">Залишити в моніторингу</option></select><input value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Коментар менеджера" /><input value={suggestedRule} onChange={(event) => setSuggestedRule(event.target.value)} placeholder="Термін для словника (необов'язково)" /><button type="button" onClick={() => void save()} disabled={saving}>{saving ? <RefreshCw className={styles.spin} size={15} /> : <Check size={15} />}Зберегти</button><button type="button" className={styles.removeButton} onClick={() => void save("not_relevant")} disabled={saving}><Trash2 size={15} />Прибрати з моніторингу</button>{error ? <small>{error}</small> : null}</div> : null}
    </div>
  );
}

export function MonitoringV2View({ initialDirection = null, canManage, canConfigureIntegrations = false, onTotalChange }: Props) {
  const [filters, setFilters] = useState<MonitoringV2Filters>(() => emptyFilters(initialDirection));
  const deferredFilters = useDeferredValue(filters);
  const [payload, setPayload] = useState<MonitoringV2Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [showColumns, setShowColumns] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [showIntegrations, setShowIntegrations] = useState(false);
  const [integrationStatus, setIntegrationStatus] = useState<IntegrationStatus | null>(null);
  const [subscriptionDraft, setSubscriptionDraft] = useState({ name: "", recipients: "" });
  const [integrationBusy, setIntegrationBusy] = useState(false);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [presetName, setPresetName] = useState("");
  const [columnOrder, setColumnOrder] = useState<ColumnId[]>(() => columns.map((column) => column.id));
  const [visibleColumns, setVisibleColumns] = useState<ColumnId[]>(() => columns.filter((column) => column.defaultVisible).map((column) => column.id));
  const [ruleDraft, setRuleDraft] = useState({ directionId: "conditioning", kind: "term" as MonitoringRuleEntry["kind"], value: "", includeDescendants: false });

  const load = async (signal?: AbortSignal, background = false) => {
    const requestKey = toParams(deferredFilters).toString();
    if (!background) setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/monitoring-v2?${requestKey}`, { cache: "no-store", signal });
      if (!response.ok) throw new Error(`Monitoring request failed (${response.status})`);
      const nextPayload = await response.json() as MonitoringV2Payload;
      setPayload(nextPayload);
      writeMonitoringCache(requestKey, nextPayload);
      onTotalChange?.(nextPayload.total);
    } catch (reason) {
      if (!(reason instanceof DOMException && reason.name === "AbortError")) setError("Не вдалося завантажити моніторинг. Спробуйте оновити сторінку.");
    } finally { if (!signal?.aborted) setLoading(false); }
  };

  useEffect(() => {
    const controller = new AbortController();
    const requestKey = toParams(deferredFilters).toString();
    const cached = readMonitoringCache(requestKey);
    const timer = window.setTimeout(() => {
      if (cached) {
        setPayload(cached);
        setLoading(false);
        onTotalChange?.(cached.total);
      }
      void load(controller.signal, Boolean(cached));
    }, 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [deferredFilters]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const saved = window.localStorage.getItem("specservis-monitoring-columns-v1");
      if (saved) try {
        const parsed = JSON.parse(saved) as { order?: ColumnId[]; visible?: ColumnId[] };
        if (parsed.order?.length) setColumnOrder(parsed.order.filter((id) => columns.some((column) => column.id === id)));
        if (parsed.visible?.length) setVisibleColumns(parsed.visible.filter((id) => columns.some((column) => column.id === id)));
      } catch { window.localStorage.removeItem("specservis-monitoring-columns-v1"); }
      void fetch("/api/analytics-v2/presets", { cache: "no-store" }).then(async (response) => {
        if (!response.ok) return;
        const data = await response.json() as { items?: Preset[] };
        setPresets((data.items ?? []).filter((item) => item.filters._view === "monitoring"));
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const shownColumns = useMemo(() => columnOrder.filter((id) => visibleColumns.includes(id)), [columnOrder, visibleColumns]);
  const update = <K extends keyof MonitoringV2Filters>(key: K, value: MonitoringV2Filters[K]) => setFilters((current) => ({ ...current, [key]: value, page: 1 }));
  const clear = () => setFilters(emptyFilters(initialDirection));
  const saveColumns = (order: ColumnId[], visible: ColumnId[]) => {
    setColumnOrder(order); setVisibleColumns(visible);
    window.localStorage.setItem("specservis-monitoring-columns-v1", JSON.stringify({ order, visible }));
  };
  const moveColumn = (id: ColumnId, delta: number) => {
    const index = columnOrder.indexOf(id); const target = index + delta;
    if (target < 0 || target >= columnOrder.length) return;
    const next = [...columnOrder]; [next[index], next[target]] = [next[target], next[index]]; saveColumns(next, visibleColumns);
  };
  const savePreset = async () => {
    const name = presetName.trim(); if (!name) return;
    const response = await fetch("/api/analytics-v2/presets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: `Моніторинг · ${name}`, filters: { ...filters, _view: "monitoring" } }) });
    if (!response.ok) return;
    const data = await response.json() as { item: Preset }; setPresets((current) => [data.item, ...current]); setPresetName("");
  };
  const publishRule = async () => {
    if (!ruleDraft.value.trim()) return;
    const response = await fetch("/api/monitoring-v2", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "rule-entry", ...ruleDraft, fields: [], active: true, priority: 50 }) });
    if (response.ok) { setRuleDraft((current) => ({ ...current, value: "" })); void load(); }
  };
  const setRuleActive = async (rule: MonitoringRuleEntry, active: boolean) => {
    const response = await fetch("/api/monitoring-v2", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "rule-entry", ...rule, directionId: rule.directionId, fields: rule.fields, active }),
    });
    if (response.ok) void load();
  };
  const publishSuggestion = async (suggestion: MonitoringV2Payload["ruleSuggestions"][number]) => {
    const response = await fetch("/api/monitoring-v2", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "rule-entry", directionId: suggestion.directionId, kind: suggestion.kind, value: suggestion.value, fields: [], active: true, priority: 50 }),
    });
    if (response.ok) void load();
  };
  const loadIntegrations = async () => {
    setIntegrationBusy(true);
    const response = await fetch("/api/integrations/tenders", { cache: "no-store" });
    if (response.ok) setIntegrationStatus(await response.json() as IntegrationStatus);
    setIntegrationBusy(false);
  };
  const toggleIntegrations = () => {
    setShowIntegrations((value) => !value);
    if (!showIntegrations) void loadIntegrations();
  };
  const saveSubscription = async () => {
    if (!subscriptionDraft.name.trim() || !subscriptionDraft.recipients.trim()) return;
    setIntegrationBusy(true);
    const response = await fetch("/api/integrations/tenders", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "save-subscription", name: subscriptionDraft.name, recipients: subscriptionDraft.recipients, filters }),
    });
    if (response.ok) { setSubscriptionDraft({ name: "", recipients: "" }); await loadIntegrations(); }
    else setIntegrationBusy(false);
  };
  const integrationAction = async (action: "test-email" | "sync-excel") => {
    setIntegrationBusy(true);
    await fetch("/api/integrations/tenders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
    await loadIntegrations();
  };
  const activeFilterCount = [filters.q, filters.from, filters.to, filters.deadlineFrom, filters.deadlineTo, filters.buyer, filters.cpv, filters.keyword, filters.amountMin, filters.amountMax, filters.participantsMin, filters.participantsMax].filter(Boolean).length
    + [filters.directions, filters.categories, filters.procedures, filters.statuses, filters.confidence, filters.geography, filters.reviewStatuses, filters.cpvCodes, filters.cpvExclusions].reduce((sum, value) => sum + (value?.length ?? 0), 0);
  const exportHref = `/api/monitoring-v2?${toParams({ ...filters, page: 1 }).toString()}&format=xlsx`;

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div><span>МОНІТОРИНГ PROZORRO</span><h1>Закупівлі, які варто опрацювати</h1><p>Один рядок — один лот. Видно причину відбору, точність правила та рішення команди.</p></div>
        <div className={styles.health}><i className={!payload || payload.sync.incomplete ? styles.warning : styles.ok} /><div><b>{!payload ? "Перевіряємо синхронізацію" : payload.sync.queued > 0 ? "Історія оновлюється у фоні" : payload.sync.incomplete ? "Оновлення потребує уваги" : "Дані актуальні"}</b><small>Успішно: {dateTime(payload?.sync.lastSuccessfulAt ?? null)} · затримка нових даних {payload?.sync.maximumLagMinutes ?? "—"} хв</small><small>Правила: {payload?.ruleVersion || "—"}{payload?.sync.queued ? ` · у черзі ${payload.sync.queued}` : ""}</small></div><button type="button" aria-label="Оновити" onClick={() => void load()}><RefreshCw className={loading ? styles.spin : ""} size={17} /></button></div>
      </section>

      <section className={styles.summary} aria-label="Результат моніторингу">
        <article><span>Сьогодні знайдено</span><strong>{payload?.summary.today.lots.toLocaleString("uk-UA") ?? "—"}</strong><small>лотів · {money(payload?.summary.today.expectedValueUah ?? null)}</small></article>
        <article><span>Цього місяця</span><strong>{payload?.summary.month.lots.toLocaleString("uk-UA") ?? "—"}</strong><small>лотів · {money(payload?.summary.month.expectedValueUah ?? null)}</small></article>
        <article><span>У поточному списку</span><strong>{payload?.total.toLocaleString("uk-UA") ?? "—"}</strong><small>нерелевантні та навчальні записи приховані</small></article>
      </section>

      <section className={styles.toolbar}>
        <label className={styles.search}><Search size={17} /><input value={filters.q ?? ""} onChange={(event) => update("q", event.target.value)} placeholder="Номер, назва, замовник або ЄДРПОУ" />{filters.q ? <button type="button" onClick={() => update("q", "")} aria-label="Очистити пошук"><X size={15} /></button> : null}</label>
        <button type="button" className={styles.filterButton} onClick={() => document.getElementById("monitoring-filters")?.toggleAttribute("open")}><SlidersHorizontal size={16} />Фільтри{activeFilterCount ? <b>{activeFilterCount}</b> : null}</button>
        <button type="button" className={styles.filterButton} onClick={() => setShowColumns((value) => !value)}><Columns3 size={16} />Колонки</button>
        {canManage ? <button type="button" className={styles.filterButton} onClick={() => setShowRules((value) => !value)}><Settings2 size={16} />Правила</button> : null}
        {canConfigureIntegrations ? <button type="button" className={styles.filterButton} onClick={toggleIntegrations}><BellRing size={16} />Сповіщення</button> : null}
        <a className={styles.exportButton} href={exportHref}><Download size={16} />Excel</a>
        <label className={styles.sort}><select value={filters.sort} onChange={(event) => update("sort", event.target.value as MonitoringV2Filters["sort"])}><option value="newest">Спочатку нові</option><option value="deadline">Найближчий дедлайн</option><option value="amount-desc">Найбільша сума</option><option value="amount-asc">Найменша сума</option></select><ChevronDown size={14} /></label>
      </section>

      <details id="monitoring-filters" className={styles.filters}>
        <summary><Filter size={16} /><b>Усі критерії відбору</b><span>{activeFilterCount ? `Застосовано: ${activeFilterCount}` : "Без додаткових обмежень"}</span><ChevronDown size={15} /></summary>
        <div className={styles.filterGrid}>
          <label><span>Публікація від</span><input type="date" value={filters.from ?? ""} onChange={(event) => update("from", event.target.value)} /></label>
          <label><span>Публікація до</span><input type="date" value={filters.to ?? ""} onChange={(event) => update("to", event.target.value)} /></label>
          <label><span>Дедлайн від</span><input type="date" value={filters.deadlineFrom ?? ""} onChange={(event) => update("deadlineFrom", event.target.value)} /></label>
          <label><span>Дедлайн до</span><input type="date" value={filters.deadlineTo ?? ""} onChange={(event) => update("deadlineTo", event.target.value)} /></label>
          <label><span>Замовник / ЄДРПОУ</span><input value={filters.buyer ?? ""} onChange={(event) => update("buyer", event.target.value)} /></label>
          <label><span>Ключове слово / бренд / причина</span><input value={filters.keyword ?? ""} onChange={(event) => update("keyword", event.target.value)} /></label>
          <CpvTreeSelect values={filters.cpvCodes ?? []} options={payload?.facets.cpv ?? []} onChange={(values) => update("cpvCodes", values)} />
          <label><span>ДК: швидкий пошук</span><input value={filters.cpv ?? ""} onChange={(event) => update("cpv", event.target.value)} placeholder="Наприклад, 453312 або вентиляція" /><em><input type="checkbox" checked={filters.cpvIncludeDescendants !== false} onChange={(event) => update("cpvIncludeDescendants", event.target.checked)} />включати дочірні коди</em></label>
          <label><span>Виключити ДК-префікси</span><input value={(filters.cpvExclusions ?? []).join(", ")} onChange={(event) => update("cpvExclusions", event.target.value.split(",").map((value) => value.trim()).filter(Boolean))} placeholder="45233, 713225" /></label>
          <MultiSelect label="Напрям" values={filters.directions ?? []} options={payload?.facets.directions ?? []} onChange={(values) => update("directions", values)} />
          <MultiSelect label="Тип предмета" values={filters.categories ?? []} options={payload?.facets.categories ?? []} onChange={(values) => update("categories", values)} />
          <MultiSelect label="Процедура" values={filters.procedures ?? []} options={payload?.facets.procedures ?? []} onChange={(values) => update("procedures", values)} />
          <MultiSelect label="Статус" values={filters.statuses ?? []} options={payload?.facets.statuses ?? []} onChange={(values) => update("statuses", values)} />
          <MultiSelect label="Точність" values={filters.confidence ?? []} options={Object.entries(confidenceLabels).map(([value, label]) => ({ value, label }))} onChange={(values) => update("confidence", values as MonitoringV2Filters["confidence"])} />
          <MultiSelect label="Географія" values={filters.geography ?? []} options={payload?.facets.geography ?? []} onChange={(values) => update("geography", values)} />
          <MultiSelect label="Рішення перевірки" values={filters.reviewStatuses ?? []} options={[{ value: "relevant", label: reviewLabels.relevant }, { value: "needs_review", label: reviewLabels.needs_review }]} onChange={(values) => update("reviewStatuses", values as MonitoringV2Filters["reviewStatuses"])} />
          <label><span>Сума від</span><input type="number" value={filters.amountMin ?? ""} onChange={(event) => update("amountMin", event.target.value ? Number(event.target.value) : null)} /></label>
          <label><span>Сума до</span><input type="number" value={filters.amountMax ?? ""} onChange={(event) => update("amountMax", event.target.value ? Number(event.target.value) : null)} /></label>
          <label><span>Учасників від</span><input type="number" min="0" value={filters.participantsMin ?? ""} onChange={(event) => update("participantsMin", event.target.value ? Number(event.target.value) : null)} /></label>
          <label><span>Учасників до</span><input type="number" min="0" value={filters.participantsMax ?? ""} onChange={(event) => update("participantsMax", event.target.value ? Number(event.target.value) : null)} /></label>
        </div>
        <footer><button type="button" onClick={clear}><X size={15} />Очистити</button><div className={styles.preset}><select value="" onChange={(event) => { const preset = presets.find((item) => item.id === event.target.value); if (preset) setFilters({ ...emptyFilters(initialDirection), ...(preset.filters as MonitoringV2Filters), page: 1 }); }}><option value="">Збережені набори</option>{presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name.replace(/^Моніторинг · /, "")}</option>)}</select><input value={presetName} onChange={(event) => setPresetName(event.target.value)} placeholder="Назва нового набору" /><button type="button" onClick={() => void savePreset()} disabled={!presetName.trim()}><Save size={15} />Зберегти</button></div></footer>
      </details>

      {showColumns ? <section className={styles.settingsPanel}><header><div><b>Колонки таблиці</b><small>Увімкніть потрібні поля та змініть їх порядок.</small></div><button type="button" onClick={() => setShowColumns(false)}><X size={16} /></button></header><div>{columnOrder.map((id, index) => { const column = columns.find((item) => item.id === id)!; const checked = visibleColumns.includes(id); return <div className={styles.columnRow} key={id}><label><input type="checkbox" checked={checked} onChange={() => saveColumns(columnOrder, checked ? visibleColumns.filter((value) => value !== id) : [...visibleColumns, id])} /><span>{column.label}</span></label><button type="button" disabled={index === 0} onClick={() => moveColumn(id, -1)} aria-label="Підняти"><ArrowUp size={14} /></button><button type="button" disabled={index === columnOrder.length - 1} onClick={() => moveColumn(id, 1)} aria-label="Опустити"><ArrowDown size={14} /></button></div>; })}</div></section> : null}

      {showRules && canManage ? <section className={styles.settingsPanel}><header><div><b>Правила відбору · версія {payload?.ruleVersion || "—"}</b><small>Навчальні рішення не потрапляють у моніторинг — вони лише підказують зміни словника.</small></div><button type="button" onClick={() => setShowRules(false)}><X size={16} /></button></header>{payload?.ruleSuggestions.length ? <><header><div><b>Підказки зі зворотного звʼязку</b><small>Додайте правило лише після перевірки менеджером.</small></div></header><div className={styles.ruleList}>{payload.ruleSuggestions.map((suggestion) => <span key={`${suggestion.directionId}:${suggestion.kind}:${suggestion.value}`}><b>{suggestion.directionId}</b><em>{kindLabels[suggestion.kind]}</em><i>{suggestion.value} · {suggestion.occurrences}</i><button type="button" onClick={() => void publishSuggestion(suggestion)}>Додати</button></span>)}</div></> : null}<div className={styles.ruleList}>{payload?.rules.map((rule) => <span key={rule.id}><b>{rule.directionLabel}</b><em>{kindLabels[rule.kind]}</em><i>{rule.value}</i><button type="button" onClick={() => void setRuleActive(rule, !rule.active)}>{rule.active ? "Вимкнути" : "Увімкнути"}</button></span>)}</div><footer className={styles.ruleForm}><select value={ruleDraft.directionId} onChange={(event) => setRuleDraft((current) => ({ ...current, directionId: event.target.value }))}><option value="construction">Будівельні</option><option value="conditioning">Сервіс і кондиціонування</option></select><select value={ruleDraft.kind} onChange={(event) => setRuleDraft((current) => ({ ...current, kind: event.target.value as MonitoringRuleEntry["kind"] }))}>{Object.entries(kindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><input value={ruleDraft.value} onChange={(event) => setRuleDraft((current) => ({ ...current, value: event.target.value }))} placeholder="Код, термін, бренд або виключення" />{ruleDraft.kind.startsWith("cpv_") ? <label><input type="checkbox" checked={ruleDraft.includeDescendants} onChange={(event) => setRuleDraft((current) => ({ ...current, includeDescendants: event.target.checked }))} />Дочірні коди</label> : null}<button type="button" onClick={() => void publishRule()} disabled={!ruleDraft.value.trim()}><Save size={15} />Опублікувати версію</button></footer></section> : null}

      {showIntegrations && canConfigureIntegrations ? <section className={styles.settingsPanel}><header><div><b>Сповіщення та онлайн-таблиця</b><small>Підписка використовує поточний набір фільтрів. Нові й змінені закупівлі надсилаються без повторів.</small></div><button type="button" onClick={() => setShowIntegrations(false)}><X size={16} /></button></header><div className={styles.ruleList}><span><b>Email</b><em>{integrationStatus?.email.enabled ? "Працює" : "Потрібне підключення"}</em><i>{integrationStatus?.email.reason || `Остання відправка: ${dateTime(integrationStatus?.email.lastSuccessAt ?? null)}`}</i><button type="button" disabled={!integrationStatus?.email.enabled || integrationBusy} onClick={() => void integrationAction("test-email")}>Тест</button></span><span><b>Excel Online</b><em>{integrationStatus?.excel.enabled ? "Працює" : "Потрібне підключення"}</em><i>{integrationStatus?.excel.reason || `Оновлено: ${dateTime(integrationStatus?.excel.lastSuccessAt ?? null)}`}</i><button type="button" disabled={!integrationStatus?.excel.enabled || integrationBusy} onClick={() => void integrationAction("sync-excel")}>Синхронізувати</button></span>{integrationStatus?.subscriptionItems.map((item) => <span key={item.id}><b>{item.name}</b><em>Підписка</em><i>{item.recipients.join(", ")}</i><button type="button" disabled>Активна</button></span>)}</div><footer className={styles.ruleForm}><input value={subscriptionDraft.name} onChange={(event) => setSubscriptionDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Назва підписки" /><input value={subscriptionDraft.recipients} onChange={(event) => setSubscriptionDraft((current) => ({ ...current, recipients: event.target.value }))} placeholder="Email через кому" /><button type="button" onClick={() => void saveSubscription()} disabled={integrationBusy || !subscriptionDraft.name.trim() || !subscriptionDraft.recipients.trim()}><Save size={15} />Зберегти поточні фільтри</button></footer></section> : null}

      {error ? <div className={styles.error}><AlertTriangle size={17} />{error}</div> : null}
      <section className={styles.tableCard} aria-busy={loading}>
        <header><div><b>{payload?.total.toLocaleString("uk-UA") ?? "—"} лотів</b><small>Показано {payload?.rows.length ?? 0} · суми й поля лише там, де вони є у джерелі</small></div>{loading ? <span><RefreshCw className={styles.spin} size={15} />Оновлюємо</span> : null}</header>
        <div className={styles.tableWrap}><table><thead><tr>{shownColumns.map((id) => <th key={id}>{columns.find((column) => column.id === id)?.label}</th>)}</tr></thead><tbody>{payload?.rows.map((row) => <tr key={row.id} className={openRow === row.id ? styles.open : ""}><td colSpan={shownColumns.length} className={styles.rowShell}><table><tbody><tr>{shownColumns.map((column) => <td key={column}><Cell column={column} row={row} onOpen={() => setOpenRow((value) => value === row.id ? null : row.id)} /></td>)}</tr></tbody></table>{openRow === row.id ? <RowDetails row={row} canManage={canManage} onSaved={() => void load()} /> : null}</td></tr>)}</tbody></table></div>
        {!loading && !payload?.rows.length ? <div className={styles.empty}><Search size={22} /><b>За цими критеріями лотів немає</b><span>Очистіть частину фільтрів або розширте період.</span></div> : null}
        <footer className={styles.pagination}><span>Сторінка {payload?.page ?? 1} з {Math.max(1, Math.ceil((payload?.total ?? 0) / (payload?.pageSize ?? 50)))}</span><button type="button" disabled={(filters.page ?? 1) <= 1} onClick={() => update("page", Math.max(1, (filters.page ?? 1) - 1))}><ChevronLeft size={15} />Назад</button><button type="button" disabled={(filters.page ?? 1) * (payload?.pageSize ?? 50) >= (payload?.total ?? 0)} onClick={() => update("page", (filters.page ?? 1) + 1)}>Далі<ChevronRight size={15} /></button></footer>
      </section>
    </div>
  );
}
