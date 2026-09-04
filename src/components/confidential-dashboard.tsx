"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarRange, CircleAlert, LoaderCircle, MousePointerClick, RefreshCw, X } from "lucide-react";
import { buildConfidentialDashboard, type ComparableTurnover, type TurnoverMonth } from "@/lib/confidential-dashboard";
import type { ConfidentialTurnoverDataset } from "@/lib/confidential-turnover";
import { CompanyPieChart, entityValue, growth, InteractiveMetricChart, money, monthLabel, oneDecimal, percent, SourceBars, wholeNumber, type CompanySlice, type EntityId, type FinanceChartPoint, type FinanceMetric } from "./confidential-finance-charts";
import styles from "./confidential-dashboard.module.css";

type ViewMode = "current" | "compare";
type Detail = { metric: FinanceMetric; point: FinanceChartPoint };

const ukDate = new Intl.DateTimeFormat("uk-UA", { day: "2-digit", month: "long", year: "numeric", timeZone: "Europe/Kyiv" });
const monthNames = ["січень", "лютий", "березень", "квітень", "травень", "червень", "липень", "серпень", "вересень", "жовтень", "листопад", "грудень"];
const monthShort = ["січ", "лют", "бер", "квіт", "трав", "черв", "лип", "серп", "вер", "жовт", "лист", "груд"];
const entityDefinitions: Array<{ id: EntityId; label: string }> = [
  { id: "specservis", label: "Спецсервіс" },
  { id: "promtech", label: "Промтехгруп" },
  { id: "refkey", label: "Рефкей" },
  { id: "naryshkov", label: "ФОП Наришков" },
  { id: "pashkov", label: "ФОП Пашков" },
  { id: "danilenko", label: "ФОП Даниленко" },
];

const sum = (values: Array<number | null | undefined>) => values.reduce<number>((total, value) => total + (value ?? 0), 0);
function average(values: Array<number | null>) { const known = values.filter((value): value is number => value !== null); return known.length ? sum(known) / known.length : null; }
function monthNumber(period: string) { return Number(period.slice(5, 7)); }
function titleCase(value: string) { return value.charAt(0).toUpperCase() + value.slice(1); }
function rangeLabel(period: ComparableTurnover) { return `${monthShort[monthNumber(period.from) - 1]}–${monthShort[monthNumber(period.to) - 1]} ${period.to.slice(0, 4)}`; }
function fullRangeLabel(period: ComparableTurnover) { return `${titleCase(monthNames[monthNumber(period.from) - 1])}–${monthNames[monthNumber(period.to) - 1]} ${period.to.slice(0, 4)}`; }
function valueForMetric(period: ComparableTurnover, metric: FinanceMetric) {
  if (metric === "turnover") return period.baseTurnover;
  if (metric === "cocaCola") return sum(period.monthly.map((month) => month.cocaColaTurnover));
  if (metric === "productivity") return period.lastTurnoverPerFte;
  if (metric === "averageProductivity") return period.turnoverPerFte;
  if (metric === "fte") return period.lastFte;
  return period.avgFte;
}
function formatterFor(metric: FinanceMetric) {
  if (metric === "averageFte") return (value: number | null) => value === null ? "—" : wholeNumber.format(value);
  if (metric === "fte") return (value: number | null) => value === null ? "—" : oneDecimal.format(value);
  return money;
}

function currentPoints(months: TurnoverMonth[], metric: FinanceMetric): FinanceChartPoint[] {
  return months.map((month, index) => {
    const prefix = months.slice(0, index + 1);
    const value = metric === "turnover" ? month.baseTurnover
      : metric === "cocaCola" ? month.cocaColaTurnover
      : metric === "productivity" ? month.turnoverPerFte
        : metric === "averageProductivity" ? average(prefix.map((item) => item.turnoverPerFte))
          : metric === "fte" ? month.fte : average(prefix.map((item) => item.fte));
    return { id: `${metric}:${month.period}`, label: monthShort[monthNumber(month.period) - 1], value, months: metric === "averageProductivity" || metric === "averageFte" ? prefix : [month] };
  });
}

function comparisonPoints(periods: ComparableTurnover[], metric: FinanceMetric): FinanceChartPoint[] {
  return periods.map((period) => ({
    id: `${metric}:${period.id}`,
    label: period.to.slice(0, 4),
    value: valueForMetric(period, metric),
    months: metric === "productivity" || metric === "fte" ? period.monthly.slice(-1) : period.monthly,
  }));
}

function companySlices(months: TurnoverMonth[], metric: "turnover" | "productivity" | "averageProductivity"): CompanySlice[] {
  const values = entityDefinitions.map((entity) => {
    const value = metric === "turnover"
      ? sum(months.map((month) => entityValue(month, entity.id)))
      : average(months.map((month) => month.fte ? entityValue(month, entity.id) / month.fte : null)) ?? 0;
    return { ...entity, value };
  }).filter((item) => item.value > 0);
  const total = sum(values.map((item) => item.value));
  return values.map((item) => ({ ...item, share: total ? item.value / total : 0 })).sort((left, right) => right.value - left.value);
}

function cocaColaSlices(months: TurnoverMonth[]): CompanySlice[] {
  const values = [
    { id: "coca-specservis", label: "Спецсервіс", value: sum(months.map((month) => month.cocaColaSpecservis)) },
    { id: "coca-promtech", label: "Промтехгруп", value: sum(months.map((month) => month.cocaColaPromtech)) },
  ].filter((item) => item.value > 0);
  const total = sum(values.map((item) => item.value));
  return values.map((item) => ({ ...item, share: total ? item.value / total : 0 })).sort((left, right) => right.value - left.value);
}

function metricTitle(metric: FinanceMetric) {
  if (metric === "turnover") return "З чого складається оборот";
  if (metric === "cocaCola") return "З чого складається оборот Coca-Cola";
  if (metric === "productivity") return "Як розраховано оборот на працівника";
  if (metric === "averageProductivity") return "Як розраховано середній оборот на працівника";
  if (metric === "fte") return "Кількість повних робочих ставок";
  return "Як розрахована середня кількість працівників";
}

function metricExplanation(metric: FinanceMetric, months: TurnoverMonth[]) {
  if (metric === "turnover") return `Сума обороту компаній за ${months.length === 1 ? monthLabel(months[0].period) : `${months.length} місяців`}.`;
  if (metric === "cocaCola") return `Сума обороту Coca-Cola за ${months.length === 1 ? monthLabel(months[0].period) : `${months.length} місяців`}.`;
  if (metric === "productivity") return "Оборот місяця поділено на кількість повних робочих ставок цього місяця.";
  if (metric === "averageProductivity") return `Середнє з ${months.length} місячних значень обороту на одного працівника.`;
  if (metric === "fte") return "Пряме значення кількості повних робочих ставок із вихідного файлу.";
  return `Середнє з ${months.length} місячних значень кількості повних робочих ставок.`;
}

function DetailModal({ detail, onClose }: { detail: Detail; onClose: () => void }) {
  const { metric, point } = detail;
  const isMoney = metric === "turnover" || metric === "productivity" || metric === "averageProductivity" || metric === "cocaCola";
  const formatter = formatterFor(metric);
  const slices = metric === "cocaCola" ? cocaColaSlices(point.months) : metric === "turnover" || metric === "productivity" || metric === "averageProductivity" ? companySlices(point.months, metric) : [];
  const sourceRows = point.months.map((month) => ({ id: month.period, label: monthLabel(month.period), value: metric === "averageProductivity" ? month.turnoverPerFte : month.fte }));
  const sourceFormatter = metric === "fte" || metric === "averageFte" ? (value: number | null) => value === null ? "—" : oneDecimal.format(value) : formatter;
  const lastMonth = point.months.at(-1) ?? null;
  const footer = metric === "cocaCola"
    ? "Оборот Coca-Cola показано окремо й не включено до чотирьох основних показників. AB InBev тут не враховується."
    : isMoney ? "Coca-Cola та AB InBev не включені в оборот і його розподіл."
      : "FTE — кількість повних робочих ставок. Дві людини по пів ставки дорівнюють 1 FTE.";
  return <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className={styles.detailModal} role="dialog" aria-modal="true" aria-labelledby="detail-title"><header><div><span>{point.label}</span><h2 id="detail-title">{metricTitle(metric)}</h2><p>{metricExplanation(metric, point.months)}</p></div><button type="button" onClick={onClose} aria-label="Закрити"><X size={20} /></button></header><div className={styles.detailValue}><span>Показник</span><strong>{formatter(point.value)}</strong></div>{isMoney ? <CompanyPieChart items={slices} total={sum(slices.map((item) => item.value))} format={formatter} /> : <SourceBars rows={sourceRows} format={sourceFormatter} selectedId={point.months.length === 1 ? point.months[0].period : undefined} />}{metric === "productivity" && lastMonth ? <div className={styles.formula}><span>{money(lastMonth.baseTurnover)}</span><i>÷</i><span>{oneDecimal.format(lastMonth.fte ?? 0)} працівника</span><i>=</i><b>{money(lastMonth.turnoverPerFte)}</b></div> : null}<footer>{footer}</footer></section></div>;
}

function FinanceContent({ dataset }: { dataset: ConfidentialTurnoverDataset }) {
  const [mode, setMode] = useState<ViewMode>("current");
  const [detail, setDetail] = useState<Detail | null>(null);
  const model = useMemo(() => buildConfidentialDashboard(dataset.records, "ytd"), [dataset.records]);
  const periods = model.history.slice(-4);
  const current = periods.at(-1)!;
  const previous = periods.at(-2) ?? null;
  const latest = current.monthly.at(-1)!;
  const latestYear = latest.period.slice(0, 4);
  const periodMonths = current.monthly.length;
  const pointSet = (metric: FinanceMetric) => mode === "current" ? currentPoints(current.monthly, metric) : comparisonPoints(periods, metric);
  const open = (metric: FinanceMetric) => (point: FinanceChartPoint) => setDetail({ metric, point });
  const kpis: Array<{ metric: FinanceMetric; label: string; value: number | null; note: string; delta: number | null }> = [
    { metric: "turnover", label: "Оборот групи", value: current.baseTurnover, note: `За ${periodMonths} місяців`, delta: growth(current.baseTurnover, previous?.baseTurnover ?? null) },
    { metric: "productivity", label: `Оборот на 1 працівника · ${monthNames[monthNumber(latest.period) - 1]}`, value: current.lastTurnoverPerFte, note: "Останній місяць періоду", delta: growth(current.lastTurnoverPerFte, previous?.lastTurnoverPerFte ?? null) },
    { metric: "averageProductivity", label: `Оборот на 1 працівника за ${latestYear} рік (${periodMonths} міс.)`, value: current.turnoverPerFte, note: `Середнє за ${periodMonths} місяців`, delta: growth(current.turnoverPerFte, previous?.turnoverPerFte ?? null) },
    { metric: "averageFte", label: "Середня кількість працівників", value: current.avgFte, note: "Повних робочих ставок", delta: growth(current.avgFte, previous?.avgFte ?? null) },
  ];

  useEffect(() => {
    if (!detail) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setDetail(null); };
    document.documentElement.style.overflow = "hidden";
    window.addEventListener("keydown", close);
    return () => { document.documentElement.style.overflow = ""; window.removeEventListener("keydown", close); };
  }, [detail]);

  return <div className={`owner-stack ${styles.financeApp}`}>
    <section className={styles.stickyToolbar} aria-label="Режим фінансового огляду"><div><CalendarRange size={18} /><span><b>Фінанси</b><small>Дані по {monthLabel(latest.period)} · оновлено {ukDate.format(new Date(dataset.source.modifiedAt))}</small></span></div><div className={styles.modeSwitch}><button type="button" className={mode === "current" ? styles.activeMode : ""} aria-pressed={mode === "current"} onClick={() => setMode("current")}>Поточний рік</button><button type="button" className={mode === "compare" ? styles.activeMode : ""} aria-pressed={mode === "compare"} onClick={() => setMode("compare")}>Порівняння років</button></div></section>

    <section className={styles.summaryCard}><header><div><h1>{fullRangeLabel(current)}</h1><p>Усі показники порівнюються з таким самим періодом минулого року</p></div><span>{periodMonths} місяців<small>Без Coca-Cola та AB InBev</small></span></header><div className={styles.kpiGrid}>{kpis.map((kpi) => <button type="button" key={kpi.metric} className={kpi.metric === "turnover" ? styles.primaryKpi : ""} onClick={() => setDetail({ metric: kpi.metric, point: { id: `kpi:${kpi.metric}`, label: fullRangeLabel(current), value: kpi.value, months: kpi.metric === "productivity" ? [latest] : current.monthly } })}><span>{kpi.label}</span><strong>{formatterFor(kpi.metric)(kpi.value)}</strong><div><b className={kpi.delta === null ? styles.neutral : kpi.delta >= 0 ? styles.positive : styles.negative}>{percent(kpi.delta, true)}</b><small>до минулого року</small></div><p>{kpi.note}</p></button>)}</div></section>

    <section className={styles.sectionHeading}><div><h2>{mode === "current" ? `Динаміка ${latestYear} року` : `Порівняння за ${periodMonths} місяців`}</h2><p>Наведіть на точку або колонку, щоб побачити значення. Натисніть, щоб відкрити розшифровку.</p></div><MousePointerClick size={20} /></section>

    <InteractiveMetricChart title="Оборот групи" description={mode === "current" ? "Оборот кожного місяця поточного року" : `Сума за однакові ${periodMonths} місяців кожного року`} points={pointSet("turnover")} variant="bar" format={money} onSelect={open("turnover")} />
    <section className={styles.twoCharts}><InteractiveMetricChart title="Оборот на 1 працівника" description={mode === "current" ? "Значення за кожен місяць" : `Значення за ${monthNames[monthNumber(latest.period) - 1]} кожного року`} points={pointSet("productivity")} variant="line" format={money} onSelect={open("productivity")} /><InteractiveMetricChart title={`Середнє за ${periodMonths} місяців`} description="Середній місячний оборот на одного працівника" points={pointSet("averageProductivity")} variant="line" tone="green" format={money} onSelect={open("averageProductivity")} /></section>
    <section className={styles.twoCharts}><InteractiveMetricChart title="Кількість працівників" description={mode === "current" ? "Повні робочі ставки за кожен місяць" : `Кількість у ${monthNames[monthNumber(latest.period) - 1]} кожного року`} points={pointSet("fte")} variant="bar" tone="orange" format={formatterFor("fte")} onSelect={open("fte")} /><InteractiveMetricChart title={`Середня кількість за ${periodMonths} місяців`} description="Середнє значення повних робочих ставок" points={pointSet("averageFte")} variant="line" tone="orange" format={formatterFor("averageFte")} onSelect={open("averageFte")} /></section>

    <section className={styles.tablesSection}><article><header><h2>Показники за роками</h2><p>Однаковий період кожного року</p></header><div className={styles.tableWrap}><table><thead><tr><th>Період</th><th>Оборот групи</th><th>На 1 працівника<br /><small>останній місяць</small></th><th>На 1 працівника<br /><small>середнє</small></th><th>Середня кількість<br /><small>працівників</small></th></tr></thead><tbody>{periods.map((period) => <tr key={period.id}><th>{rangeLabel(period)}</th>{(["turnover", "productivity", "averageProductivity", "averageFte"] as FinanceMetric[]).map((metric) => <td key={metric}><button type="button" onClick={() => setDetail({ metric, point: comparisonPoints([period], metric)[0] })}>{formatterFor(metric)(valueForMetric(period, metric))}</button></td>)}</tr>)}</tbody></table></div></article><article><header><h2>Зміна до попереднього року</h2><p>Зелений — зростання, помаранчевий — зниження</p></header><div className={styles.tableWrap}><table><thead><tr><th>Період</th><th>Оборот</th><th>На 1 працівника<br /><small>останній місяць</small></th><th>На 1 працівника<br /><small>середнє</small></th><th>Кількість<br /><small>працівників</small></th></tr></thead><tbody>{periods.map((period, index) => { const prior = periods[index - 1]; return <tr key={period.id}><th>{rangeLabel(period)}</th>{(["turnover", "productivity", "averageProductivity", "averageFte"] as FinanceMetric[]).map((metric) => { const delta = prior ? growth(valueForMetric(period, metric), valueForMetric(prior, metric)) : null; return <td key={metric}><button type="button" className={delta === null ? styles.neutral : delta >= 0 ? styles.positive : styles.negative} onClick={() => setDetail({ metric, point: comparisonPoints([period], metric)[0] })}>{prior ? percent(delta, true) : "—"}</button></td>; })}</tr>; })}</tbody></table></div></article></section>

    <InteractiveMetricChart title="Оборот Coca-Cola" description={mode === "current" ? "Окремий оборот за кожен місяць; не входить до основних показників" : `Окремий оборот за однакові ${periodMonths} місяців кожного року`} points={pointSet("cocaCola")} variant="bar" tone="red" format={money} onSelect={open("cocaCola")} />

    {detail && typeof document !== "undefined" ? createPortal(<DetailModal detail={detail} onClose={() => setDetail(null)} />, document.body) : null}
  </div>;
}

export function FinanceDashboard({ dataset: initialDataset }: { dataset?: ConfidentialTurnoverDataset }) {
  const [dataset, setDataset] = useState(initialDataset ?? null), [error, setError] = useState(""), [loading, setLoading] = useState(!initialDataset);
  const load = useCallback(async (signal?: AbortSignal) => { setLoading(true); try { const response = await fetch("/api/confidential/turnover", { cache: "no-store", signal }); if (response.status === 401) { window.location.assign("/login"); return; } if (!response.ok) throw new Error(response.status === 403 ? "Цей акаунт не має доступу до фінансів." : "Не вдалося завантажити фінансові дані."); setDataset(await response.json() as ConfidentialTurnoverDataset); setError(""); } catch (cause) { if (cause instanceof DOMException && cause.name === "AbortError") return; setError(cause instanceof Error ? cause.message : "Не вдалося завантажити фінансові дані."); } finally { if (!signal?.aborted) setLoading(false); } }, []);
  useEffect(() => { if (initialDataset) return; const controller = new AbortController(); fetch("/api/confidential/turnover", { cache: "no-store", signal: controller.signal }).then((response) => { if (response.status === 401) { window.location.assign("/login"); throw new Error("Unauthorized"); } if (!response.ok) throw new Error(response.status === 403 ? "Цей акаунт не має доступу до фінансів." : "Не вдалося завантажити фінансові дані."); return response.json() as Promise<ConfidentialTurnoverDataset>; }).then((payload) => { setDataset(payload); setError(""); }).catch((cause: unknown) => { if (cause instanceof DOMException && cause.name === "AbortError") return; if (cause instanceof Error && cause.message !== "Unauthorized") setError(cause.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); }); return () => controller.abort(); }, [initialDataset]);
  if (!dataset) return <div className={styles.financeState}>{loading ? <LoaderCircle className="spin" size={27} /> : <CircleAlert size={27} />}<h2>{loading ? "Завантажуємо фінансові дані" : error}</h2>{!loading ? <button type="button" onClick={() => void load()}><RefreshCw size={16} />Спробувати ще раз</button> : null}</div>;
  return <FinanceContent dataset={dataset} />;
}

export function ConfidentialDashboard({ dataset }: { dataset: ConfidentialTurnoverDataset }) { return <FinanceDashboard dataset={dataset} />; }
