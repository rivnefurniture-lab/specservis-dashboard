"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarRange, ChevronDown, CircleAlert, Filter, LoaderCircle, LockKeyhole, RefreshCw, X } from "lucide-react";
import { buildConfidentialDashboard, type ConfidentialDashboardModel } from "@/lib/confidential-dashboard";
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
  preciseMoney,
  ScaleGrowthChart,
  TurnoverDonut,
  VarianceDriverChart,
  type EntityId,
} from "./confidential-finance-charts";
import styles from "./confidential-dashboard.module.css";

const ukDate = new Intl.DateTimeFormat("uk-UA", { day: "2-digit", month: "long", year: "numeric", timeZone: "Europe/Kyiv" });

type SignalTone = "good" | "risk" | "watch" | "neutral";
type OwnerSignal = { id: string; title: string; value: string; detail: string; action: string; tone: SignalTone; priority: number };
type AuditFilter = "all" | "missing-payroll" | "payroll-pressure" | "decline";
type AuditSort = "newest" | "turnover-desc" | "growth-asc" | "productivity-desc" | "payroll-share-desc";

const entityOptions: Array<{ id: EntityId; label: string }> = [
  { id: "all", label: "Уся група" }, { id: "specservis", label: "Спецсервіс" },
  { id: "promtech", label: "Промтехгруп · база" }, { id: "refkey", label: "Рефкей" },
  { id: "naryshkov", label: "ФОП Наришков" }, { id: "pashkov", label: "ФОП Пашков" },
  { id: "danilenko", label: "ФОП Даниленко" },
];

function points(value: number | null) {
  return value === null ? "—" : `${new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 1, signDisplay: "always" }).format(value * 100)} п.п.`;
}

function deltaTone(value: number | null) {
  return value === null ? styles.muted : value >= 0 ? styles.positive : styles.negative;
}

function directorConclusion(model: ConfidentialDashboardModel) {
  const turnover = model.growth.baseTurnover;
  const productivity = model.growth.turnoverPerFte;
  if (turnover === null) return "Для висновку ще немає зіставного періоду.";
  if (turnover >= 0 && productivity !== null && productivity >= 0) return "Оборот і продуктивність зростають — масштабування працює.";
  if (turnover >= 0) return "Оборот зростає, але продуктивність команди потребує уваги.";
  if (productivity !== null && productivity >= 0) return "Команда ефективна, але бізнес втрачає обсяг — перевірте джерела обороту.";
  return "Одночасно знижуються оборот і продуктивність — потрібен план відновлення.";
}

function buildSignals(model: ConfidentialDashboardModel, missingPayroll: number): OwnerSignal[] {
  const turnoverGrowth = model.growth.baseTurnover, productivityGrowth = model.growth.turnoverPerFte, payroll = model.payrollEconomics, top = model.structure.topEntity;
  return [
    ...(missingPayroll ? [{ id: "quality", title: "Неповний ФОП", value: `${missingPayroll} міс.`, detail: "Витрати на персонал за період неповні.", action: "Дозаповнити ФОП перед рішенням про найм або премії.", tone: "risk" as const, priority: 0 }] : []),
    { id: "payroll", title: payroll?.payrollGrowthGap !== null && payroll?.payrollGrowthGap !== undefined && payroll.payrollGrowthGap > .03 ? "ФОП росте швидше" : "ФОП під контролем", value: points(payroll?.payrollGrowthGap ?? null), detail: payroll ? `ФОП ${percent(payroll.payrollGrowth, true)}, оборот ${percent(payroll.baseGrowth, true)}.` : "Немає повної бази.", action: payroll?.payrollGrowthGap && payroll.payrollGrowthGap > .03 ? "Перевірити найм, премії та завантаження." : "Утримувати ФОП не вище темпу обороту.", tone: payroll?.payrollGrowthGap === null || payroll?.payrollGrowthGap === undefined ? "neutral" as const : payroll.payrollGrowthGap > .03 ? "risk" as const : "good" as const, priority: payroll?.payrollGrowthGap && payroll.payrollGrowthGap > .03 ? 1 : 4 },
    { id: "productivity", title: productivityGrowth !== null && productivityGrowth >= 0 ? "Масштабування ефективне" : "Продуктивність падає", value: percent(productivityGrowth, true), detail: `Команда ${number.format(model.summary.avgFte ?? 0)} FTE, ${percent(model.growth.avgFte, true)} р/р.`, action: productivityGrowth !== null && productivityGrowth < 0 ? "Знайти місяці, де FTE росте без обороту." : "Зберегти продуктивність під час найму.", tone: productivityGrowth === null ? "neutral" as const : productivityGrowth >= 0 ? "good" as const : "risk" as const, priority: productivityGrowth !== null && productivityGrowth < 0 ? 1 : 5 },
    { id: "concentration", title: top && top.share > .65 ? "Висока концентрація" : "Структура стійка", value: top ? percent(top.share) : "—", detail: top ? `${top.label} — найбільше джерело обороту.` : "Недостатньо даних.", action: top && top.share > .65 ? "Підготувати резерв заміщення потоку." : "Контролювати частку топ-3 щомісяця.", tone: top && top.share > .65 ? "watch" as const : "good" as const, priority: top && top.share > .65 ? 2 : 5 },
    { id: "turnover", title: turnoverGrowth !== null && turnoverGrowth >= 0 ? "Оборот зростає" : "Оборот скорочується", value: percent(turnoverGrowth, true), detail: `${money(model.summary.baseTurnover)} за ${model.range.label}.`, action: turnoverGrowth !== null && turnoverGrowth < 0 ? "Розкласти падіння за компаніями." : "Закріпити джерела основного приросту.", tone: turnoverGrowth === null ? "neutral" as const : turnoverGrowth >= 0 ? "good" as const : "risk" as const, priority: turnoverGrowth !== null && turnoverGrowth < 0 ? 1 : 6 },
  ].sort((left, right) => left.priority - right.priority);
}

function FinanceContent({ dataset }: { dataset: ConfidentialTurnoverDataset }) {
  const [rangeId, setRangeId] = useState("ytd"), [entity, setEntity] = useState<EntityId>("all"), [auditFilter, setAuditFilter] = useState<AuditFilter>("all"), [auditSort, setAuditSort] = useState<AuditSort>("newest");
  const model = useMemo(() => buildConfidentialDashboard(dataset.records, rangeId), [dataset.records, rangeId]);
  const summary = model.summary, latest = model.months.at(-1) ?? null, missingPayroll = summary.months - summary.payrollMonths;
  const signals = useMemo(() => buildSignals(model, missingPayroll), [model, missingPayroll]);
  const selectedEntity = entityOptions.find((option) => option.id === entity) ?? entityOptions[0];
  const selectedTotal = aggregateEntity(model.months, entity), priorTotal = model.comparisonMonths.length === model.months.length ? aggregateEntity(model.comparisonMonths, entity) : null, selectedGrowth = growth(selectedTotal, priorTotal);
  const quickOptions = model.options.filter((option) => option.id === "ytd" || option.id === "12m"), archiveOptions = model.options.filter((option) => option.id !== "ytd" && option.id !== "12m");
  const selectableIds = new Set(entityOptions.map((option) => option.id));
  const priorByCurrentPeriod = new Map(model.comparisonMonths.map((month) => [`${Number(month.period.slice(0, 4)) + 1}${month.period.slice(4)}`, month]));
  const auditedMonths = [...model.months].filter((month) => auditFilter === "all" || (auditFilter === "missing-payroll" && month.payroll === null) || (auditFilter === "payroll-pressure" && (month.payrollShare ?? 0) >= .35) || (auditFilter === "decline" && (growth(month.baseTurnover ?? 0, priorByCurrentPeriod.get(month.period)?.baseTurnover ?? null) ?? 0) < 0)).sort((left, right) => auditSort === "turnover-desc" ? (right.baseTurnover ?? 0) - (left.baseTurnover ?? 0) : auditSort === "growth-asc" ? (growth(left.baseTurnover ?? 0, priorByCurrentPeriod.get(left.period)?.baseTurnover ?? null) ?? Number.MAX_SAFE_INTEGER) - (growth(right.baseTurnover ?? 0, priorByCurrentPeriod.get(right.period)?.baseTurnover ?? null) ?? Number.MAX_SAFE_INTEGER) : auditSort === "productivity-desc" ? (right.turnoverPerFte ?? -1) - (left.turnoverPerFte ?? -1) : auditSort === "payroll-share-desc" ? (right.payrollShare ?? -1) - (left.payrollShare ?? -1) : right.period.localeCompare(left.period));
  const history = model.history.slice(-4);

  return <div className={`owner-stack ${styles.financeApp}`}>
    <section className={styles.toolbar} aria-label="Період фінансового огляду"><div className={styles.toolbarTitle}><CalendarRange size={18} /><span><b>Фінансовий огляд</b><small>Оновлено {ukDate.format(new Date(dataset.source.modifiedAt))}</small></span></div><div className={styles.periodSwitch}>{quickOptions.map((option) => <button type="button" key={option.id} aria-pressed={rangeId === option.id} className={rangeId === option.id ? styles.activePeriod : ""} onClick={() => setRangeId(option.id)}>{option.id === "ytd" ? "YTD" : "12 місяців"}</button>)}<label><select aria-label="Календарний рік" value={quickOptions.some((option) => option.id === rangeId) ? "" : rangeId} onChange={(event) => event.target.value && setRangeId(event.target.value)}><option value="" disabled>Інший рік</option>{archiveOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select><ChevronDown size={14} /></label></div><div className={styles.toolbarPeriod}><b>{model.range.label}</b><span>{summary.months} місяців</span></div></section>

    <section className={`owner-page-head ${styles.directorHead}`}><div className={styles.heroResult}><span>ОПЕРАЦІЙНИЙ ОБОРОТ ГРУПИ</span><h1>{money(summary.baseTurnover)}</h1><div><b className={model.growth.baseTurnover === null ? "" : model.growth.baseTurnover >= 0 ? styles.heroPositive : styles.heroNegative}>{percent(model.growth.baseTurnover, true)} р/р</b><small>{model.range.label} · без Coca-Cola та AB InBev</small></div></div><div className={styles.heroConclusion}><span>ЩО ЦЕ ОЗНАЧАЄ</span><strong>{directorConclusion(model)}</strong><small>{missingPayroll ? `ФОП заповнений за ${summary.payrollMonths} із ${summary.months} місяців.` : "Дані за обраний період повні."}</small></div></section>

    <section className={styles.kpiGrid} aria-label="Ключові показники директора"><ExecutiveKpi label="Оборот групи" value={money(summary.baseTurnover)} note="Накопичено за період" delta={model.growth.baseTurnover} history={history.map((period) => period.baseTurnover)} /><ExecutiveKpi label={`Продуктивність · ${monthLabel(latest?.period ?? null)}`} value={money(summary.lastTurnoverPerFte)} note="Оборот останнього місяця / FTE" delta={growth(summary.lastTurnoverPerFte, model.comparison?.lastTurnoverPerFte ?? null)} history={history.map((period) => period.lastTurnoverPerFte)} /><ExecutiveKpi label="Середня продуктивність" value={money(summary.turnoverPerFte)} note="Середнє місячних значень / FTE" delta={model.growth.turnoverPerFte} history={history.map((period) => period.turnoverPerFte)} /><ExecutiveKpi label="Середня команда" value={summary.avgFte === null ? "—" : `${number.format(summary.avgFte)} FTE`} note={`Останній місяць: ${summary.lastFte === null ? "—" : number.format(summary.lastFte)}`} delta={model.growth.avgFte} history={history.map((period) => period.avgFte)} formatter={(value) => value === null ? "—" : `${number.format(value)} FTE`} /></section>

    {missingPayroll ? <div className={styles.qualityNote}><CircleAlert size={17} /><span><b>ФОП неповний.</b> Висновки про витрати на людей рахуються лише за {summary.payrollMonths} заповненими місяцями.</span></div> : null}

    <section className={`role-panel ${styles.trajectoryPanel}`}><header><div><span>ЧИ ВИКОНУЄМО ТЕМП</span><h2>Накопичений оборот за однаковий період</h2><p>Лінія поточного року має йти вище торішніх — це найшвидша перевірка темпу бізнесу.</p></div><b>{percent(model.growth.baseTurnover, true)} р/р</b></header><CumulativeTurnoverChart history={model.history} /><details className={styles.exactDetails}><summary>Показати точні значення за роками <ChevronDown size={16} /></summary><div className={styles.tableWrap}><table><thead><tr><th>Період</th><th>Оборот</th><th>На 1 FTE · останній місяць</th><th>На 1 FTE · середнє</th><th>Середня команда</th></tr></thead><tbody>{history.map((period) => <tr key={period.id}><td><b>{period.label}</b><small>{monthLabel(period.from)} — {monthLabel(period.to)}</small></td><td>{preciseMoney.format(period.baseTurnover)}</td><td>{period.lastTurnoverPerFte === null ? "—" : preciseMoney.format(period.lastTurnoverPerFte)}</td><td>{period.turnoverPerFte === null ? "—" : preciseMoney.format(period.turnoverPerFte)}</td><td>{period.avgFte === null ? "—" : `${number.format(period.avgFte)} FTE`}</td></tr>)}</tbody></table></div></details></section>

    <section className={styles.businessGrid}><article className={`role-panel ${styles.structurePanel}`}><header><div><span>З ЧОГО СКЛАДАЄТЬСЯ РЕЗУЛЬТАТ</span><h2>Структура обороту</h2></div><b>{percent(model.structure.topThreeShare)} · топ-3</b></header><TurnoverDonut items={model.entityMix} total={summary.baseTurnover} selected={entity} onSelect={setEntity} selectableIds={selectableIds} /></article><article className={`role-panel ${styles.monthlyPanel}`}><header><div><span>ДЕ БУЛИ СИЛЬНІ ТА СЛАБКІ МІСЯЦІ</span><h2>{selectedEntity.label} · оборот за місяць</h2></div><div className={styles.panelTotal}><b>{money(selectedTotal)}</b><small className={deltaTone(selectedGrowth)}>{percent(selectedGrowth, true)} р/р</small></div></header><div className={styles.chartKey}><span><i className={styles.currentKey} />Зараз</span><span><i className={styles.priorKey} />Торік</span>{entity !== "all" ? <button type="button" onClick={() => setEntity("all")}><X size={13} />Уся група</button> : null}</div><div className={styles.monthlyScroll}><MonthlyTurnoverChart current={model.months} comparison={model.comparisonMonths} entity={entity} /></div></article></section>

    <section className={styles.analysisGrid}><article className="role-panel"><header><div><span>ЩО ДАЛО ЗМІНУ</span><h2>Внесок компаній у приріст або падіння</h2><p>Смуги праворуч додають оборот, ліворуч — забирають.</p></div></header>{model.comparisonEntityMix.length ? <VarianceDriverChart current={model.entityMix} previous={model.comparisonEntityMix} /> : <p className={styles.emptyChart}>Немає повного зіставного періоду.</p>}</article><article className="role-panel"><header><div><span>ЧИ ЕФЕКТИВНО МАСШТАБУЄМОСЯ</span><h2>Оборот проти зростання команди</h2><p>Оборот має зростати швидше за чисельність.</p></div></header><ScaleGrowthChart current={model.months} comparison={model.comparisonMonths} /></article></section>

    <section className={styles.managementGrid}><article className="role-panel"><header><div><span>ЕКОНОМІКА КОМАНДИ</span><h2>ФОП у контексті обороту</h2></div><b>{summary.payrollMonths}/{summary.months} міс.</b></header><div className={styles.economicsRows}><div><span>ФОП на 1 FTE / місяць<small>Скільки в середньому коштує один FTE</small></span><strong>{money(summary.payrollPerFte)}</strong></div><div><span>Частка ФОП в обороті<small>Менша частка означає більший запас</small></span><strong>{percent(summary.payrollShare)}</strong></div><div><span>ФОП проти темпу обороту<small>Плюс означає, що ФОП росте швидше</small></span><strong className={deltaTone(model.payrollEconomics?.payrollGrowthGap ?? null)}>{points(model.payrollEconomics?.payrollGrowthGap ?? null)}</strong></div></div></article><details className={styles.secondaryDetails}><summary><div><span>ПОЗА ОСНОВНИМ ФОКУСОМ</span><h2>Ключові контракти</h2><p>Coca-Cola та AB InBev показані окремо</p></div><b>{money(summary.strategicTurnover)}</b><ChevronDown size={18} /></summary><div className={styles.secondaryBody}><dl className={styles.splitList}><div><dt>Оборот групи</dt><dd>{money(summary.baseTurnover)}</dd></div><div><dt>Ключові контракти</dt><dd>{money(summary.strategicTurnover)}</dd></div><div><dt>Разом для звірки</dt><dd>{money(summary.grossTurnover)}</dd></div><div><dt>Зафіксована готівка</dt><dd>{money(model.structure.recordedCash)}</dd></div></dl></div></details></section>

    <section className={`owner-section ${styles.ownerFocusCompact}`}><header><div><span>РІШЕННЯ ДЛЯ ВЛАСНИКА</span><h2>На що звернути увагу зараз</h2></div></header><div className={styles.ownerSignalsTable}><div className={styles.signalHead}><span>Сигнал</span><span>Значення</span><span>Рішення</span></div>{signals.slice(0, 4).map((signal) => <div key={signal.id} className={styles.signalRow}><div><i className={styles[signal.tone]} /><span><b>{signal.title}</b><small>{signal.detail}</small></span></div><strong className={styles[signal.tone]}>{signal.value}</strong><p>{signal.action}</p></div>)}</div></section>

    <details className={styles.auditDetails}><summary><div><span>ДЕТАЛІ ТА ПЕРЕВІРКА</span><h2>Місячні дані</h2><p>Відкрийте, коли потрібно знайти конкретний проблемний місяць.</p></div><b>{model.months.length} місяців</b><ChevronDown size={19} /></summary><div className={styles.auditBody}><div className={styles.auditControls}><label><Filter size={16} /><select aria-label="Фільтр місячного аудиту" value={auditFilter} onChange={(event) => setAuditFilter(event.target.value as AuditFilter)}><option value="all">Усі місяці</option><option value="missing-payroll">Без даних ФОП</option><option value="payroll-pressure">ФОП / оборот ≥ 35%</option><option value="decline">Падіння обороту р/р</option></select><ChevronDown size={14} /></label><label><span>Сортувати:</span><select aria-label="Сортування місячного аудиту" value={auditSort} onChange={(event) => setAuditSort(event.target.value as AuditSort)}><option value="newest">Спочатку нові</option><option value="turnover-desc">Найбільший оборот</option><option value="growth-asc">Найгірша динаміка р/р</option><option value="productivity-desc">Найвища продуктивність</option><option value="payroll-share-desc">Найвища частка ФОП</option></select><ChevronDown size={14} /></label></div><div className={styles.tableWrap}><table><thead><tr><th>Місяць</th><th>Оборот</th><th>Зміна р/р</th><th>FTE</th><th>Оборот / FTE</th><th>ФОП</th><th>ФОП / оборот</th><th>Ключові контракти</th></tr></thead><tbody>{auditedMonths.map((month) => { const yoy = growth(month.baseTurnover ?? 0, priorByCurrentPeriod.get(month.period)?.baseTurnover ?? null); return <tr key={month.period}><td><b>{monthLabel(month.period)}</b></td><td>{month.baseTurnover === null ? "—" : preciseMoney.format(month.baseTurnover)}</td><td className={deltaTone(yoy)}>{percent(yoy, true)}</td><td>{month.fte === null ? "—" : number.format(month.fte)}</td><td>{money(month.turnoverPerFte)}</td><td className={month.payroll === null ? styles.missing : ""}>{month.payroll === null ? "Немає даних" : preciseMoney.format(month.payroll)}</td><td>{percent(month.payrollShare)}</td><td>{preciseMoney.format(month.strategicTurnover)}</td></tr>; })}</tbody></table>{!auditedMonths.length ? <div className={styles.emptyAudit}>За цим фільтром аномалій немає.</div> : null}</div></div></details>

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
