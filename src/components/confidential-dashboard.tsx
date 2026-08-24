"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarRange, ChevronDown, CircleAlert, Filter, LoaderCircle, LockKeyhole, RefreshCw, X } from "lucide-react";
import { buildConfidentialDashboard } from "@/lib/confidential-dashboard";
import type { ConfidentialTurnoverDataset } from "@/lib/confidential-turnover";
import {
  aggregateEntity,
  CumulativeTurnoverChart,
  ExecutiveKpi,
  growth,
  money,
  monthLabel,
  MonthlyTurnoverChart,
  number,
  percent,
  points,
  preciseMoney,
  ScaleGrowthChart,
  TurnoverDonut,
  VarianceDriverChart,
  WorkforceEconomicsChart,
  type EntityId,
} from "./confidential-finance-charts";
import styles from "./confidential-dashboard.module.css";

const ukDate = new Intl.DateTimeFormat("uk-UA", { day: "2-digit", month: "long", year: "numeric", timeZone: "Europe/Kyiv" });

type FactTone = "risk" | "watch" | "neutral";
type OwnerFact = { id: string; title: string; value: string; basis: string; tone: FactTone };
type AuditFilter = "all" | "missing-payroll" | "payroll-above-turnover" | "decline";
type AuditSort = "newest" | "turnover-desc" | "growth-asc" | "productivity-desc" | "payroll-share-desc";

const entityOptions: Array<{ id: EntityId; label: string }> = [
  { id: "all", label: "Уся група" }, { id: "specservis", label: "Спецсервіс" },
  { id: "promtech", label: "Промтехгруп · база" }, { id: "refkey", label: "Рефкей" },
  { id: "naryshkov", label: "ФОП Наришков" }, { id: "pashkov", label: "ФОП Пашков" },
  { id: "danilenko", label: "ФОП Даниленко" },
];

function deltaTone(value: number | null) {
  return value === null ? styles.muted : value >= 0 ? styles.positive : styles.negative;
}

function periodRangeLabel(from: string | null, to: string | null) {
  if (!from || !to) return "немає зіставного періоду";
  return `${monthLabel(from)} — ${monthLabel(to)}`;
}

function buildFacts(model: ReturnType<typeof buildConfidentialDashboard>): OwnerFact[] {
  const missingPayroll = model.months.filter((month) => month.payroll === null);
  const highestPayrollShare = model.months.filter((month) => month.payrollShare !== null).sort((left, right) => (right.payrollShare ?? 0) - (left.payrollShare ?? 0))[0] ?? null;
  const previousMap = new Map(model.comparisonEntityMix.map((item) => [item.id, item.value]));
  const largestMovement = model.entityMix.map((item) => ({ label: item.label, delta: item.value - (previousMap.get(item.id) ?? 0) })).sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta))[0] ?? null;
  const top = model.structure.topEntity;
  return [
    { id: "payroll-completeness", title: "Повнота даних ФОП", value: `${model.summary.payrollMonths}/${model.summary.months} міс.`, basis: missingPayroll.length ? `Немає: ${missingPayroll.map((month) => monthLabel(month.period)).join(", ")}` : "Заповнено всі місяці", tone: missingPayroll.length ? "risk" : "neutral" },
    { id: "payroll-share", title: "Найвища частка ФОП", value: percent(highestPayrollShare?.payrollShare ?? null), basis: highestPayrollShare ? `${monthLabel(highestPayrollShare.period)} · ФОП ${money(highestPayrollShare.payroll)} / оборот ${money(highestPayrollShare.baseTurnover)}` : "Немає даних", tone: (highestPayrollShare?.payrollShare ?? 0) > 1 ? "risk" : "watch" },
    { id: "top-source", title: "Найбільше джерело обороту", value: top ? percent(top.share) : "—", basis: top ? `${top.label} · ${money(top.value)}` : "Немає даних", tone: "neutral" },
    { id: "largest-movement", title: "Найбільший внесок у зміну", value: largestMovement ? money(largestMovement.delta) : "—", basis: largestMovement ? `${largestMovement.label} · проти аналогічного періоду` : "Немає зіставного періоду", tone: largestMovement && largestMovement.delta < 0 ? "watch" : "neutral" },
  ];
}

function FinanceContent({ dataset }: { dataset: ConfidentialTurnoverDataset }) {
  const [rangeId, setRangeId] = useState("ytd"), [entity, setEntity] = useState<EntityId>("all"), [auditFilter, setAuditFilter] = useState<AuditFilter>("all"), [auditSort, setAuditSort] = useState<AuditSort>("newest");
  const model = useMemo(() => buildConfidentialDashboard(dataset.records, rangeId), [dataset.records, rangeId]);
  const summary = model.summary, latest = model.months.at(-1) ?? null, missingPayrollMonths = model.months.filter((month) => month.payroll === null);
  const facts = useMemo(() => buildFacts(model), [model]);
  const selectedEntity = entityOptions.find((option) => option.id === entity) ?? entityOptions[0];
  const selectedTotal = aggregateEntity(model.months, entity), priorTotal = model.comparisonMonths.length === model.months.length ? aggregateEntity(model.comparisonMonths, entity) : null, selectedGrowth = growth(selectedTotal, priorTotal);
  const quickOptions = model.options.filter((option) => option.id === "ytd" || option.id === "12m");
  const latestYear = latest?.period.slice(0, 4);
  const archiveOptions = model.options.filter((option) => option.id !== "ytd" && option.id !== "12m" && option.id !== latestYear);
  const selectableIds = new Set(entityOptions.map((option) => option.id));
  const priorByCurrentPeriod = new Map(model.comparisonMonths.map((month) => [`${Number(month.period.slice(0, 4)) + 1}${month.period.slice(4)}`, month]));
  const auditedMonths = [...model.months].filter((month) => auditFilter === "all" || (auditFilter === "missing-payroll" && month.payroll === null) || (auditFilter === "payroll-above-turnover" && (month.payrollShare ?? 0) > 1) || (auditFilter === "decline" && (growth(month.baseTurnover ?? 0, priorByCurrentPeriod.get(month.period)?.baseTurnover ?? null) ?? 0) < 0)).sort((left, right) => auditSort === "turnover-desc" ? (right.baseTurnover ?? 0) - (left.baseTurnover ?? 0) : auditSort === "growth-asc" ? (growth(left.baseTurnover ?? 0, priorByCurrentPeriod.get(left.period)?.baseTurnover ?? null) ?? Number.MAX_SAFE_INTEGER) - (growth(right.baseTurnover ?? 0, priorByCurrentPeriod.get(right.period)?.baseTurnover ?? null) ?? Number.MAX_SAFE_INTEGER) : auditSort === "productivity-desc" ? (right.turnoverPerFte ?? -1) - (left.turnoverPerFte ?? -1) : auditSort === "payroll-share-desc" ? (right.payrollShare ?? -1) - (left.payrollShare ?? -1) : right.period.localeCompare(left.period));
  const history = model.history.slice(-4), currentComparable = model.history.at(-1) ?? null, previousComparable = model.history.at(-2) ?? null;
  const comparisonPeriod = periodRangeLabel(previousComparable?.from ?? null, previousComparable?.to ?? null);
  const strategicBreakdown = [
    { label: "Coca-Cola · Промтехгруп", value: model.months.reduce((total, month) => total + (month.cocaColaPromtech ?? 0), 0) },
    { label: "Coca-Cola · Спецсервіс", value: model.months.reduce((total, month) => total + (month.cocaColaSpecservis ?? 0), 0) },
    { label: "AB InBev", value: model.months.reduce((total, month) => total + (month.abinbev ?? 0), 0) },
  ];
  const refkeyCash = model.months.reduce((total, month) => total + (month.refkeyCash ?? 0), 0), specservisCash = model.months.reduce((total, month) => total + (month.specservisCash ?? 0), 0);

  return <div className={`owner-stack ${styles.financeApp}`}>
    <section className={styles.toolbar} aria-label="Період фінансового огляду"><div className={styles.toolbarTitle}><CalendarRange size={18} /><span><b>Фінансовий огляд</b><small>Дані по {monthLabel(latest?.period ?? null)} · файл оновлено {ukDate.format(new Date(dataset.source.modifiedAt))}</small></span></div><div className={styles.periodSwitch}>{quickOptions.map((option) => <button type="button" key={option.id} aria-pressed={rangeId === option.id} className={rangeId === option.id ? styles.activePeriod : ""} onClick={() => setRangeId(option.id)}>{option.id === "ytd" ? "YTD" : "12 місяців"}</button>)}<label><select aria-label="Календарний період" value={quickOptions.some((option) => option.id === rangeId) ? "" : rangeId} onChange={(event) => event.target.value && setRangeId(event.target.value)}><option value="" disabled>Рік / історія</option>{archiveOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select><ChevronDown size={14} /></label></div><div className={styles.toolbarPeriod}><b>{model.range.label}</b><span>{periodRangeLabel(currentComparable?.from ?? null, currentComparable?.to ?? null)}</span></div></section>

    <section className={styles.kpiSection} aria-label="ОСНОВНІ ПОКАЗНИКИ"><div className={styles.kpiSectionTitle}><span>ОСНОВНІ ПОКАЗНИКИ</span><b>{model.range.label} · {summary.months} міс.</b></div><div className={styles.kpiGrid}><ExecutiveKpi label="Оборот групи" value={money(summary.baseTurnover)} note="Без Coca-Cola та AB InBev" comparison={`Попередній період: ${money(model.comparison?.baseTurnover ?? null)}`} delta={model.growth.baseTurnover} history={history.map((period) => period.baseTurnover)} historyLabels={history.map((period) => period.label)} /><ExecutiveKpi label={`Оборот / FTE · ${monthLabel(latest?.period ?? null)}`} value={money(summary.lastTurnoverPerFte)} note="Останній місяць" comparison={`Рік тому: ${money(model.comparison?.lastTurnoverPerFte ?? null)}`} delta={growth(summary.lastTurnoverPerFte, model.comparison?.lastTurnoverPerFte ?? null)} history={history.map((period) => period.lastTurnoverPerFte)} historyLabels={history.map((period) => period.label)} /><ExecutiveKpi label="Середній оборот / FTE" value={money(summary.turnoverPerFte)} note={`Середнє за ${summary.months} міс.`} comparison={`Попередній період: ${money(model.comparison?.turnoverPerFte ?? null)}`} delta={model.growth.turnoverPerFte} history={history.map((period) => period.turnoverPerFte)} historyLabels={history.map((period) => period.label)} /><ExecutiveKpi label="Середня команда" value={summary.avgFte === null ? "—" : `${number.format(summary.avgFte)} FTE`} note={`Останній місяць: ${summary.lastFte === null ? "—" : number.format(summary.lastFte)} FTE`} comparison={`Попередній період: ${model.comparison?.avgFte === null || model.comparison?.avgFte === undefined ? "—" : `${number.format(model.comparison.avgFte)} FTE`}`} delta={model.growth.avgFte} history={history.map((period) => period.avgFte)} historyLabels={history.map((period) => period.label)} formatter={(value) => value === null ? "—" : `${number.format(value)} FTE`} /></div></section>

    {missingPayrollMonths.length ? <div className={styles.qualityNote}><CircleAlert size={17} /><span><b>ФОП заповнений за {summary.payrollMonths} із {summary.months} місяців.</b> Немає даних за {missingPayrollMonths.map((month) => monthLabel(month.period)).join(", ")}; показники ФОП рахуються лише за заповненими місяцями.</span></div> : null}

    <section className={`role-panel ${styles.trajectoryPanel}`}><header><div><span>ДИНАМІКА ЗА РОКАМИ</span><h2>Оборот за однакові місяці</h2></div><b>{percent(model.growth.baseTurnover, true)} р/р</b></header><CumulativeTurnoverChart key={model.range.id} history={model.history} /><details className={styles.exactDetails}><summary>Точні значення за роками <ChevronDown size={16} /></summary><div className={styles.tableWrap}><table><thead><tr><th>Період</th><th>Оборот</th><th>Оборот / FTE · останній місяць</th><th>Оборот / FTE · середнє</th><th>Середня команда</th></tr></thead><tbody>{history.map((period) => <tr key={period.id}><td><b>{period.label}</b><small>{periodRangeLabel(period.from, period.to)}</small></td><td>{preciseMoney.format(period.baseTurnover)}</td><td>{period.lastTurnoverPerFte === null ? "—" : preciseMoney.format(period.lastTurnoverPerFte)}</td><td>{period.turnoverPerFte === null ? "—" : preciseMoney.format(period.turnoverPerFte)}</td><td>{period.avgFte === null ? "—" : `${number.format(period.avgFte)} FTE`}</td></tr>)}</tbody></table></div></details></section>

    <section className={styles.businessGrid}><article className={`role-panel ${styles.structurePanel}`}><header><div><span>СТРУКТУРА</span><h2>Хто формує оборот</h2></div><b>{model.structure.topEntity ? `${model.structure.topEntity.label} · ${percent(model.structure.topEntity.share)}` : "—"}</b></header><TurnoverDonut items={model.entityMix} total={summary.baseTurnover} selected={entity} onSelect={setEntity} selectableIds={selectableIds} /></article><article className={`role-panel ${styles.monthlyPanel}`}><header><div><span>ОБОРОТ ЗА МІСЯЦЯМИ</span><h2>{selectedEntity.label}</h2></div><div className={styles.panelTotal}><b>{money(selectedTotal)}</b><small className={deltaTone(selectedGrowth)}>{percent(selectedGrowth, true)} р/р</small></div></header><div className={styles.chartKey}><span><i className={styles.currentKey} />{periodRangeLabel(currentComparable?.from ?? null, currentComparable?.to ?? null)}</span><span><i className={styles.priorKey} />{comparisonPeriod}</span>{entity !== "all" ? <button type="button" onClick={() => setEntity("all")}><X size={13} />Уся група</button> : null}</div><div className={styles.monthlyScroll}><MonthlyTurnoverChart key={`${model.range.id}:${entity}`} current={model.months} comparison={model.comparisonMonths} entity={entity} /></div></article></section>

    <section className={styles.analysisGrid}><article className="role-panel"><header><div><span>ЗМІНА ДО ПОПЕРЕДНЬОГО РОКУ</span><h2>Внесок компаній</h2></div></header>{model.comparisonEntityMix.length ? <VarianceDriverChart current={model.entityMix} previous={model.comparisonEntityMix} currentLabel={periodRangeLabel(currentComparable?.from ?? null, currentComparable?.to ?? null)} previousLabel={comparisonPeriod} /> : <p className={styles.emptyChart}>Немає повного зіставного періоду.</p>}</article><article className="role-panel"><header><div><span>ОБОРОТ І КОМАНДА</span><h2>Темп накопиченим підсумком</h2></div></header><ScaleGrowthChart key={model.range.id} current={model.months} comparison={model.comparisonMonths} /></article></section>

    <section className={styles.managementGrid}><article className={`role-panel ${styles.workforcePanel}`}><header><div><span>ЕКОНОМІКА КОМАНДИ</span><h2>Оборот і ФОП на 1 FTE</h2></div><b>{summary.payrollMonths}/{summary.months} міс. ФОП</b></header><div className={styles.economicsMetrics}><div><span>ФОП / FTE</span><strong>{money(summary.payrollPerFte)}</strong></div><div><span>ФОП / оборот</span><strong>{percent(summary.payrollShare)}</strong></div><div><span>Темп ФОП мінус темп обороту</span><strong className={deltaTone(model.payrollEconomics?.payrollGrowthGap ?? null)}>{points(model.payrollEconomics?.payrollGrowthGap ?? null)}</strong></div></div><WorkforceEconomicsChart key={model.range.id} months={model.months} /></article><details className={styles.secondaryDetails}><summary><div><span>ОКРЕМИЙ ЗРІЗ</span><h2>Контракти поза базовим оборотом</h2><p>Coca-Cola та AB InBev</p></div><b>{money(summary.strategicTurnover)}</b><ChevronDown size={18} /></summary><div className={styles.secondaryBody}><div className={styles.reconciliationEquation}><span><small>Базовий оборот</small><b>{money(summary.baseTurnover)}</b></span><i>+</i><span><small>Окремі контракти</small><b>{money(summary.strategicTurnover)}</b></span><i>=</i><span><small>Разом із контрактами</small><b>{money(summary.grossTurnover)}</b></span></div><dl className={styles.splitList}>{strategicBreakdown.map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{money(item.value)}</dd></div>)}<div className={styles.cashRow}><dt>Оборот готівкою у складі базового<small>Рефкей {money(refkeyCash)} · Спецсервіс {money(specservisCash)}</small></dt><dd>{money(model.structure.recordedCash)}</dd></div></dl></div></details></section>

    <section className={`owner-section ${styles.ownerFocusCompact}`}><header><div><span>ФАКТИ ДЛЯ ПЕРЕВІРКИ</span><h2>Короткий контрольний список</h2></div></header><div className={styles.ownerFactsTable}><div className={styles.factHead}><span>Факт</span><span>Значення</span><span>Основа</span></div>{facts.map((fact) => <div key={fact.id} className={styles.factRow}><div><i className={styles[fact.tone]} /><b>{fact.title}</b></div><strong className={styles[fact.tone]}>{fact.value}</strong><p>{fact.basis}</p></div>)}</div></section>

    <details className={styles.auditDetails}><summary><div><span>ДЕТАЛІ ТА ПЕРЕВІРКА</span><h2>Місячні дані</h2><p>Точні значення за кожен місяць</p></div><b>{model.months.length} місяців</b><ChevronDown size={19} /></summary><div className={styles.auditBody}><div className={styles.auditControls}><label><Filter size={16} /><select aria-label="Фільтр місячного аудиту" value={auditFilter} onChange={(event) => setAuditFilter(event.target.value as AuditFilter)}><option value="all">Усі місяці</option><option value="missing-payroll">Без даних ФОП</option><option value="payroll-above-turnover">ФОП більший за оборот</option><option value="decline">Падіння обороту р/р</option></select><ChevronDown size={14} /></label><label><span>Сортувати:</span><select aria-label="Сортування місячного аудиту" value={auditSort} onChange={(event) => setAuditSort(event.target.value as AuditSort)}><option value="newest">Спочатку нові</option><option value="turnover-desc">Найбільший оборот</option><option value="growth-asc">Найгірша динаміка р/р</option><option value="productivity-desc">Найвищий оборот / FTE</option><option value="payroll-share-desc">Найвища частка ФОП</option></select><ChevronDown size={14} /></label></div><div className={styles.tableWrap}><table><thead><tr><th>Місяць</th><th>Оборот</th><th>Зміна р/р</th><th>FTE</th><th>Оборот / FTE</th><th>ФОП</th><th>ФОП / оборот</th><th>Готівковий оборот</th><th>Coca-Cola / AB InBev</th></tr></thead><tbody>{auditedMonths.map((month) => { const yoy = growth(month.baseTurnover ?? 0, priorByCurrentPeriod.get(month.period)?.baseTurnover ?? null); const cash = (month.refkeyCash ?? 0) + (month.specservisCash ?? 0); return <tr key={month.period}><td><b>{monthLabel(month.period)}</b></td><td>{month.baseTurnover === null ? "—" : preciseMoney.format(month.baseTurnover)}</td><td className={deltaTone(yoy)}>{percent(yoy, true)}</td><td>{month.fte === null ? "—" : number.format(month.fte)}</td><td>{money(month.turnoverPerFte)}</td><td className={month.payroll === null ? styles.missing : ""}>{month.payroll === null ? "Немає даних" : preciseMoney.format(month.payroll)}</td><td>{percent(month.payrollShare)}</td><td>{preciseMoney.format(cash)}</td><td>{preciseMoney.format(month.strategicTurnover)}</td></tr>; })}</tbody></table>{!auditedMonths.length ? <div className={styles.emptyAudit}>За цим фільтром записів немає.</div> : null}</div></div></details>

    <footer className={styles.footer}><span><LockKeyhole size={14} /> Лише executive.vault</span><p>{dataset.source.fileName} · SHA {dataset.source.sha256.slice(0, 10)}…</p></footer>
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
