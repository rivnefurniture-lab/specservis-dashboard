"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarRange, ChevronDown, CircleAlert, Filter, LoaderCircle, LockKeyhole, RefreshCw, X } from "lucide-react";
import {
  buildConfidentialDashboard,
  type ComparableTurnover,
  type ConfidentialDashboardModel,
  type EntityMix,
  type TurnoverMonth,
} from "@/lib/confidential-dashboard";
import type { ConfidentialTurnoverDataset } from "@/lib/confidential-turnover";
import styles from "./confidential-dashboard.module.css";

const ukMonth = new Intl.DateTimeFormat("uk-UA", { month: "short", year: "2-digit", timeZone: "UTC" });
const ukDate = new Intl.DateTimeFormat("uk-UA", { day: "2-digit", month: "long", year: "numeric", timeZone: "Europe/Kyiv" });
const preciseMoney = new Intl.NumberFormat("uk-UA", { style: "currency", currency: "UAH", currencyDisplay: "narrowSymbol", maximumFractionDigits: 0 });
const number = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 1 });

type SignalTone = "good" | "risk" | "watch" | "neutral";
type OwnerSignal = { id: string; title: string; value: string; detail: string; action: string; tone: SignalTone; priority: number };
type EntityId = "all" | "specservis" | "promtech" | "refkey" | "naryshkov" | "pashkov" | "danilenko";
type AuditFilter = "all" | "missing-payroll" | "payroll-pressure" | "decline";
type AuditSort = "newest" | "turnover-desc" | "growth-asc" | "productivity-desc" | "payroll-share-desc";

const entityOptions: Array<{ id: EntityId; label: string }> = [
  { id: "all", label: "Уся група" },
  { id: "specservis", label: "Спецсервіс" },
  { id: "promtech", label: "Промтехгруп · база" },
  { id: "refkey", label: "Рефкей" },
  { id: "naryshkov", label: "ФОП Наришков" },
  { id: "pashkov", label: "ФОП Пашков" },
  { id: "danilenko", label: "ФОП Даниленко" },
];

function money(value: number | null) {
  if (value === null) return "—";
  const absolute = Math.abs(value);
  const unit = absolute >= 1_000_000_000 ? [1_000_000_000, "млрд"] as const : absolute >= 1_000_000 ? [1_000_000, "млн"] as const : absolute >= 1_000 ? [1_000, "тис."] as const : [1, ""] as const;
  const formatted = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: unit[0] === 1 ? 0 : 1 }).format(value / unit[0]);
  return `₴${formatted}${unit[1] ? ` ${unit[1]}` : ""}`;
}

function percent(value: number | null, signed = false) {
  if (value === null) return "—";
  return new Intl.NumberFormat("uk-UA", { style: "percent", maximumFractionDigits: 1, signDisplay: signed ? "always" : "auto" }).format(value);
}

function points(value: number | null) {
  return value === null ? "—" : `${new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 1, signDisplay: "always" }).format(value * 100)} п.п.`;
}

function monthLabel(period: string | null) {
  return period ? ukMonth.format(new Date(`${period}-01T00:00:00Z`)).replace(" р.", "") : "—";
}

function deltaTone(value: number | null) {
  return value === null ? styles.muted : value >= 0 ? styles.positive : styles.negative;
}

function entityValue(month: TurnoverMonth, entity: EntityId) {
  if (entity === "all") return month.baseTurnover ?? 0;
  if (entity === "specservis") return (month.specservisBank ?? 0) + (month.specservisCash ?? 0);
  if (entity === "promtech") return month.promtechCore ?? 0;
  if (entity === "refkey") return (month.refkeyBank ?? 0) + (month.refkeyCash ?? 0);
  if (entity === "naryshkov") return month.fopNaryshkov ?? 0;
  if (entity === "pashkov") return month.fopPashkov ?? 0;
  return month.fopDanilenko ?? 0;
}

function aggregateEntity(months: TurnoverMonth[], entity: EntityId) {
  return months.reduce((total, month) => total + entityValue(month, entity), 0);
}

function growth(current: number | null, previous: number | null) {
  return current === null || previous === null || previous === 0 ? null : current / previous - 1;
}

function HistoryMetricChart({ title, note, history, value, format, kind = "line" }: {
  title: string;
  note: string;
  history: ComparableTurnover[];
  value: (period: ComparableTurnover) => number | null;
  format: (value: number | null) => string;
  kind?: "bar" | "line";
}) {
  const periods = history.slice(-4);
  const values = periods.map(value);
  const known = values.filter((item): item is number => item !== null);
  const maximum = Math.max(...known, 1);
  const latest = values.at(-1) ?? null;
  const previous = values.at(-2) ?? null;
  const width = 440;
  const height = 180;
  const left = 22;
  const right = 418;
  const top = 28;
  const bottom = 140;
  const span = periods.length > 1 ? (right - left) / (periods.length - 1) : 0;
  const point = (item: number, index: number) => ({ x: left + span * index, y: bottom - item / maximum * (bottom - top) });
  const linePath = values.reduce((state, item, index) => item === null ? state : `${state}${state ? " L" : "M"}${point(item, index).x},${point(item, index).y}`, "");

  return <article className={styles.historyCard}>
    <header><div><span>{title}</span><small>{note}</small></div><div><strong>{format(latest)}</strong><b className={deltaTone(growth(latest, previous))}>{percent(growth(latest, previous), true)} р/р</b></div></header>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${title}: порівняння за однаковий період`}>
      {[0, .5, 1].map((part) => <line key={part} x1={left} x2={right} y1={bottom - (bottom - top) * part} y2={bottom - (bottom - top) * part} className={styles.gridLine} />)}
      {kind === "line" && linePath ? <path d={linePath} className={styles.historyLine} /> : null}
      {periods.map((period, index) => {
        const item = values[index];
        if (item === null) return null;
        const location = point(item, index);
        const barWidth = Math.min(54, (right - left) / Math.max(periods.length, 1) * .5);
        return <g key={period.id} role="group" aria-label={`${period.label}: ${format(item)}`}>
          {kind === "bar" ? <rect x={location.x - barWidth / 2} y={location.y} width={barWidth} height={bottom - location.y} rx="7" className={index === periods.length - 1 ? styles.historyBarCurrent : styles.historyBar} /> : <circle cx={location.x} cy={location.y} r={index === periods.length - 1 ? 6 : 4.5} className={index === periods.length - 1 ? styles.historyPointCurrent : styles.historyPoint} />}
          <text x={location.x} y={Math.max(13, location.y - 10)} textAnchor="middle" className={styles.historyValue}>{format(item)}</text>
          <text x={location.x} y="164" textAnchor="middle" className={styles.historyYear}>{period.label}</text>
        </g>;
      })}
    </svg>
  </article>;
}

function TurnoverChart({ current, comparison, entity }: { current: TurnoverMonth[]; comparison: TurnoverMonth[]; entity: EntityId }) {
  const width = 960;
  const height = 270;
  const top = 18;
  const bottom = 224;
  const plotHeight = bottom - top;
  const currentValues = current.map((month) => entityValue(month, entity));
  const comparisonValues = comparison.map((month) => entityValue(month, entity));
  const maximum = Math.max(...currentValues, ...comparisonValues, 1);
  const span = width / Math.max(current.length, 1);
  const barWidth = Math.max(2, Math.min(38, span * .48));
  const labelStep = Math.max(1, Math.ceil(current.length / 10));
  return <svg className={styles.turnoverChart} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Місячний оборот у порівнянні з тим самим періодом торік">
    {[0, .25, .5, .75, 1].map((part) => { const y = bottom - plotHeight * part; return <g key={part}><line x1="0" x2={width} y1={y} y2={y} className={styles.gridLine} /><text x="4" y={y - 5} className={styles.axisText}>{money(maximum * part)}</text></g>; })}
    {current.map((month, index) => { const x = index * span + span / 2; const currentValue = currentValues[index] ?? 0; const priorValue = comparisonValues[index] ?? 0; const currentHeight = Math.max(0, currentValue / maximum * plotHeight); const priorHeight = Math.max(0, priorValue / maximum * plotHeight); return <g key={month.period} role="group" aria-label={`${monthLabel(month.period)}: ${preciseMoney.format(currentValue)}`}>{comparison[index] ? <rect x={x - barWidth * .78} y={bottom - priorHeight} width={barWidth * 1.56} height={priorHeight} rx="5" className={styles.priorBar} /> : null}<rect x={x - barWidth / 2} y={bottom - currentHeight} width={barWidth} height={currentHeight} rx="4" className={styles.baseBar} />{index % labelStep === 0 || index === current.length - 1 ? <text x={x} y="252" textAnchor="middle" className={styles.monthText}>{monthLabel(month.period)}</text> : null}</g>; })}
  </svg>;
}

function MiniLine({ current, comparison, label, formatter }: { current: Array<number | null>; comparison: Array<number | null>; label: string; formatter: (value: number | null) => string }) {
  const width = 520;
  const height = 138;
  const all = [...current, ...comparison].filter((item): item is number => item !== null);
  const maximum = Math.max(...all, 1);
  const minimum = Math.min(...all, 0);
  const range = maximum - minimum || 1;
  const path = (values: Array<number | null>) => values.reduce((state, item, index) => { if (item === null) return state; const x = 12 + index * (496 / Math.max(values.length - 1, 1)); const y = 112 - (item - minimum) / range * 88; return `${state}${state ? " L" : "M"}${x},${y}`; }, "");
  const latest = current.at(-1) ?? null;
  return <div className={styles.miniLineBlock}><header><span>{label}</span><strong>{formatter(latest)}</strong></header><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${label}: поточний і попередній рік`}><line x1="12" x2="508" y1="112" y2="112" className={styles.gridLine} />{comparison.some((item) => item !== null) ? <path d={path(comparison)} className={styles.priorLine} /> : null}<path d={path(current)} className={styles.currentLine} />{current.map((item, index) => item === null ? null : <circle key={index} cx={12 + index * (496 / Math.max(current.length - 1, 1))} cy={112 - (item - minimum) / range * 88} r="4" className={styles.currentPoint} />)}</svg></div>;
}

function CompanyChangeChart({ current, previous }: { current: EntityMix[]; previous: EntityMix[] }) {
  const currentMap = new Map(current.filter((item) => item.id !== "reconciliation").map((item) => [item.id, item]));
  const previousMap = new Map(previous.filter((item) => item.id !== "reconciliation").map((item) => [item.id, item]));
  const ids = [...new Set([...currentMap.keys(), ...previousMap.keys()])];
  const rows = ids.map((id) => { const currentItem = currentMap.get(id); const previousItem = previousMap.get(id); return { id, label: currentItem?.label ?? previousItem?.label ?? id, current: currentItem?.value ?? 0, previous: previousItem?.value ?? 0 }; }).sort((left, right) => Math.abs(right.current - right.previous) - Math.abs(left.current - left.previous));
  const maximum = Math.max(...rows.flatMap((row) => [row.current, row.previous]), 1);
  return <div className={styles.dumbbellChart}>{rows.map((row) => { const currentPosition = Math.max(0, row.current / maximum * 100); const previousPosition = Math.max(0, row.previous / maximum * 100); const left = Math.min(currentPosition, previousPosition); const width = Math.abs(currentPosition - previousPosition); const delta = growth(row.current, row.previous); return <div className={styles.dumbbellRow} key={row.id}><span>{row.label}</span><div className={styles.dumbbellTrack} aria-label={`${row.label}: було ${money(row.previous)}, стало ${money(row.current)}`}><i style={{ left: `${left}%`, width: `${width}%` }} /><b className={styles.dumbbellPrevious} style={{ left: `${previousPosition}%` }} /><b className={styles.dumbbellCurrent} style={{ left: `${currentPosition}%` }} /></div><strong>{money(row.current)} <em className={deltaTone(delta)}>{percent(delta, true)}</em></strong></div>; })}</div>;
}

function buildSignals(model: ConfidentialDashboardModel, missingPayroll: number): OwnerSignal[] {
  const turnoverGrowth = model.growth.baseTurnover, productivityGrowth = model.growth.turnoverPerFte, payroll = model.payrollEconomics, top = model.structure.topEntity;
  return [
    ...(missingPayroll ? [{ id: "quality", title: "Неповний ФОП", value: `${missingPayroll} міс.`, detail: "Частина місяців не має фонду оплати праці, тому підсумок витрат занижений.", action: "Дозаповнити джерело до рішення про витрати на персонал.", tone: "risk" as const, priority: 0 }] : []),
    { id: "payroll", title: payroll?.payrollGrowthGap !== null && payroll?.payrollGrowthGap !== undefined && payroll.payrollGrowthGap > .03 ? "ФОП випереджає оборот" : "ФОП контрольований", value: points(payroll?.payrollGrowthGap ?? null), detail: payroll ? `На ${payroll.months} зіставних місяцях: ФОП ${percent(payroll.payrollGrowth, true)}, оборот ${percent(payroll.baseGrowth, true)}.` : "Немає повної бази.", action: payroll?.payrollGrowthGap && payroll.payrollGrowthGap > .03 ? "Перевірити найм, премії та завантаження команди." : "Утримувати темп ФОП не вище темпу обороту.", tone: payroll?.payrollGrowthGap === null || payroll?.payrollGrowthGap === undefined ? "neutral" as const : payroll.payrollGrowthGap > .03 ? "risk" as const : "good" as const, priority: payroll?.payrollGrowthGap && payroll.payrollGrowthGap > .03 ? 1 : 4 },
    { id: "concentration", title: top && top.share > .65 ? "Залежність від одного джерела" : "Структура диверсифікована", value: top ? percent(top.share) : "—", detail: top ? `${top.label} — найбільше джерело. Топ-3 формують ${percent(model.structure.topThreeShare)}.` : "Недостатньо даних.", action: top && top.share > .65 ? "Перевірити резерв заміщення цього потоку." : "Контролювати частку топ-3 щомісяця.", tone: top && top.share > .65 ? "watch" as const : "good" as const, priority: top && top.share > .65 ? 2 : 5 },
    { id: "productivity", title: productivityGrowth !== null && productivityGrowth >= 0 ? "Масштабування дає результат" : "Продуктивність знижується", value: percent(productivityGrowth, true), detail: `Середня команда: ${number.format(model.summary.avgFte ?? 0)} FTE, зміна ${percent(model.growth.avgFte, true)} р/р.`, action: productivityGrowth !== null && productivityGrowth < 0 ? "Знайти місяці, де FTE росте без відповідного обороту." : "Зберегти продуктивність при подальшому наймі.", tone: productivityGrowth === null ? "neutral" as const : productivityGrowth >= 0 ? "good" as const : "risk" as const, priority: productivityGrowth !== null && productivityGrowth < 0 ? 1 : 5 },
    { id: "turnover", title: turnoverGrowth !== null && turnoverGrowth >= 0 ? "Оборот зростає" : "Оборот скорочується", value: percent(turnoverGrowth, true), detail: `Операційний оборот за ${model.range.label}: ${money(model.summary.baseTurnover)}.`, action: turnoverGrowth !== null && turnoverGrowth < 0 ? "Розкласти падіння за компаніями та місяцями." : "Перевірити, які компанії дали основну частину приросту.", tone: turnoverGrowth === null ? "neutral" as const : turnoverGrowth >= 0 ? "good" as const : "risk" as const, priority: turnoverGrowth !== null && turnoverGrowth < 0 ? 1 : 6 },
  ].sort((left, right) => left.priority - right.priority);
}

function FinanceContent({ dataset }: { dataset: ConfidentialTurnoverDataset }) {
  const [rangeId, setRangeId] = useState("ytd"), [entity, setEntity] = useState<EntityId>("all"), [auditFilter, setAuditFilter] = useState<AuditFilter>("all"), [auditSort, setAuditSort] = useState<AuditSort>("newest");
  const model = useMemo(() => buildConfidentialDashboard(dataset.records, rangeId), [dataset.records, rangeId]);
  const summary = model.summary, latest = model.months.at(-1) ?? null, missingPayroll = summary.months - summary.payrollMonths;
  const signals = useMemo(() => buildSignals(model, missingPayroll), [model, missingPayroll]);
  const mixMaximum = Math.max(...model.entityMix.map((item) => Math.abs(item.value)), 1);
  const selectedEntity = entityOptions.find((option) => option.id === entity) ?? entityOptions[0];
  const selectedTotal = aggregateEntity(model.months, entity), priorTotal = model.comparisonMonths.length === model.months.length ? aggregateEntity(model.comparisonMonths, entity) : null, selectedGrowth = growth(selectedTotal, priorTotal);
  const quickOptions = model.options.filter((option) => option.id === "ytd" || option.id === "12m"), archiveOptions = model.options.filter((option) => option.id !== "ytd" && option.id !== "12m");
  const priorByCurrentPeriod = new Map(model.comparisonMonths.map((month) => [`${Number(month.period.slice(0, 4)) + 1}${month.period.slice(4)}`, month]));
  const auditedMonths = [...model.months].filter((month) => auditFilter === "all" || (auditFilter === "missing-payroll" && month.payroll === null) || (auditFilter === "payroll-pressure" && (month.payrollShare ?? 0) >= .35) || (auditFilter === "decline" && (growth(month.baseTurnover ?? 0, priorByCurrentPeriod.get(month.period)?.baseTurnover ?? null) ?? 0) < 0)).sort((left, right) => auditSort === "turnover-desc" ? (right.baseTurnover ?? 0) - (left.baseTurnover ?? 0) : auditSort === "growth-asc" ? (growth(left.baseTurnover ?? 0, priorByCurrentPeriod.get(left.period)?.baseTurnover ?? null) ?? Number.MAX_SAFE_INTEGER) - (growth(right.baseTurnover ?? 0, priorByCurrentPeriod.get(right.period)?.baseTurnover ?? null) ?? Number.MAX_SAFE_INTEGER) : auditSort === "productivity-desc" ? (right.turnoverPerFte ?? -1) - (left.turnoverPerFte ?? -1) : auditSort === "payroll-share-desc" ? (right.payrollShare ?? -1) - (left.payrollShare ?? -1) : right.period.localeCompare(left.period));

  return <div className={`owner-stack ${styles.financeApp}`}>
    <section className={styles.controlBar} aria-label="Вибір періоду фінансового дашборда"><div className={styles.controlTitle}><CalendarRange size={18} /><div><b>Який період дивимось</b><span>Порівняння завжди за ті самі місяці попереднього року</span></div></div><div className={styles.periodControls}>{quickOptions.map((option) => <button type="button" key={option.id} aria-pressed={rangeId === option.id} className={rangeId === option.id ? styles.activePeriod : ""} onClick={() => setRangeId(option.id)}>{option.id === "ytd" ? "Поточний рік" : "12 місяців"}<small>{option.id === "ytd" ? option.label : `${monthLabel(option.from)} — ${monthLabel(option.to)}`}</small></button>)}<label><span>Інший рік</span><select aria-label="Інший календарний період" value={quickOptions.some((option) => option.id === rangeId) ? "" : rangeId} onChange={(event) => event.target.value && setRangeId(event.target.value)}><option value="" disabled>Оберіть</option>{archiveOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select><ChevronDown size={14} /></label></div><div className={styles.periodStatus}><b>{model.range.label}</b><span>{summary.months} міс. · до {monthLabel(model.range.to)}</span></div></section>

    <section className={`owner-page-head ${styles.directorHead}`}><div><span>ФОКУС ДИРЕКТОРА · ОБОРОТ ГРУПИ</span><h1>{money(summary.baseTurnover)}</h1><p>{model.range.label}. Без Coca-Cola та AB InBev — як у підсумковій таблиці джерела. До зіставного періоду: {percent(model.growth.baseTurnover, true)}.</p></div><div className={`owner-head-sync ${missingPayroll ? "snapshot" : ""}`}><i /><span><b>{missingPayroll ? "Є неповні дані ФОП" : "Дані повні"}</b><small>Джерело оновлено {ukDate.format(new Date(dataset.source.modifiedAt))}</small></span></div></section>
    {missingPayroll ? <div className={styles.sourceAlert}><CircleAlert size={17} /><div><b>Не робіть висновок про повний ФОП за весь період</b><span>Заповнено {summary.payrollMonths} із {summary.months} місяців. Річне зіставлення використовує лише однаково заповнені місяці.</span></div></div> : null}

    <section className={styles.historySection}><header className={styles.sectionHead}><div><span>ОДНАКОВИЙ ПЕРІОД · РІК ДО РОКУ</span><h2>Чотири показники з підсумку Excel — тепер у динаміці</h2><p>Кожна точка охоплює ті самі {summary.months} місяців. Тому роки можна порівнювати без викривлення.</p></div><b>{model.history.slice(-4).map((period) => period.label).join(" · ")}</b></header><div className={styles.historyGrid}><HistoryMetricChart title="Оборот групи" note="Накопичено за період" history={model.history} value={(period) => period.baseTurnover} format={money} kind="bar" /><HistoryMetricChart title="Продуктивність останнього місяця" note="Оборот останнього місяця / FTE" history={model.history} value={(period) => period.lastTurnoverPerFte} format={money} /><HistoryMetricChart title="Середня продуктивність" note="Середнє місячних значень / FTE" history={model.history} value={(period) => period.turnoverPerFte} format={money} /><HistoryMetricChart title="Середня команда" note="Середня чисельність за період" history={model.history} value={(period) => period.avgFte} format={(value) => value === null ? "—" : `${number.format(value)} FTE`} /></div><div className={`${styles.tableWrap} ${styles.historyTable}`}><table><thead><tr><th>Однаковий період</th><th>Оборот групи</th><th>На 1 FTE · останній місяць</th><th>На 1 FTE · середнє</th><th>Середня команда</th></tr></thead><tbody>{model.history.slice(-4).map((period) => <tr key={period.id}><td><b>{period.label}</b><span>{monthLabel(period.from)} — {monthLabel(period.to)}</span></td><td>{preciseMoney.format(period.baseTurnover)}</td><td>{period.lastTurnoverPerFte === null ? "—" : preciseMoney.format(period.lastTurnoverPerFte)}</td><td>{period.turnoverPerFte === null ? "—" : preciseMoney.format(period.turnoverPerFte)}</td><td>{period.avgFte === null ? "—" : `${number.format(period.avgFte)} FTE`}</td></tr>)}</tbody></table></div></section>

    <section className={styles.executiveCharts}><article className={`role-panel ${styles.compositionPanel}`}><header><div><span>ХТО СФОРМУВАВ ОБОРОТ</span><h2>Внесок компаній у результат</h2></div><b>{percent(model.structure.topThreeShare)} · топ-3</b></header><div className={styles.mixList}>{model.entityMix.map((item) => { const selectable = entityOptions.some((option) => option.id === item.id); return <button type="button" key={item.id} disabled={!selectable} aria-pressed={entity === item.id} className={entity === item.id ? styles.activeMix : ""} onClick={() => selectable && setEntity(item.id as EntityId)}><div><span>{item.label}</span><b>{percent(item.share)}</b></div><i><em style={{ width: `${Math.max(1, Math.abs(item.value) / mixMaximum * 100)}%` }} /></i><strong>{money(item.value)}</strong></button>; })}</div><footer className={styles.panelFoot}>Натисніть компанію — праворуч одразу зміниться її помісячна динаміка.</footer></article><article className={`role-panel ${styles.chartPanel}`}><header><div><span>ЯК ЗМІНЮВАВСЯ ОБОРОТ</span><h2>{selectedEntity.label} · помісячно</h2></div><b>{money(selectedTotal)}</b></header><div className={styles.chartSubhead}><span>Оборот за місяць</span><b className={deltaTone(selectedGrowth)}>{percent(selectedGrowth, true)} р/р</b>{entity !== "all" ? <button type="button" onClick={() => setEntity("all")}><X size={12} />Повернути всю групу</button> : null}</div><div className={styles.legend}><span><i className={styles.currentLegend} />Поточний період</span><span><i className={styles.priorLegend} />Ті самі місяці торік</span></div><TurnoverChart current={model.months} comparison={model.comparisonMonths} entity={entity} /></article></section>

    <section className={styles.driverGrid}><article className={`role-panel ${styles.companyChangePanel}`}><header><div><span>ЧОМУ ЗМІНИВСЯ ОБОРОТ</span><h2>Які компанії дали приріст або падіння</h2></div><div className={styles.dumbbellLegend}><span><i />торік</span><span><i />зараз</span></div></header>{model.comparisonEntityMix.length ? <CompanyChangeChart current={model.entityMix} previous={model.comparisonEntityMix} /> : <p className={styles.emptyChart}>Немає повного зіставного періоду.</p>}</article><article className="role-panel"><header><div><span>ЛЮДИ ТА ПРОДУКТИВНІСТЬ</span><h2>Чи встигає результат за командою</h2></div><b>{summary.lastFte === null ? "—" : `${number.format(summary.lastFte)} FTE`}</b></header><div className={styles.teamTrend}><MiniLine current={model.months.map((month) => month.turnoverPerFte)} comparison={model.comparisonMonths.map((month) => month.turnoverPerFte)} label="Оборот на 1 FTE / місяць" formatter={money} /><MiniLine current={model.months.map((month) => month.fte)} comparison={model.comparisonMonths.map((month) => month.fte)} label="Чисельність команди" formatter={(value) => value === null ? "—" : `${number.format(value)} FTE`} /></div><div className={styles.legend}><span><i className={styles.currentLegend} />Поточний період</span><span><i className={styles.priorLineLegend} />Торік</span></div></article></section>

    <section className={styles.managementGrid}><article className="role-panel"><header><div><span>ЕКОНОМІКА КОМАНДИ</span><h2>ФОП у контексті обороту</h2></div><b>{summary.payrollMonths} міс. із даними</b></header><div className={styles.economicsRows}><div><span>ФОП на 1 FTE / місяць</span><strong>{money(summary.payrollPerFte)}</strong><em>за місяці з відомим ФОП</em></div><div><span>ФОП до обороту групи</span><strong>{percent(summary.payrollShare)}</strong><em>{summary.payrollShare ? `${number.format(1 / summary.payrollShare)}× обороту на ₴1 ФОП` : "—"}</em></div><div><span>ФОП проти темпу обороту</span><strong className={deltaTone(model.payrollEconomics?.payrollGrowthGap ?? null)}>{points(model.payrollEconomics?.payrollGrowthGap ?? null)}</strong><em>додатне значення = ФОП росте швидше</em></div></div></article><details className={styles.secondaryDetails}><summary><div><span>ОКРЕМИЙ ЗРІЗ</span><h2>Ключові контракти</h2><p>Coca-Cola та AB InBev не входять у фокус директора</p></div><b>{money(summary.strategicTurnover)}</b><ChevronDown size={18} /></summary><div className={styles.secondaryBody}><dl className={styles.splitList}><div><dt>Оборот групи</dt><dd>{money(summary.baseTurnover)}</dd></div><div><dt>Coca-Cola / AB InBev</dt><dd>{money(summary.strategicTurnover)}</dd></div><div><dt>Разом для звірки</dt><dd>{money(summary.grossTurnover)}</dd></div><div><dt>Зафіксована готівка</dt><dd>{money(model.structure.recordedCash)}</dd></div></dl></div></details></section>

    <section className={styles.auditSection}><header><div><span>МІСЯЧНИЙ АУДИТ</span><h2>Знайти аномальні місяці</h2></div><b>{auditedMonths.length} із {model.months.length}</b></header><div className={styles.auditControls}><label><Filter size={15} /><select aria-label="Фільтр місячного аудиту" value={auditFilter} onChange={(event) => setAuditFilter(event.target.value as AuditFilter)}><option value="all">Усі місяці</option><option value="missing-payroll">Без даних ФОП</option><option value="payroll-pressure">ФОП / оборот ≥ 35%</option><option value="decline">Падіння обороту р/р</option></select><ChevronDown size={14} /></label><label><span>Сортувати:</span><select aria-label="Сортування місячного аудиту" value={auditSort} onChange={(event) => setAuditSort(event.target.value as AuditSort)}><option value="newest">Спочатку нові</option><option value="turnover-desc">Найбільший оборот</option><option value="growth-asc">Найгірша динаміка р/р</option><option value="productivity-desc">Найвища продуктивність</option><option value="payroll-share-desc">Найвища частка ФОП</option></select><ChevronDown size={14} /></label></div><div className={styles.tableWrap}><table><thead><tr><th>Місяць</th><th>Оборот групи</th><th>Зміна р/р</th><th>FTE</th><th>Оборот / FTE</th><th>ФОП</th><th>ФОП / оборот</th><th>Ключові контракти · окремо</th></tr></thead><tbody>{auditedMonths.map((month) => { const yoy = growth(month.baseTurnover ?? 0, priorByCurrentPeriod.get(month.period)?.baseTurnover ?? null); return <tr key={month.period}><td><b>{monthLabel(month.period)}</b></td><td>{month.baseTurnover === null ? "—" : preciseMoney.format(month.baseTurnover)}</td><td className={deltaTone(yoy)}>{percent(yoy, true)}</td><td>{month.fte === null ? "—" : number.format(month.fte)}</td><td>{money(month.turnoverPerFte)}</td><td className={month.payroll === null ? styles.missing : ""}>{month.payroll === null ? "Немає даних" : preciseMoney.format(month.payroll)}</td><td>{percent(month.payrollShare)}</td><td>{preciseMoney.format(month.strategicTurnover)}</td></tr>; })}</tbody></table>{!auditedMonths.length ? <div className={styles.emptyAudit}>За цим фільтром аномалій немає.</div> : null}</div></section>

    <section className={`owner-section ${styles.ownerFocusCompact}`}><header><div><span>ФОКУС ВЛАСНИКА</span><h2>Короткий список управлінських сигналів</h2></div><small>Компактно, після основної аналітики</small></header><div className={styles.ownerSignalsTable}><div className={styles.signalHead}><span>Сигнал</span><span>Значення</span><span>Що це означає</span><span>Наступна дія</span></div>{signals.map((signal) => <div key={signal.id} className={styles.signalRow}><span><i className={styles[signal.tone]} />{signal.title}</span><strong className={styles[signal.tone]}>{signal.value}</strong><p>{signal.detail}</p><p>{signal.action}</p></div>)}</div></section>
    <footer className={styles.footer}><span><LockKeyhole size={13} /> Доступ лише для executive.vault · API без кешування</span><p>{dataset.source.fileName} · SHA {dataset.source.sha256.slice(0, 10)}…</p></footer>
  </div>;
}

export function FinanceDashboard({ dataset: initialDataset }: { dataset?: ConfidentialTurnoverDataset }) {
  const [dataset, setDataset] = useState(initialDataset ?? null), [error, setError] = useState(""), [loading, setLoading] = useState(!initialDataset);
  const load = useCallback(async (signal?: AbortSignal) => { setLoading(true); try { const response = await fetch("/api/confidential/turnover", { cache: "no-store", signal }); if (response.status === 401) { window.location.assign("/login"); return; } if (!response.ok) throw new Error(response.status === 403 ? "Цей акаунт не має доступу до фінансів." : "Не вдалося завантажити фінансові дані."); setDataset(await response.json() as ConfidentialTurnoverDataset); setError(""); } catch (cause) { if (cause instanceof DOMException && cause.name === "AbortError") return; setError(cause instanceof Error ? cause.message : "Не вдалося завантажити фінансові дані."); } finally { if (!signal?.aborted) setLoading(false); } }, []);
  useEffect(() => {
    if (initialDataset) return;
    const controller = new AbortController();
    fetch("/api/confidential/turnover", { cache: "no-store", signal: controller.signal })
      .then((response) => { if (response.status === 401) { window.location.assign("/login"); throw new Error("Unauthorized"); } if (!response.ok) throw new Error(response.status === 403 ? "Цей акаунт не має доступу до фінансів." : "Не вдалося завантажити фінансові дані."); return response.json() as Promise<ConfidentialTurnoverDataset>; })
      .then((payload) => { setDataset(payload); setError(""); })
      .catch((cause: unknown) => { if (cause instanceof DOMException && cause.name === "AbortError") return; if (cause instanceof Error && cause.message !== "Unauthorized") setError(cause.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [initialDataset]);
  if (!dataset) return <div className={styles.financeState}>{loading ? <LoaderCircle className="spin" size={26} /> : <CircleAlert size={26} />}<h2>{loading ? "Завантажуємо фінансовий зріз" : error}</h2>{!loading ? <button type="button" onClick={() => void load()}><RefreshCw size={15} />Спробувати ще раз</button> : null}</div>;
  return <FinanceContent dataset={dataset} />;
}

export function ConfidentialDashboard({ dataset }: { dataset: ConfidentialTurnoverDataset }) {
  return <FinanceDashboard dataset={dataset} />;
}
