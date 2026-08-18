"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, CircleAlert, Filter, LoaderCircle, LockKeyhole, RefreshCw, SlidersHorizontal } from "lucide-react";
import { buildConfidentialDashboard, type ConfidentialDashboardModel, type TurnoverMonth } from "@/lib/confidential-dashboard";
import type { ConfidentialTurnoverDataset } from "@/lib/confidential-turnover";
import styles from "./confidential-dashboard.module.css";

const ukMonth = new Intl.DateTimeFormat("uk-UA", { month: "short", year: "2-digit", timeZone: "UTC" });
const ukDate = new Intl.DateTimeFormat("uk-UA", { day: "2-digit", month: "long", year: "numeric", timeZone: "Europe/Kyiv" });
const preciseMoney = new Intl.NumberFormat("uk-UA", { style: "currency", currency: "UAH", currencyDisplay: "narrowSymbol", maximumFractionDigits: 0 });
const number = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 1 });

type SignalTone = "good" | "risk" | "watch" | "neutral";
type OwnerSignal = { id: string; title: string; value: string; detail: string; action: string; tone: SignalTone; priority: number };
type MetricId = "gross" | "base" | "payroll" | "productivity";
type EntityId = "all" | "specservis" | "promtech" | "refkey" | "naryshkov" | "pashkov" | "danilenko" | "strategic";
type AuditFilter = "all" | "missing-payroll" | "payroll-pressure" | "decline";
type AuditSort = "newest" | "turnover-desc" | "growth-asc" | "productivity-desc" | "payroll-share-desc";

const metricOptions: Array<{ id: MetricId; label: string }> = [
  { id: "gross", label: "Валовий оборот" }, { id: "base", label: "Базовий оборот" },
  { id: "payroll", label: "Фонд оплати праці" }, { id: "productivity", label: "Оборот на 1 FTE" },
];
const entityOptions: Array<{ id: EntityId; label: string }> = [
  { id: "all", label: "Уся компанія" }, { id: "specservis", label: "Спецсервіс" },
  { id: "promtech", label: "Промтехгруп · база" }, { id: "refkey", label: "Рефкей" },
  { id: "naryshkov", label: "ФОП Наришков" }, { id: "pashkov", label: "ФОП Пашков" },
  { id: "danilenko", label: "ФОП Даниленко" }, { id: "strategic", label: "Coca-Cola + ABInBev" },
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
  if (entity === "all") return month.grossTurnover;
  if (entity === "specservis") return (month.specservisBank ?? 0) + (month.specservisCash ?? 0);
  if (entity === "promtech") return month.promtechCore ?? 0;
  if (entity === "refkey") return (month.refkeyBank ?? 0) + (month.refkeyCash ?? 0);
  if (entity === "naryshkov") return month.fopNaryshkov ?? 0;
  if (entity === "pashkov") return month.fopPashkov ?? 0;
  if (entity === "danilenko") return month.fopDanilenko ?? 0;
  return month.strategicTurnover;
}

function metricValue(month: TurnoverMonth, metric: MetricId, entity: EntityId) {
  if (entity !== "all") return entityValue(month, entity);
  if (metric === "base") return month.baseTurnover ?? 0;
  if (metric === "payroll") return month.payroll ?? 0;
  if (metric === "productivity") return month.turnoverPerFte ?? 0;
  return month.grossTurnover;
}

function growth(current: number, previous: number | null) {
  return previous === null || previous === 0 ? null : current / previous - 1;
}

function Metric({ label, value, detail, delta, tone = "plain" }: { label: string; value: string; detail: string; delta?: number | null; tone?: "plain" | "good" | "risk" | "accent" }) {
  return <article className={`role-metric ${tone}`}><span>{label}</span><strong>{value}</strong><small>{detail}{delta !== undefined ? <b className={deltaTone(delta)}>{delta === null ? "немає бази" : `${percent(delta, true)} р/р`}</b> : null}</small></article>;
}

function TurnoverChart({ current, comparison, metric, entity, showComparison }: { current: TurnoverMonth[]; comparison: TurnoverMonth[]; metric: MetricId; entity: EntityId; showComparison: boolean }) {
  const width = 960, height = 270, top = 18, bottom = 224, plotHeight = bottom - top;
  const currentValues = current.map((month) => metricValue(month, metric, entity));
  const comparisonValues = showComparison ? comparison.map((month) => metricValue(month, metric, entity)) : [];
  const maximum = Math.max(...currentValues, ...comparisonValues, 1);
  const span = width / Math.max(current.length, 1);
  const barWidth = Math.max(2, Math.min(38, span * .48));
  const labelStep = Math.max(1, Math.ceil(current.length / 10));
  return <svg className={styles.turnoverChart} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Динаміка обраного фінансового показника">
    {[0, .25, .5, .75, 1].map((part) => { const y = bottom - plotHeight * part; return <g key={part}><line x1="0" x2={width} y1={y} y2={y} className={styles.gridLine} /><text x="4" y={y - 5} className={styles.axisText}>{money(maximum * part)}</text></g>; })}
    {current.map((month, index) => { const x = index * span + span / 2; const value = currentValues[index] ?? 0; const priorValue = comparisonValues[index] ?? 0; const valueHeight = Math.max(0, value / maximum * plotHeight); const priorHeight = Math.max(0, priorValue / maximum * plotHeight); return <g key={month.period} role="group" aria-label={`${monthLabel(month.period)} · ${preciseMoney.format(value)}`}>
      {showComparison && comparison[index] ? <rect x={x - barWidth * .78} y={bottom - priorHeight} width={barWidth * 1.56} height={priorHeight} rx="5" className={styles.priorBar} /> : null}
      <rect x={x - barWidth / 2} y={bottom - valueHeight} width={barWidth} height={valueHeight} rx="4" className={styles.baseBar} />
      {index % labelStep === 0 || index === current.length - 1 ? <text x={x} y="252" textAnchor="middle" className={styles.monthText}>{monthLabel(month.period)}</text> : null}
    </g>; })}
  </svg>;
}

function Sparkline({ values, label }: { values: Array<number | null>; label: string }) {
  const width = 420, height = 92;
  const known = values.filter((value): value is number => value !== null);
  const maximum = Math.max(...known, 1), minimum = Math.min(...known, 0), range = maximum - minimum || 1, step = width / Math.max(values.length - 1, 1);
  const path = values.reduce((state, value, index) => value === null ? { path: state.path, open: false } : { path: `${state.path} ${state.open ? "L" : "M"}${(index * step).toFixed(2)},${(height - ((value - minimum) / range) * (height - 18) - 9).toFixed(2)}`.trim(), open: true }, { path: "", open: false }).path;
  return <svg className={styles.sparkline} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}><line x1="0" x2={width} y1="83" y2="83" className={styles.gridLine} /><path d={path} /></svg>;
}

function buildSignals(model: ConfidentialDashboardModel, missingPayroll: number): OwnerSignal[] {
  const turnoverGrowth = model.growth.grossTurnover, productivityGrowth = model.growth.turnoverPerFte, payroll = model.payrollEconomics, top = model.structure.topEntity;
  return [
    ...(missingPayroll ? [{ id: "quality", title: "Неповний ФОП", value: `${missingPayroll} міс.`, detail: "Частина місяців не має фонду оплати праці, тому підсумок витрат занижений.", action: "Дозаповнити джерело до рішення про витрати на персонал.", tone: "risk" as const, priority: 0 }] : []),
    { id: "payroll", title: payroll?.payrollGrowthGap !== null && payroll?.payrollGrowthGap !== undefined && payroll.payrollGrowthGap > .03 ? "ФОП випереджає оборот" : "ФОП контрольований", value: points(payroll?.payrollGrowthGap ?? null), detail: payroll ? `На ${payroll.months} зіставних місяцях: ФОП ${percent(payroll.payrollGrowth, true)}, оборот ${percent(payroll.grossGrowth, true)}.` : "Немає повної бази.", action: payroll?.payrollGrowthGap && payroll.payrollGrowthGap > .03 ? "Перевірити найм, премії та завантаження команди." : "Утримувати темп ФОП не вище темпу обороту.", tone: payroll?.payrollGrowthGap === null || payroll?.payrollGrowthGap === undefined ? "neutral" as const : payroll.payrollGrowthGap > .03 ? "risk" as const : "good" as const, priority: payroll?.payrollGrowthGap && payroll.payrollGrowthGap > .03 ? 1 : 4 },
    { id: "concentration", title: top && top.share > .65 ? "Залежність від одного джерела" : "Структура диверсифікована", value: top ? percent(top.share) : "—", detail: top ? `${top.label} — найбільше джерело. Топ-3 формують ${percent(model.structure.topThreeShare)}.` : "Недостатньо даних.", action: top && top.share > .65 ? "Перевірити резерв заміщення цього потоку." : "Контролювати частку топ-3 щомісяця.", tone: top && top.share > .65 ? "watch" as const : "good" as const, priority: top && top.share > .65 ? 2 : 5 },
    { id: "productivity", title: productivityGrowth !== null && productivityGrowth >= 0 ? "Масштабування дає результат" : "Продуктивність знижується", value: percent(productivityGrowth, true), detail: `Команда: ${number.format(model.summary.avgFte ?? 0)} FTE, зміна ${percent(model.growth.avgFte, true)} р/р.`, action: productivityGrowth !== null && productivityGrowth < 0 ? "Знайти місяці, де FTE росте без відповідного обороту." : "Зберегти продуктивність при подальшому наймі.", tone: productivityGrowth === null ? "neutral" as const : productivityGrowth >= 0 ? "good" as const : "risk" as const, priority: productivityGrowth !== null && productivityGrowth < 0 ? 1 : 5 },
    { id: "turnover", title: turnoverGrowth !== null && turnoverGrowth >= 0 ? "Оборот зростає" : "Оборот скорочується", value: percent(turnoverGrowth, true), detail: `База: ${percent(model.growth.baseTurnover, true)} р/р. Ключові контракти — ${percent(model.summary.strategicShare)}.`, action: turnoverGrowth !== null && turnoverGrowth < 0 ? "Розкласти падіння на базу й ключові контракти." : "Перевірити, яка частина росту є повторюваною базою.", tone: turnoverGrowth === null ? "neutral" as const : turnoverGrowth >= 0 ? "good" as const : "risk" as const, priority: turnoverGrowth !== null && turnoverGrowth < 0 ? 1 : 6 },
  ].sort((left, right) => left.priority - right.priority);
}

function FinanceContent({ dataset }: { dataset: ConfidentialTurnoverDataset }) {
  const [rangeId, setRangeId] = useState("ytd"), [metric, setMetric] = useState<MetricId>("gross"), [entity, setEntity] = useState<EntityId>("all"), [comparison, setComparison] = useState<"yoy" | "none">("yoy"), [auditFilter, setAuditFilter] = useState<AuditFilter>("all"), [auditSort, setAuditSort] = useState<AuditSort>("newest");
  const model = useMemo(() => buildConfidentialDashboard(dataset.records, rangeId), [dataset.records, rangeId]);
  const summary = model.summary, latest = model.months.at(-1) ?? null, missingPayroll = summary.months - summary.payrollMonths;
  const signals = useMemo(() => buildSignals(model, missingPayroll), [model, missingPayroll]);
  const mixMaximum = Math.max(...model.entityMix.map((item) => Math.abs(item.value)), 1);
  const selectedEntity = entityOptions.find((option) => option.id === entity) ?? entityOptions[0], selectedMetric = metricOptions.find((option) => option.id === metric) ?? metricOptions[0];
  const selectedTotal = model.months.reduce((total, month) => total + metricValue(month, metric, entity), 0), priorTotal = model.comparisonMonths.length === model.months.length ? model.comparisonMonths.reduce((total, month) => total + metricValue(month, metric, entity), 0) : null;
  const selectedGrowth = growth(selectedTotal, priorTotal), comparisonBaseDelta = model.comparison ? summary.baseTurnover - model.comparison.baseTurnover : null, comparisonStrategicDelta = model.comparison ? summary.strategicTurnover - model.comparison.strategicTurnover : null;
  const priorByCurrentPeriod = new Map(model.comparisonMonths.map((month) => [`${Number(month.period.slice(0, 4)) + 1}${month.period.slice(4)}`, month]));
  const auditedMonths = [...model.months].filter((month) => auditFilter === "all" || (auditFilter === "missing-payroll" && month.payroll === null) || (auditFilter === "payroll-pressure" && (month.payrollShare ?? 0) >= .35) || (auditFilter === "decline" && (growth(month.grossTurnover, priorByCurrentPeriod.get(month.period)?.grossTurnover ?? null) ?? 0) < 0)).sort((left, right) => auditSort === "turnover-desc" ? right.grossTurnover - left.grossTurnover : auditSort === "growth-asc" ? (growth(left.grossTurnover, priorByCurrentPeriod.get(left.period)?.grossTurnover ?? null) ?? Number.MAX_SAFE_INTEGER) - (growth(right.grossTurnover, priorByCurrentPeriod.get(right.period)?.grossTurnover ?? null) ?? Number.MAX_SAFE_INTEGER) : auditSort === "productivity-desc" ? (right.turnoverPerFte ?? -1) - (left.turnoverPerFte ?? -1) : auditSort === "payroll-share-desc" ? (right.payrollShare ?? -1) - (left.payrollShare ?? -1) : right.period.localeCompare(left.period));

  return <div className={`owner-stack ${styles.financeApp}`}>
    <section className={styles.controlBar} aria-label="Фільтри фінансового дашборда"><div className={styles.controlTitle}><SlidersHorizontal size={17} /><div><b>Керування зрізом</b><span>Усі суми перераховуються з фактичних рядків</span></div></div><div className={styles.controls}>
      <label><span>Період</span><div><select value={model.range.id} onChange={(event) => setRangeId(event.target.value)}>{model.options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select><ChevronDown size={14} /></div></label>
      <label><span>Джерело обороту</span><div><select value={entity} onChange={(event) => { const value = event.target.value as EntityId; setEntity(value); if (value !== "all") setMetric("gross"); }}>{entityOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select><ChevronDown size={14} /></div></label>
      <label><span>Показник</span><div><select value={metric} disabled={entity !== "all"} onChange={(event) => setMetric(event.target.value as MetricId)}>{metricOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select><ChevronDown size={14} /></div></label>
      <label><span>Порівняння</span><div><select value={comparison} onChange={(event) => setComparison(event.target.value as "yoy" | "none")}><option value="yoy">Той самий період торік</option><option value="none">Без порівняння</option></select><ChevronDown size={14} /></div></label>
    </div></section>
    <section className="owner-page-head"><div><span>ФІНАНСОВИЙ ПУЛЬС · {selectedEntity.label.toUpperCase()}</span><h1>{money(selectedTotal)}</h1><p>{selectedMetric.label} за {model.range.label}. {comparison === "yoy" ? `Зміна до зіставного періоду: ${percent(selectedGrowth, true)}.` : "Порівняння вимкнено."}</p></div><div className={`owner-head-sync ${missingPayroll ? "snapshot" : ""}`}><i /><span><b>{missingPayroll ? "Є неповні дані" : "Дані повні"}</b><small>Джерело оновлено {ukDate.format(new Date(dataset.source.modifiedAt))}{missingPayroll ? ` · ФОП відсутній у ${missingPayroll} міс.` : ""}</small></span></div></section>
    {missingPayroll ? <div className={styles.sourceAlert}><CircleAlert size={17} /><div><b>Не робіть висновок про повний ФОП за весь період</b><span>Заповнено {summary.payrollMonths} із {summary.months} місяців. Річне зіставлення використовує лише однаково заповнені місяці.</span></div></div> : null}
    <section className="role-metrics owner-metrics"><Metric label="Валовий оборот" value={money(summary.grossTurnover)} detail={`${money(summary.grossTurnover / Math.max(summary.months, 1))} / міс.`} delta={model.growth.grossTurnover} tone="accent" /><Metric label="Базовий оборот" value={money(summary.baseTurnover)} detail={`${percent(summary.strategicShare)} у ключових контрактах`} delta={model.growth.baseTurnover} /><Metric label="Продуктивність" value={money(summary.turnoverPerFte)} detail="обороту на 1 FTE / міс." delta={model.growth.turnoverPerFte} tone="good" /><Metric label="Команда" value={summary.lastFte === null ? "—" : `${number.format(summary.lastFte)} FTE`} detail={`середнє ${summary.avgFte === null ? "—" : number.format(summary.avgFte)} FTE`} delta={model.growth.avgFte} /><Metric label="Фонд оплати праці" value={money(summary.payroll)} detail={`${summary.payrollMonths} із ${summary.months} місяців`} delta={model.payrollEconomics?.payrollGrowth ?? null} tone={model.payrollEconomics?.payrollGrowthGap && model.payrollEconomics.payrollGrowthGap > .03 ? "risk" : "plain"} /></section>
    <section className={`owner-section ${styles.signalsSection}`}><header><div><span>ФОКУС ВЛАСНИКА</span><h2>На що дивитися зараз</h2></div><small>Від найважливішого до інформаційного</small></header><div className={styles.signalsGrid}>{signals.map((signal, index) => <article key={signal.id} className={`${styles.signal} ${styles[signal.tone]}`}><div className={styles.signalRank}>0{index + 1}</div><i /><span>{signal.title}</span><strong>{signal.value}</strong><p>{signal.detail}</p><footer><b>Наступний крок</b>{signal.action}</footer></article>)}</div></section>
    <section className={styles.driverGrid}><article className="role-panel"><header><div><span>ДРАЙВЕР ЗМІНИ</span><h2>Звідки прийшов результат</h2></div><b>до минулого року</b></header><div className={styles.driverRows}><div><span>Зміна базового обороту</span><strong className={deltaTone(comparisonBaseDelta)}>{money(comparisonBaseDelta)}</strong></div><div><span>Зміна ключових контрактів</span><strong className={deltaTone(comparisonStrategicDelta)}>{money(comparisonStrategicDelta)}</strong></div><div><span>Загальна зміна</span><strong>{money(model.comparison ? summary.grossTurnover - model.comparison.grossTurnover : null)}</strong></div></div></article><article className="role-panel"><header><div><span>ОСТАННІЙ МІСЯЦЬ</span><h2>{monthLabel(model.movement.latestPeriod)}</h2></div><b>{latest ? money(latest.grossTurnover) : "—"}</b></header><div className={styles.driverRows}><div><span>Оборот · м/м</span><strong className={deltaTone(model.movement.grossMonthOverMonth)}>{percent(model.movement.grossMonthOverMonth, true)}</strong></div><div><span>Оборот · р/р</span><strong className={deltaTone(model.movement.grossYearOverYear)}>{percent(model.movement.grossYearOverYear, true)}</strong></div><div><span>Продуктивність · м/м</span><strong className={deltaTone(model.movement.productivityMonthOverMonth)}>{percent(model.movement.productivityMonthOverMonth, true)}</strong></div></div></article></section>
    <section className={styles.primaryGrid}><article className={`role-panel ${styles.chartPanel}`}><header><div><span>ДИНАМІКА</span><h2>{selectedEntity.label} · {selectedMetric.label.toLowerCase()}</h2></div><b>{model.range.label}</b></header><div className={styles.legend}><span><i className={styles.currentLegend} />Поточний період</span>{comparison === "yoy" ? <span><i className={styles.priorLegend} />Той самий місяць торік</span> : null}</div><TurnoverChart current={model.months} comparison={model.comparisonMonths} metric={metric} entity={entity} showComparison={comparison === "yoy"} /></article><article className="role-panel"><header><div><span>КОНЦЕНТРАЦІЯ</span><h2>Хто формує оборот</h2></div><b>{percent(model.structure.topThreeShare)} · топ-3</b></header><div className={styles.mixList}>{model.entityMix.map((item) => <button type="button" key={item.id} className={entity === item.id ? styles.activeMix : ""} onClick={() => { if (entityOptions.some((option) => option.id === item.id)) { setEntity(item.id as EntityId); setMetric("gross"); } }}><div><span>{item.label}</span><b>{percent(item.share)}</b></div><i><em style={{ width: `${Math.max(1, Math.abs(item.value) / mixMaximum * 100)}%` }} /></i><strong>{money(item.value)}</strong></button>)}</div><footer className={styles.panelFoot}>Натисніть джерело, щоб відфільтрувати графік.</footer></article></section>
    <section className={styles.managementGrid}><article className="role-panel"><header><div><span>ЕКОНОМІКА КОМАНДИ</span><h2>Люди та продуктивність</h2></div><b>{summary.lastFte === null ? "—" : `${number.format(summary.lastFte)} FTE`}</b></header><div className={styles.economicsRows}><div><span>Оборот на 1 FTE / місяць</span><strong>{money(summary.turnoverPerFte)}</strong><em className={deltaTone(model.growth.turnoverPerFte)}>{percent(model.growth.turnoverPerFte, true)} р/р</em></div><div><span>ФОП на 1 FTE / місяць</span><strong>{money(summary.payrollPerFte)}</strong><em>{summary.payrollMonths} міс. із даними</em></div><div><span>ФОП до базового обороту</span><strong>{percent(summary.payrollShare)}</strong><em>{summary.payrollShare ? `${number.format(1 / summary.payrollShare)}× обороту на ₴1 ФОП` : "—"}</em></div></div><Sparkline values={model.months.map((month) => month.turnoverPerFte)} label="Динаміка обороту на одного працівника" /></article><article className="role-panel"><header><div><span>СТРУКТУРА ГРОШЕЙ</span><h2>База проти ключових контрактів</h2></div><b>{money(summary.grossTurnover)}</b></header><div className={styles.shareVisual}><div style={{ "--share": `${(summary.strategicShare ?? 0) * 360}deg` } as React.CSSProperties}><strong>{percent(summary.strategicShare)}</strong><span>ключові<br />контракти</span></div></div><dl className={styles.splitList}><div><dt>Базовий оборот</dt><dd>{money(summary.baseTurnover)}</dd></div><div><dt>Coca-Cola / ABInBev</dt><dd>{money(summary.strategicTurnover)}</dd></div><div><dt>Зафіксована готівка</dt><dd>{money(model.structure.recordedCash)}</dd></div></dl></article></section>
    <section className="owner-section"><header><div><span>РІК ДО РОКУ</span><h2>Річна траєкторія бізнесу</h2></div><small>YTD — неповний календарний рік</small></header><div className={styles.tableWrap}><table><thead><tr><th>Рік</th><th>Валовий оборот</th><th>База</th><th>Середня команда</th><th>Оборот / FTE</th><th>ФОП / база</th></tr></thead><tbody>{model.annual.slice(0, 8).map((year) => <tr key={year.year}><td><b>{year.year}</b>{year.complete ? null : <span>YTD</span>}</td><td>{preciseMoney.format(year.grossTurnover)}</td><td>{preciseMoney.format(year.baseTurnover)}</td><td>{year.avgFte === null ? "—" : `${number.format(year.avgFte)} FTE`}</td><td>{money(year.turnoverPerFte)}</td><td>{percent(year.payrollShare)}</td></tr>)}</tbody></table></div></section>
    <section className={styles.auditSection}><header><div><span>МІСЯЧНИЙ АУДИТ</span><h2>Знайти аномальні місяці</h2></div><b>{auditedMonths.length} із {model.months.length}</b></header><div className={styles.auditControls}><label><Filter size={15} /><select aria-label="Фільтр місячного аудиту" value={auditFilter} onChange={(event) => setAuditFilter(event.target.value as AuditFilter)}><option value="all">Усі місяці</option><option value="missing-payroll">Без даних ФОП</option><option value="payroll-pressure">ФОП / база ≥ 35%</option><option value="decline">Падіння обороту р/р</option></select><ChevronDown size={14} /></label><label><span>Сортувати:</span><select aria-label="Сортування місячного аудиту" value={auditSort} onChange={(event) => setAuditSort(event.target.value as AuditSort)}><option value="newest">Спочатку нові</option><option value="turnover-desc">Найбільший оборот</option><option value="growth-asc">Найгірша динаміка р/р</option><option value="productivity-desc">Найвища продуктивність</option><option value="payroll-share-desc">Найвища частка ФОП</option></select><ChevronDown size={14} /></label></div><div className={styles.tableWrap}><table><thead><tr><th>Місяць</th><th>Валовий оборот</th><th>Зміна р/р</th><th>База</th><th>Ключові контракти</th><th>FTE</th><th>Оборот / FTE</th><th>ФОП</th><th>ФОП / база</th></tr></thead><tbody>{auditedMonths.map((month) => { const yoy = growth(month.grossTurnover, priorByCurrentPeriod.get(month.period)?.grossTurnover ?? null); return <tr key={month.period}><td><b>{monthLabel(month.period)}</b></td><td>{preciseMoney.format(month.grossTurnover)}</td><td className={deltaTone(yoy)}>{percent(yoy, true)}</td><td>{month.baseTurnover === null ? "—" : preciseMoney.format(month.baseTurnover)}</td><td>{preciseMoney.format(month.strategicTurnover)}</td><td>{month.fte === null ? "—" : number.format(month.fte)}</td><td>{money(month.turnoverPerFte)}</td><td className={month.payroll === null ? styles.missing : ""}>{month.payroll === null ? "Немає даних" : preciseMoney.format(month.payroll)}</td><td>{percent(month.payrollShare)}</td></tr>; })}</tbody></table>{!auditedMonths.length ? <div className={styles.emptyAudit}>За цим фільтром аномалій немає.</div> : null}</div></section>
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
      .then((response) => {
        if (response.status === 401) { window.location.assign("/login"); throw new Error("Unauthorized"); }
        if (!response.ok) throw new Error(response.status === 403 ? "Цей акаунт не має доступу до фінансів." : "Не вдалося завантажити фінансові дані.");
        return response.json() as Promise<ConfidentialTurnoverDataset>;
      })
      .then((payload) => { setDataset(payload); setError(""); })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        if (cause instanceof Error && cause.message !== "Unauthorized") setError(cause.message);
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [initialDataset]);
  if (!dataset) return <div className={styles.financeState}>{loading ? <LoaderCircle className="spin" size={26} /> : <CircleAlert size={26} />}<h2>{loading ? "Завантажуємо фінансовий зріз" : error}</h2>{!loading ? <button type="button" onClick={() => void load()}><RefreshCw size={15} />Спробувати ще раз</button> : null}</div>;
  return <FinanceContent dataset={dataset} />;
}

export function ConfidentialDashboard({ dataset }: { dataset: ConfidentialTurnoverDataset }) { return <FinanceDashboard dataset={dataset} />; }
