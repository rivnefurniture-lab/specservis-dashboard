"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarRange, ChevronDown, CircleAlert, Filter, LoaderCircle, LockKeyhole, RefreshCw, X } from "lucide-react";
import { buildConfidentialDashboard } from "@/lib/confidential-dashboard";
import type { ConfidentialTurnoverDataset } from "@/lib/confidential-turnover";
import { aggregateEntity, CumulativeTurnoverChart, growth, money, monthLabel, MonthlyTurnoverChart, number, percent, points, preciseMoney, WorkforceEconomicsChart, type EntityId } from "./confidential-finance-charts";
import styles from "./confidential-dashboard.module.css";

const ukDate = new Intl.DateTimeFormat("uk-UA", { day: "2-digit", month: "long", year: "numeric", timeZone: "Europe/Kyiv" });
const wholeNumber = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 });
const monthNames = ["січень", "лютий", "березень", "квітень", "травень", "червень", "липень", "серпень", "вересень", "жовтень", "листопад", "грудень"];
const monthShort = ["січ", "лют", "бер", "квіт", "трав", "черв", "лип", "серп", "вер", "жовт", "лист", "груд"];
const entityColors = ["#2f2a80", "#4679b9", "#33a06f", "#db8b48", "#8b6bb0", "#58a5a8", "#c65e67"];

type AuditFilter = "all" | "missing-payroll" | "payroll-above-turnover" | "decline";
type AuditSort = "newest" | "turnover-desc" | "growth-asc" | "productivity-desc" | "payroll-share-desc";

const entityOptions: Array<{ id: EntityId; label: string }> = [
  { id: "all", label: "Уся група" }, { id: "specservis", label: "Спецсервіс" },
  { id: "promtech", label: "Промтехгруп" }, { id: "refkey", label: "Рефкей" },
  { id: "naryshkov", label: "ФОП Наришков" }, { id: "pashkov", label: "ФОП Пашков" },
  { id: "danilenko", label: "ФОП Даниленко" },
];

function deltaTone(value: number | null) { return value === null ? styles.muted : value >= 0 ? styles.positive : styles.negative; }
function monthIndex(period: string | null) { return period ? Number(period.slice(5, 7)) - 1 : 0; }
function periodRangeLabel(from: string | null, to: string | null) { return !from || !to ? "немає зіставного періоду" : `${monthLabel(from)} — ${monthLabel(to)}`; }
function compactPeriodLabel(from: string | null, to: string | null) {
  if (!from || !to) return "—";
  const fromYear = from.slice(0, 4), toYear = to.slice(0, 4), years = fromYear === toYear ? toYear : `${fromYear}–${toYear.slice(2)}`;
  return `${monthShort[monthIndex(from)]}–${monthShort[monthIndex(to)]} ${years}`;
}
function periodTitle(from: string | null, to: string | null) {
  if (!from || !to) return "обраний період";
  return from === to ? monthNames[monthIndex(from)] : `${monthNames[monthIndex(from)]}–${monthNames[monthIndex(to)]}`;
}
function displayPeriodTitle(from: string | null, to: string | null) { const value = periodTitle(from, to); return `${value.charAt(0).toUpperCase()}${value.slice(1)}`; }
function valueCell(value: number | null) { return value === null ? "—" : wholeNumber.format(value); }

function FinanceContent({ dataset }: { dataset: ConfidentialTurnoverDataset }) {
  const [rangeId, setRangeId] = useState("ytd");
  const [entity, setEntity] = useState<EntityId>("all");
  const [auditFilter, setAuditFilter] = useState<AuditFilter>("all");
  const [auditSort, setAuditSort] = useState<AuditSort>("newest");
  const model = useMemo(() => buildConfidentialDashboard(dataset.records, rangeId), [dataset.records, rangeId]);
  const summary = model.summary, latest = model.months.at(-1) ?? null, history = model.history.slice(-4);
  const currentComparable = model.history.at(-1) ?? null, previousComparable = model.history.at(-2) ?? null;
  const missingPayrollMonths = model.months.filter((month) => month.payroll === null);
  const selectedEntity = entityOptions.find((option) => option.id === entity) ?? entityOptions[0];
  const selectedTotal = aggregateEntity(model.months, entity);
  const priorTotal = model.comparisonMonths.length === model.months.length ? aggregateEntity(model.comparisonMonths, entity) : null;
  const selectedGrowth = growth(selectedTotal, priorTotal);
  const quickOptions = model.options.filter((option) => option.id === "ytd" || option.id === "12m");
  const latestYear = latest?.period.slice(0, 4);
  const archiveOptions = model.options.filter((option) => option.id !== "ytd" && option.id !== "12m" && option.id !== latestYear);
  const priorByCurrentPeriod = new Map(model.comparisonMonths.map((month) => [`${Number(month.period.slice(0, 4)) + 1}${month.period.slice(4)}`, month]));
  const auditedMonths = [...model.months].filter((month) => auditFilter === "all"
    || (auditFilter === "missing-payroll" && month.payroll === null)
    || (auditFilter === "payroll-above-turnover" && (month.payrollShare ?? 0) > 1)
    || (auditFilter === "decline" && (growth(month.baseTurnover ?? 0, priorByCurrentPeriod.get(month.period)?.baseTurnover ?? null) ?? 0) < 0))
    .sort((left, right) => auditSort === "turnover-desc" ? (right.baseTurnover ?? 0) - (left.baseTurnover ?? 0)
      : auditSort === "growth-asc" ? (growth(left.baseTurnover ?? 0, priorByCurrentPeriod.get(left.period)?.baseTurnover ?? null) ?? Number.MAX_SAFE_INTEGER) - (growth(right.baseTurnover ?? 0, priorByCurrentPeriod.get(right.period)?.baseTurnover ?? null) ?? Number.MAX_SAFE_INTEGER)
        : auditSort === "productivity-desc" ? (right.turnoverPerFte ?? -1) - (left.turnoverPerFte ?? -1)
          : auditSort === "payroll-share-desc" ? (right.payrollShare ?? -1) - (left.payrollShare ?? -1) : right.period.localeCompare(left.period));
  const comparisonPeriod = periodRangeLabel(previousComparable?.from ?? null, previousComparable?.to ?? null);
  const strategicBreakdown = [
    { label: "Coca-Cola · Промтехгруп", value: model.months.reduce((total, month) => total + (month.cocaColaPromtech ?? 0), 0) },
    { label: "Coca-Cola · Спецсервіс", value: model.months.reduce((total, month) => total + (month.cocaColaSpecservis ?? 0), 0) },
    { label: "AB InBev", value: model.months.reduce((total, month) => total + (month.abinbev ?? 0), 0) },
  ];
  const refkeyCash = model.months.reduce((total, month) => total + (month.refkeyCash ?? 0), 0), specservisCash = model.months.reduce((total, month) => total + (month.specservisCash ?? 0), 0);
  const currentPeriod = history.at(-1) ?? null, priorPeriod = history.at(-2) ?? null;
  const headlineMetrics = currentPeriod ? [
    { label: "Оборот групи", value: money(currentPeriod.baseTurnover), note: `За ${summary.months} місяців`, delta: growth(currentPeriod.baseTurnover, priorPeriod?.baseTurnover ?? null) },
    { label: `Оборот на 1 працівника · ${monthNames[monthIndex(currentPeriod.to)]}`, value: money(currentPeriod.lastTurnoverPerFte), note: "Останній місяць періоду", delta: growth(currentPeriod.lastTurnoverPerFte, priorPeriod?.lastTurnoverPerFte ?? null) },
    { label: "У середньому на 1 працівника", value: money(currentPeriod.turnoverPerFte), note: `Середнє за ${summary.months} місяців`, delta: growth(currentPeriod.turnoverPerFte, priorPeriod?.turnoverPerFte ?? null) },
    { label: "Середня кількість працівників", value: currentPeriod.avgFte === null ? "—" : wholeNumber.format(currentPeriod.avgFte), note: "Повних робочих ставок", delta: growth(currentPeriod.avgFte, priorPeriod?.avgFte ?? null) },
  ] : [];

  return <div className={`owner-stack ${styles.financeApp}`}>
    <section className={styles.toolbar} aria-label="Період фінансового огляду">
      <div className={styles.toolbarTitle}><CalendarRange size={18} /><span><b>Фінанси</b><small>Дані по {monthLabel(latest?.period ?? null)} · оновлено {ukDate.format(new Date(dataset.source.modifiedAt))}</small></span></div>
      <div className={styles.periodSwitch}>{quickOptions.map((option) => <button type="button" key={option.id} aria-pressed={rangeId === option.id} className={rangeId === option.id ? styles.activePeriod : ""} onClick={() => setRangeId(option.id)}>{option.id === "ytd" ? "Поточний рік" : "12 місяців"}</button>)}<label><select aria-label="Календарний період" value={quickOptions.some((option) => option.id === rangeId) ? "" : rangeId} onChange={(event) => event.target.value && setRangeId(event.target.value)}><option value="" disabled>Інший рік</option>{archiveOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select><ChevronDown size={14} /></label></div>
    </section>

    <section className={styles.performanceCard} aria-labelledby="performance-title">
      <header className={styles.performanceHeader}><div><h1 id="performance-title">{displayPeriodTitle(currentComparable?.from ?? null, currentComparable?.to ?? null)} {currentPeriod?.to?.slice(0, 4)}</h1><p>Показники та зміна до такого самого періоду минулого року</p></div><div className={styles.scopeNote}><b>{summary.months} місяців</b><span>Оборот без Coca-Cola та AB InBev</span></div></header>
      <div className={styles.headlineGrid}>{headlineMetrics.map((metric) => <article key={metric.label}><span>{metric.label}</span><strong>{metric.value}</strong><div><b className={deltaTone(metric.delta)}>{percent(metric.delta, true)}</b><small>до минулого року</small></div><p>{metric.note}</p></article>)}</div>
      <div className={styles.historyBlock}>
        <div className={styles.historyTitle}><div><h2>Порівняння за роками</h2></div><small>Під кожним значенням — зміна до попереднього року</small></div>
        <div className={styles.performanceScroll}><table className={styles.performanceTable}><thead><tr><th>Період</th><th>Оборот групи<small>грн</small></th><th>На 1 працівника<small>останній місяць, грн</small></th><th>Середнє на 1 працівника<small>грн</small></th><th>Середня команда<small>FTE</small></th></tr></thead><tbody>{history.map((period, index) => { const previous = history[index - 1]; const metrics = [
          { value: valueCell(period.baseTurnover), delta: previous ? growth(period.baseTurnover, previous.baseTurnover) : null },
          { value: valueCell(period.lastTurnoverPerFte), delta: previous ? growth(period.lastTurnoverPerFte, previous.lastTurnoverPerFte) : null },
          { value: valueCell(period.turnoverPerFte), delta: previous ? growth(period.turnoverPerFte, previous.turnoverPerFte) : null },
          { value: period.avgFte === null ? "—" : wholeNumber.format(period.avgFte), delta: previous ? growth(period.avgFte, previous.avgFte) : null },
        ]; return <tr key={period.id} className={index === history.length - 1 ? styles.currentYearRow : ""}><th><i style={{ background: entityColors[index] }} />{compactPeriodLabel(period.from, period.to)}{index === history.length - 1 ? <em>зараз</em> : null}</th>{metrics.map((metric, metricIndex) => <td key={metricIndex}><strong>{metric.value}</strong>{index ? <small className={deltaTone(metric.delta)}>{percent(metric.delta, true)}</small> : <small className={styles.muted}>база</small>}</td>)}</tr>; })}</tbody></table></div>
      </div>
    </section>

    {missingPayrollMonths.length ? <div className={styles.qualityNote}><CircleAlert size={17} /><span><b>Не всі витрати на ФОП внесені.</b> Немає даних за {missingPayrollMonths.map((month) => monthLabel(month.period)).join(", ")}.</span></div> : null}

    <section className={`role-panel ${styles.structurePanel}`}><header><div><span>КОМПАНІЇ</span><h2>Хто сформував оборот</h2><p>Наведіть на смугу, щоб побачити суму. Натисніть — щоб показати компанію помісячно.</p></div><b>{money(summary.baseTurnover)}</b></header><div className={styles.entityBars}>{model.entityMix.filter((item) => item.value > 0).map((item, index) => { const selectable = entityOptions.some((option) => option.id === item.id); const value = `${money(item.value)} · ${percent(item.share)}`; return <button type="button" key={item.id} disabled={!selectable} className={entity === item.id ? styles.activeEntity : ""} data-value={value} aria-label={`${item.label}: ${value}`} onClick={() => selectable && setEntity(item.id as EntityId)}><span className={styles.entityName}>{item.label}</span><span className={styles.entityTrack}><i style={{ width: `${Math.max(item.share * 100, 1.5)}%`, background: entityColors[index % entityColors.length] }} /></span></button>; })}</div></section>

    <section className={`role-panel ${styles.monthlyPanel}`}><header><div><span>ПО МІСЯЦЯХ</span><h2>{selectedEntity.label}</h2><p>Темний стовпчик — обраний період, світлий — той самий місяць торік.</p></div><div className={styles.panelTotal}><b>{money(selectedTotal)}</b><small className={deltaTone(selectedGrowth)}>{percent(selectedGrowth, true)} до минулого року</small></div></header><div className={styles.chartKey}><span><i className={styles.currentKey} />{periodRangeLabel(currentComparable?.from ?? null, currentComparable?.to ?? null)}</span><span><i className={styles.priorKey} />{comparisonPeriod}</span>{entity !== "all" ? <button type="button" onClick={() => setEntity("all")}><X size={13} />Уся група</button> : null}</div><div className={styles.monthlyScroll}><MonthlyTurnoverChart key={`${model.range.id}:${entity}`} current={model.months} comparison={model.comparisonMonths} entity={entity} /></div></section>

    <section className={`role-panel ${styles.trajectoryPanel}`}><header><div><span>ЗА РОКАМИ</span><h2>Як зростав оборот</h2><p>Кожна лінія показує, як накопичувався оборот за однакові місяці року.</p></div><b className={deltaTone(model.growth.baseTurnover)}>{percent(model.growth.baseTurnover, true)} до минулого року</b></header><CumulativeTurnoverChart key={model.range.id} history={model.history} /></section>

    <section className={`role-panel ${styles.workforcePanel}`}><header><div><span>КОМАНДА</span><h2>Оборот і витрати на одного працівника</h2><p>FTE — кількість повних робочих ставок. Наприклад, дві людини по пів ставки — це 1 FTE.</p></div></header><div className={styles.economicsMetrics}><div><span>Оборот на 1 працівника</span><strong>{money(summary.turnoverPerFte)}</strong></div><div><span>Витрати на ФОП на 1 працівника</span><strong>{money(summary.payrollPerFte)}</strong></div><div><span>Частка ФОП в обороті</span><strong>{percent(summary.payrollShare)}</strong></div><div><span>Різниця темпів ФОП і обороту</span><strong className={deltaTone(model.payrollEconomics?.payrollGrowthGap ?? null)}>{points(model.payrollEconomics?.payrollGrowthGap ?? null)}</strong></div></div><WorkforceEconomicsChart key={model.range.id} months={model.months} /></section>

    <details className={styles.secondaryDetails}><summary><div><span>ОКРЕМО</span><h2>Coca-Cola та AB InBev</h2><p>Ці контракти не входять у головний оборот вище.</p></div><b>{money(summary.strategicTurnover)}</b><ChevronDown size={18} /></summary><div className={styles.secondaryBody}><div className={styles.reconciliationEquation}><span><small>Основний оборот</small><b>{money(summary.baseTurnover)}</b></span><i>+</i><span><small>Coca-Cola та AB InBev</small><b>{money(summary.strategicTurnover)}</b></span><i>=</i><span><small>Увесь оборот</small><b>{money(summary.grossTurnover)}</b></span></div><dl className={styles.splitList}>{strategicBreakdown.map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{money(item.value)}</dd></div>)}<div className={styles.cashRow}><dt>Готівковий оборот в основному обороті<small>Рефкей {money(refkeyCash)} · Спецсервіс {money(specservisCash)}</small></dt><dd>{money(model.structure.recordedCash)}</dd></div></dl></div></details>

    <details className={styles.auditDetails}><summary><div><span>ТОЧНІ ДАНІ</span><h2>Усі місяці таблицею</h2><p>Для перевірки конкретної цифри.</p></div><b>{model.months.length} місяців</b><ChevronDown size={19} /></summary><div className={styles.auditBody}><div className={styles.auditControls}><label><Filter size={16} /><select aria-label="Фільтр місячного аудиту" value={auditFilter} onChange={(event) => setAuditFilter(event.target.value as AuditFilter)}><option value="all">Усі місяці</option><option value="missing-payroll">Без даних ФОП</option><option value="payroll-above-turnover">ФОП більший за оборот</option><option value="decline">Падіння до минулого року</option></select><ChevronDown size={14} /></label><label><span>Сортувати:</span><select aria-label="Сортування місячного аудиту" value={auditSort} onChange={(event) => setAuditSort(event.target.value as AuditSort)}><option value="newest">Спочатку нові</option><option value="turnover-desc">Найбільший оборот</option><option value="growth-asc">Найбільше падіння</option><option value="productivity-desc">Найбільший оборот / працівника</option><option value="payroll-share-desc">Найбільша частка ФОП</option></select><ChevronDown size={14} /></label></div><div className={styles.tableWrap}><table><thead><tr><th>Місяць</th><th>Оборот</th><th>До минулого року</th><th>FTE</th><th>Оборот / працівника</th><th>ФОП</th><th>ФОП / оборот</th><th>Готівковий оборот</th><th>Coca-Cola / AB InBev</th></tr></thead><tbody>{auditedMonths.map((month) => { const yoy = growth(month.baseTurnover ?? 0, priorByCurrentPeriod.get(month.period)?.baseTurnover ?? null); const cash = (month.refkeyCash ?? 0) + (month.specservisCash ?? 0); return <tr key={month.period}><td><b>{monthLabel(month.period)}</b></td><td>{month.baseTurnover === null ? "—" : preciseMoney.format(month.baseTurnover)}</td><td className={deltaTone(yoy)}>{percent(yoy, true)}</td><td>{month.fte === null ? "—" : number.format(month.fte)}</td><td>{money(month.turnoverPerFte)}</td><td className={month.payroll === null ? styles.missing : ""}>{month.payroll === null ? "Немає даних" : preciseMoney.format(month.payroll)}</td><td>{percent(month.payrollShare)}</td><td>{preciseMoney.format(cash)}</td><td>{preciseMoney.format(month.strategicTurnover)}</td></tr>; })}</tbody></table>{!auditedMonths.length ? <div className={styles.emptyAudit}>За цим фільтром записів немає.</div> : null}</div></div></details>

    <footer className={styles.footer}><span><LockKeyhole size={14} /> Лише executive.vault</span></footer>
  </div>;
}

export function FinanceDashboard({ dataset: initialDataset }: { dataset?: ConfidentialTurnoverDataset }) {
  const [dataset, setDataset] = useState(initialDataset ?? null), [error, setError] = useState(""), [loading, setLoading] = useState(!initialDataset);
  const load = useCallback(async (signal?: AbortSignal) => { setLoading(true); try { const response = await fetch("/api/confidential/turnover", { cache: "no-store", signal }); if (response.status === 401) { window.location.assign("/login"); return; } if (!response.ok) throw new Error(response.status === 403 ? "Цей акаунт не має доступу до фінансів." : "Не вдалося завантажити фінансові дані."); setDataset(await response.json() as ConfidentialTurnoverDataset); setError(""); } catch (cause) { if (cause instanceof DOMException && cause.name === "AbortError") return; setError(cause instanceof Error ? cause.message : "Не вдалося завантажити фінансові дані."); } finally { if (!signal?.aborted) setLoading(false); } }, []);
  useEffect(() => { if (initialDataset) return; const controller = new AbortController(); fetch("/api/confidential/turnover", { cache: "no-store", signal: controller.signal }).then((response) => { if (response.status === 401) { window.location.assign("/login"); throw new Error("Unauthorized"); } if (!response.ok) throw new Error(response.status === 403 ? "Цей акаунт не має доступу до фінансів." : "Не вдалося завантажити фінансові дані."); return response.json() as Promise<ConfidentialTurnoverDataset>; }).then((payload) => { setDataset(payload); setError(""); }).catch((cause: unknown) => { if (cause instanceof DOMException && cause.name === "AbortError") return; if (cause instanceof Error && cause.message !== "Unauthorized") setError(cause.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); }); return () => controller.abort(); }, [initialDataset]);
  if (!dataset) return <div className={styles.financeState}>{loading ? <LoaderCircle className="spin" size={27} /> : <CircleAlert size={27} />}<h2>{loading ? "Завантажуємо фінансовий огляд" : error}</h2>{!loading ? <button type="button" onClick={() => void load()}><RefreshCw size={16} />Спробувати ще раз</button> : null}</div>;
  return <FinanceContent dataset={dataset} />;
}

export function ConfidentialDashboard({ dataset }: { dataset: ConfidentialTurnoverDataset }) { return <FinanceDashboard dataset={dataset} />; }
