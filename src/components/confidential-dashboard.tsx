"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarRange, CircleAlert, LoaderCircle, RefreshCw, X } from "lucide-react";
import { buildConfidentialDashboard, type ComparableTurnover, type TurnoverMonth } from "@/lib/confidential-dashboard";
import type { ConfidentialTurnoverDataset } from "@/lib/confidential-turnover";
import {
  CompanyPieChart, entityValue, growth, InteractiveMetricChart, money, monthLabel, oneDecimal, percent, SourceBars, wholeNumber,
  type CompanySlice, type EntityId, type FinanceChartPoint, type FinanceLocale, type FinanceMetric,
} from "./confidential-finance-charts";
import styles from "./confidential-dashboard.module.css";

export type { FinanceLocale } from "./confidential-finance-charts";

type ViewMode = "current" | "compare";
type Detail = { metric: FinanceMetric; point: FinanceChartPoint };

const COPY = {
  uk: {
    intl: "uk-UA", months: ["січень", "лютий", "березень", "квітень", "травень", "червень", "липень", "серпень", "вересень", "жовтень", "листопад", "грудень"], shortMonths: ["січ", "лют", "бер", "квіт", "трав", "черв", "лип", "серп", "вер", "жовт", "лист", "груд"],
    finance: "Фінанси", currentYear: "Поточний рік", compareYears: "Порівняння років", viewMode: "Режим фінансового огляду", language: "Мова фінансового модуля", updated: "оновлено",
    samePeriod: "Усі показники порівнюються з таким самим періодом минулого року", excluded: "Без Coca-Cola та AB InBev", turnover: "Оборот групи", productivity: "Оборот на 1 працівника", averageEmployees: "Середня кількість працівників", previousYear: "до минулого року", fullRates: "Повних робочих ставок", employees: "Кількість працівників",
    annualMetrics: "Показники за роками", sameYearPeriod: "Однаковий період кожного року", period: "Період", lastMonthShort: "останній місяць", averageShort: "середнє", changeYear: "Зміна до попереднього року", growthLegend: "Зелений — зростання, помаранчевий — зниження",
    indicator: "Показник", close: "Закрити", turnoverBreakdown: "З чого складається оборот", cocaBreakdown: "З чого складається оборот Coca-Cola", productivityBreakdown: "Як розраховано оборот на працівника", averageProductivityBreakdown: "Як розраховано середній оборот на працівника", fteBreakdown: "Кількість повних робочих ставок", averageFteBreakdown: "Як розрахована середня кількість працівників",
    turnoverFormula: "Оборот місяця поділено на кількість повних робочих ставок цього місяця.", fteSource: "Пряме значення кількості повних робочих ставок із вихідного файлу.", moneyFooter: "Coca-Cola та AB InBev не включені в оборот і його розподіл.", cocaFooter: "Оборот Coca-Cola показано окремо й не включено до чотирьох основних показників. AB InBev тут не враховується.", fteFooter: "FTE — кількість повних робочих ставок. Дві людини по пів ставки дорівнюють 1 FTE.", employeeUnit: "працівника",
    loading: "Завантажуємо фінансові дані", forbidden: "Цей акаунт не має доступу до фінансів.", loadError: "Не вдалося завантажити фінансові дані.", retry: "Спробувати ще раз",
  },
  ru: {
    intl: "ru-RU", months: ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"], shortMonths: ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"],
    finance: "Финансы", currentYear: "Текущий год", compareYears: "Сравнение по годам", viewMode: "Режим финансового обзора", language: "Язык финансового модуля", updated: "обновлено",
    samePeriod: "Все показатели сравниваются с таким же периодом прошлого года", excluded: "Без Coca-Cola и AB InBev", turnover: "Оборот группы", productivity: "Оборот на 1 сотрудника", averageEmployees: "Средняя численность сотрудников", previousYear: "к прошлому году", fullRates: "Полных ставок (FTE)", employees: "Численность сотрудников",
    annualMetrics: "Показатели по годам", sameYearPeriod: "Одинаковый период каждого года", period: "Период", lastMonthShort: "последний месяц", averageShort: "среднее", changeYear: "Изменение к предыдущему году", growthLegend: "Зеленый — рост, оранжевый — снижение",
    indicator: "Показатель", close: "Закрыть", turnoverBreakdown: "Из чего складывается оборот", cocaBreakdown: "Из чего складывается оборот Coca-Cola", productivityBreakdown: "Как рассчитан оборот на сотрудника", averageProductivityBreakdown: "Как рассчитан средний оборот на сотрудника", fteBreakdown: "Количество полных ставок", averageFteBreakdown: "Как рассчитана средняя численность сотрудников",
    turnoverFormula: "Оборот месяца разделен на количество полных ставок в этом месяце.", fteSource: "Значение количества полных ставок взято из исходного файла.", moneyFooter: "Coca-Cola и AB InBev не включены в оборот и его распределение.", cocaFooter: "Оборот Coca-Cola показан отдельно и не включен в четыре основных показателя. AB InBev здесь не учитывается.", fteFooter: "FTE — количество полных ставок. Два сотрудника на полставки равны 1 FTE.", employeeUnit: "сотрудника",
    loading: "Загружаем финансовые данные", forbidden: "У этой учетной записи нет доступа к финансам.", loadError: "Не удалось загрузить финансовые данные.", retry: "Попробовать еще раз",
  },
} as const;

const sum = (values: Array<number | null | undefined>) => values.reduce<number>((total, value) => total + (value ?? 0), 0);
function average(values: Array<number | null>) { const known = values.filter((value): value is number => value !== null); return known.length ? sum(known) / known.length : null; }
function monthNumber(period: string) { return Number(period.slice(5, 7)); }
function titleCase(value: string) { return value.charAt(0).toUpperCase() + value.slice(1); }
function monthCount(value: number, locale: FinanceLocale) {
  const mod10 = value % 10, mod100 = value % 100;
  if (locale === "ru") return `${value} ${mod10 === 1 && mod100 !== 11 ? "месяц" : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? "месяца" : "месяцев"}`;
  return `${value} ${mod10 === 1 && mod100 !== 11 ? "місяць" : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? "місяці" : "місяців"}`;
}
function rangeLabel(period: ComparableTurnover, locale: FinanceLocale) { const copy = COPY[locale]; return `${copy.shortMonths[monthNumber(period.from) - 1]}–${copy.shortMonths[monthNumber(period.to) - 1]} ${period.to.slice(0, 4)}`; }
function fullRangeLabel(period: ComparableTurnover, locale: FinanceLocale) { const copy = COPY[locale]; return `${titleCase(copy.months[monthNumber(period.from) - 1])}–${copy.months[monthNumber(period.to) - 1]} ${period.to.slice(0, 4)}`; }
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
function currentPoints(months: TurnoverMonth[], metric: FinanceMetric, locale: FinanceLocale): FinanceChartPoint[] {
  const copy = COPY[locale];
  return months.map((month, index) => {
    const prefix = months.slice(0, index + 1);
    const value = metric === "turnover" ? month.baseTurnover : metric === "cocaCola" ? month.cocaColaTurnover : metric === "productivity" ? month.turnoverPerFte : metric === "averageProductivity" ? average(prefix.map((item) => item.turnoverPerFte)) : metric === "fte" ? month.fte : average(prefix.map((item) => item.fte));
    return { id: `${metric}:${month.period}`, label: copy.shortMonths[monthNumber(month.period) - 1], value, months: metric === "averageProductivity" || metric === "averageFte" ? prefix : [month] };
  });
}
function comparisonPoints(periods: ComparableTurnover[], metric: FinanceMetric): FinanceChartPoint[] {
  return periods.map((period) => ({ id: `${metric}:${period.id}`, label: period.to.slice(0, 4), value: valueForMetric(period, metric), months: metric === "productivity" || metric === "fte" ? period.monthly.slice(-1) : period.monthly }));
}
function entityDefinitions(locale: FinanceLocale): Array<{ id: EntityId; label: string }> {
  return [
    { id: "specservis", label: "Спецсервіс" }, { id: "promtech", label: "Промтехгруп" }, { id: "refkey", label: "Рефкей" },
    { id: "naryshkov", label: `${locale === "ru" ? "ФЛП" : "ФОП"} Наришков` }, { id: "pashkov", label: `${locale === "ru" ? "ФЛП" : "ФОП"} Пашков` }, { id: "danilenko", label: `${locale === "ru" ? "ФЛП" : "ФОП"} Даниленко` },
  ];
}
function companySlices(months: TurnoverMonth[], metric: "turnover" | "productivity" | "averageProductivity", locale: FinanceLocale): CompanySlice[] {
  const values = entityDefinitions(locale).map((entity) => ({ ...entity, value: metric === "turnover" ? sum(months.map((month) => entityValue(month, entity.id))) : average(months.map((month) => month.fte ? entityValue(month, entity.id) / month.fte : null)) ?? 0 })).filter((item) => item.value > 0);
  const total = sum(values.map((item) => item.value));
  return values.map((item) => ({ ...item, share: total ? item.value / total : 0 })).sort((left, right) => right.value - left.value);
}
function cocaColaSlices(months: TurnoverMonth[]): CompanySlice[] {
  const values = [{ id: "coca-specservis", label: "Спецсервіс", value: sum(months.map((month) => month.cocaColaSpecservis)) }, { id: "coca-promtech", label: "Промтехгруп", value: sum(months.map((month) => month.cocaColaPromtech)) }].filter((item) => item.value > 0);
  const total = sum(values.map((item) => item.value));
  return values.map((item) => ({ ...item, share: total ? item.value / total : 0 })).sort((left, right) => right.value - left.value);
}
function metricTitle(metric: FinanceMetric, locale: FinanceLocale) { const copy = COPY[locale]; if (metric === "turnover") return copy.turnoverBreakdown; if (metric === "cocaCola") return copy.cocaBreakdown; if (metric === "productivity") return copy.productivityBreakdown; if (metric === "averageProductivity") return copy.averageProductivityBreakdown; if (metric === "fte") return copy.fteBreakdown; return copy.averageFteBreakdown; }
function metricExplanation(metric: FinanceMetric, months: TurnoverMonth[], locale: FinanceLocale) {
  const copy = COPY[locale], period = months.length === 1 ? monthLabel(months[0].period, locale) : monthCount(months.length, locale);
  if (metric === "turnover") return locale === "ru" ? `Сумма оборота компаний за ${period}.` : `Сума обороту компаній за ${period}.`;
  if (metric === "cocaCola") return locale === "ru" ? `Сумма оборота Coca-Cola за ${period}.` : `Сума обороту Coca-Cola за ${period}.`;
  if (metric === "productivity") return copy.turnoverFormula;
  if (metric === "averageProductivity") return locale === "ru" ? `Среднее из ${months.length} месячных значений оборота на одного сотрудника.` : `Середнє з ${months.length} місячних значень обороту на одного працівника.`;
  if (metric === "fte") return copy.fteSource;
  return locale === "ru" ? `Среднее из ${months.length} месячных значений количества полных ставок.` : `Середнє з ${months.length} місячних значень кількості повних робочих ставок.`;
}

function DetailModal({ detail, locale, onClose }: { detail: Detail; locale: FinanceLocale; onClose: () => void }) {
  const copy = COPY[locale], { metric, point } = detail;
  const isMoney = metric === "turnover" || metric === "productivity" || metric === "averageProductivity" || metric === "cocaCola";
  const formatter = formatterFor(metric);
  const slices = metric === "cocaCola" ? cocaColaSlices(point.months) : metric === "turnover" || metric === "productivity" || metric === "averageProductivity" ? companySlices(point.months, metric, locale) : [];
  const sourceRows = point.months.map((month) => ({ id: month.period, label: monthLabel(month.period, locale), value: metric === "averageProductivity" ? month.turnoverPerFte : month.fte }));
  const sourceFormatter = metric === "fte" || metric === "averageFte" ? (value: number | null) => value === null ? "—" : oneDecimal.format(value) : formatter;
  const lastMonth = point.months.at(-1) ?? null;
  const footer = metric === "cocaCola" ? copy.cocaFooter : isMoney ? copy.moneyFooter : copy.fteFooter;
  return <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className={styles.detailModal} role="dialog" aria-modal="true" aria-labelledby="detail-title"><header><div><span>{point.label}</span><h2 id="detail-title">{metricTitle(metric, locale)}</h2><p>{metricExplanation(metric, point.months, locale)}</p></div><button type="button" onClick={onClose} aria-label={copy.close}><X size={20} /></button></header><div className={styles.detailValue}><span>{copy.indicator}</span><strong>{formatter(point.value)}</strong></div>{isMoney ? <CompanyPieChart items={slices} total={sum(slices.map((item) => item.value))} locale={locale} format={formatter} /> : <SourceBars rows={sourceRows} format={sourceFormatter} selectedId={point.months.length === 1 ? point.months[0].period : undefined} />}{metric === "productivity" && lastMonth ? <div className={styles.formula}><span>{money(lastMonth.baseTurnover)}</span><i>÷</i><span>{oneDecimal.format(lastMonth.fte ?? 0)} {copy.employeeUnit}</span><i>=</i><b>{money(lastMonth.turnoverPerFte)}</b></div> : null}<footer>{footer}</footer></section></div>;
}

function FinanceContent({ dataset, locale, onLocaleChange }: { dataset: ConfidentialTurnoverDataset; locale: FinanceLocale; onLocaleChange: (locale: FinanceLocale) => void }) {
  const [mode, setMode] = useState<ViewMode>("current"), [detail, setDetail] = useState<Detail | null>(null);
  const copy = COPY[locale], model = useMemo(() => buildConfidentialDashboard(dataset.records, "ytd"), [dataset.records]), periods = model.history.slice(-4), current = periods.at(-1)!, previous = periods.at(-2) ?? null, latest = current.monthly.at(-1)!, latestYear = latest.period.slice(0, 4), periodMonths = current.monthly.length;
  const pointSet = (metric: FinanceMetric) => mode === "current" ? currentPoints(current.monthly, metric, locale) : comparisonPoints(periods, metric);
  const open = (metric: FinanceMetric) => (point: FinanceChartPoint) => setDetail({ metric, point });
  const kpis: Array<{ metric: FinanceMetric; label: string; value: number | null; note: string | null; delta: number | null }> = [
    { metric: "turnover", label: copy.turnover, value: current.baseTurnover, note: `${locale === "ru" ? "За" : "За"} ${monthCount(periodMonths, locale)}`, delta: growth(current.baseTurnover, previous?.baseTurnover ?? null) },
    { metric: "productivity", label: `${copy.productivity} · ${copy.months[monthNumber(latest.period) - 1]}`, value: current.lastTurnoverPerFte, note: null, delta: growth(current.lastTurnoverPerFte, previous?.lastTurnoverPerFte ?? null) },
    { metric: "averageProductivity", label: `${copy.productivity} за ${latestYear} ${locale === "ru" ? "год" : "рік"} (${periodMonths} ${locale === "ru" ? "мес." : "міс."})`, value: current.turnoverPerFte, note: `${locale === "ru" ? "Среднее" : "Середнє"} за ${monthCount(periodMonths, locale)}`, delta: growth(current.turnoverPerFte, previous?.turnoverPerFte ?? null) },
    { metric: "averageFte", label: copy.averageEmployees, value: current.avgFte, note: copy.fullRates, delta: growth(current.avgFte, previous?.avgFte ?? null) },
  ];
  useEffect(() => { if (!detail) return; const close = (event: KeyboardEvent) => { if (event.key === "Escape") setDetail(null); }; document.documentElement.style.overflow = "hidden"; window.addEventListener("keydown", close); return () => { document.documentElement.style.overflow = ""; window.removeEventListener("keydown", close); }; }, [detail]);

  const chartProps = { locale };
  return <div className={`owner-stack ${styles.financeApp}`} lang={locale === "ru" ? "ru" : "uk"}>
    <section className={styles.stickyToolbar} aria-label={copy.viewMode}><div><CalendarRange size={18} /><span><b>{copy.finance}</b><small>{locale === "ru" ? "Данные по" : "Дані по"} {monthLabel(latest.period, locale)} · {copy.updated} {new Intl.DateTimeFormat(copy.intl, { day: "2-digit", month: "long", year: "numeric", timeZone: "Europe/Kyiv" }).format(new Date(dataset.source.modifiedAt))}</small></span></div><div className={styles.toolbarActions}><div className={styles.modeSwitch}><button type="button" className={mode === "current" ? styles.activeMode : ""} aria-pressed={mode === "current"} onClick={() => setMode("current")}>{copy.currentYear}</button><button type="button" className={mode === "compare" ? styles.activeMode : ""} aria-pressed={mode === "compare"} onClick={() => setMode("compare")}>{copy.compareYears}</button></div><div className={styles.languageSwitch} aria-label={copy.language}><button type="button" className={locale === "uk" ? styles.activeLanguage : ""} aria-pressed={locale === "uk"} onClick={() => onLocaleChange("uk")}>UA</button><button type="button" className={locale === "ru" ? styles.activeLanguage : ""} aria-pressed={locale === "ru"} onClick={() => onLocaleChange("ru")}>RU</button></div></div></section>
    <section className={styles.summaryCard}><header><div><h1>{fullRangeLabel(current, locale)}</h1><p>{copy.samePeriod}</p></div><span>{monthCount(periodMonths, locale)}<small>{copy.excluded}</small></span></header><div className={styles.kpiGrid}>{kpis.map((kpi) => <button type="button" key={kpi.metric} className={kpi.metric === "turnover" ? styles.primaryKpi : ""} onClick={() => setDetail({ metric: kpi.metric, point: { id: `kpi:${kpi.metric}`, label: fullRangeLabel(current, locale), value: kpi.value, months: kpi.metric === "productivity" ? [latest] : current.monthly } })}><span>{kpi.label}</span><strong>{formatterFor(kpi.metric)(kpi.value)}</strong><div><b className={kpi.delta === null ? styles.neutral : kpi.delta >= 0 ? styles.positive : styles.negative}>{percent(kpi.delta, true)}</b><small>{copy.previousYear}</small></div>{kpi.note ? <p>{kpi.note}</p> : null}</button>)}</div></section>
    <section className={styles.sectionHeading}><h2>{mode === "current" ? locale === "ru" ? `Динамика ${latestYear} года` : `Динаміка ${latestYear} року` : locale === "ru" ? `Сравнение за ${monthCount(periodMonths, locale)}` : `Порівняння за ${monthCount(periodMonths, locale)}`}</h2></section>
    <InteractiveMetricChart {...chartProps} title={copy.turnover} points={pointSet("turnover")} variant="bar" format={money} onSelect={open("turnover")} />
    <section className={styles.twoCharts}><InteractiveMetricChart {...chartProps} title={copy.productivity} points={pointSet("productivity")} variant="line" format={money} onSelect={open("productivity")} /><InteractiveMetricChart {...chartProps} title={`${locale === "ru" ? "Среднее" : "Середнє"} за ${monthCount(periodMonths, locale)}`} points={pointSet("averageProductivity")} variant="line" tone="green" format={money} onSelect={open("averageProductivity")} /></section>
    <section className={styles.twoCharts}><InteractiveMetricChart {...chartProps} title={copy.employees} points={pointSet("fte")} variant="bar" tone="orange" format={formatterFor("fte")} onSelect={open("fte")} /><InteractiveMetricChart {...chartProps} title={`${locale === "ru" ? "Среднее количество" : "Середня кількість"} за ${monthCount(periodMonths, locale)}`} points={pointSet("averageFte")} variant="line" tone="orange" format={formatterFor("averageFte")} onSelect={open("averageFte")} /></section>
    <section className={styles.tablesSection}><article><header><h2>{copy.annualMetrics}</h2><p>{copy.sameYearPeriod}</p></header><div className={styles.tableWrap}><table><thead><tr><th>{copy.period}</th><th>{copy.turnover}</th><th>{copy.productivity}<br /><small>{copy.lastMonthShort}</small></th><th>{copy.productivity}<br /><small>{copy.averageShort}</small></th><th>{copy.averageEmployees}</th></tr></thead><tbody>{periods.map((period) => <tr key={period.id}><th>{rangeLabel(period, locale)}</th>{(["turnover", "productivity", "averageProductivity", "averageFte"] as FinanceMetric[]).map((metric) => <td key={metric}><button type="button" onClick={() => setDetail({ metric, point: comparisonPoints([period], metric)[0] })}>{formatterFor(metric)(valueForMetric(period, metric))}</button></td>)}</tr>)}</tbody></table></div></article><article><header><h2>{copy.changeYear}</h2><p>{copy.growthLegend}</p></header><div className={styles.tableWrap}><table><thead><tr><th>{copy.period}</th><th>{copy.turnover}</th><th>{copy.productivity}<br /><small>{copy.lastMonthShort}</small></th><th>{copy.productivity}<br /><small>{copy.averageShort}</small></th><th>{copy.averageEmployees}</th></tr></thead><tbody>{periods.map((period, index) => { const prior = periods[index - 1]; return <tr key={period.id}><th>{rangeLabel(period, locale)}</th>{(["turnover", "productivity", "averageProductivity", "averageFte"] as FinanceMetric[]).map((metric) => { const delta = prior ? growth(valueForMetric(period, metric), valueForMetric(prior, metric)) : null; return <td key={metric}><button type="button" className={delta === null ? styles.neutral : delta >= 0 ? styles.positive : styles.negative} onClick={() => setDetail({ metric, point: comparisonPoints([period], metric)[0] })}>{prior ? percent(delta, true) : "—"}</button></td>; })}</tr>; })}</tbody></table></div></article></section>
    <InteractiveMetricChart {...chartProps} title="Coca-Cola" points={pointSet("cocaCola")} variant="bar" tone="red" format={money} onSelect={open("cocaCola")} />
    {detail && typeof document !== "undefined" ? createPortal(<DetailModal detail={detail} locale={locale} onClose={() => setDetail(null)} />, document.body) : null}
  </div>;
}

export function FinanceDashboard({ dataset: initialDataset, locale: controlledLocale, onLocaleChange }: { dataset?: ConfidentialTurnoverDataset; locale?: FinanceLocale; onLocaleChange?: (locale: FinanceLocale) => void }) {
  const [dataset, setDataset] = useState(initialDataset ?? null), [error, setError] = useState(""), [loading, setLoading] = useState(!initialDataset), [internalLocale, setInternalLocale] = useState<FinanceLocale>("uk");
  const locale = controlledLocale ?? internalLocale, copy = COPY[locale], changeLocale = onLocaleChange ?? setInternalLocale;
  const load = useCallback(async (signal?: AbortSignal) => { setLoading(true); try { const response = await fetch("/api/confidential/turnover", { cache: "no-store", signal }); if (response.status === 401) { window.location.assign("/login"); return; } if (!response.ok) throw new Error(response.status === 403 ? copy.forbidden : copy.loadError); setDataset(await response.json() as ConfidentialTurnoverDataset); setError(""); } catch (cause) { if (cause instanceof DOMException && cause.name === "AbortError") return; setError(cause instanceof Error ? cause.message : copy.loadError); } finally { if (!signal?.aborted) setLoading(false); } }, [copy.forbidden, copy.loadError]);
  useEffect(() => { if (initialDataset) return; const controller = new AbortController(); fetch("/api/confidential/turnover", { cache: "no-store", signal: controller.signal }).then((response) => { if (response.status === 401) { window.location.assign("/login"); throw new Error("Unauthorized"); } if (!response.ok) throw new Error(response.status === 403 ? copy.forbidden : copy.loadError); return response.json() as Promise<ConfidentialTurnoverDataset>; }).then((payload) => { setDataset(payload); setError(""); }).catch((cause: unknown) => { if (cause instanceof DOMException && cause.name === "AbortError") return; if (cause instanceof Error && cause.message !== "Unauthorized") setError(cause.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); }); return () => controller.abort(); }, [initialDataset, copy.forbidden, copy.loadError]);
  if (!dataset) return <div className={styles.financeState}>{loading ? <LoaderCircle className="spin" size={27} /> : <CircleAlert size={27} />}<h2>{loading ? copy.loading : error}</h2>{!loading ? <button type="button" onClick={() => void load()}><RefreshCw size={16} />{copy.retry}</button> : null}</div>;
  return <FinanceContent dataset={dataset} locale={locale} onLocaleChange={changeLocale} />;
}

export function ConfidentialDashboard({ dataset }: { dataset: ConfidentialTurnoverDataset }) { return <FinanceDashboard dataset={dataset} />; }
