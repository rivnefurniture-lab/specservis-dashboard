"use client";

import { useState } from "react";
import type { ComparableTurnover, EntityMix, TurnoverMonth } from "@/lib/confidential-dashboard";
import styles from "./confidential-dashboard.module.css";

export type EntityId = "all" | "specservis" | "promtech" | "refkey" | "naryshkov" | "pashkov" | "danilenko";

export const preciseMoney = new Intl.NumberFormat("uk-UA", { style: "currency", currency: "UAH", currencyDisplay: "narrowSymbol", maximumFractionDigits: 0 });
export const number = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 1 });
const ukMonth = new Intl.DateTimeFormat("uk-UA", { month: "short", year: "2-digit", timeZone: "UTC" });
const palette = ["#292477", "#4b91c4", "#49a47b", "#d88b45", "#7c72b2", "#8d93a8", "#b7bdca"];

export function money(value: number | null) {
  if (value === null) return "—";
  const absolute = Math.abs(value);
  const unit = absolute >= 1_000_000_000 ? [1_000_000_000, "млрд"] as const : absolute >= 1_000_000 ? [1_000_000, "млн"] as const : absolute >= 1_000 ? [1_000, "тис."] as const : [1, ""] as const;
  const formatted = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: unit[0] === 1 ? 0 : 1 }).format(absolute / unit[0]);
  return `${value < 0 ? "−" : ""}₴${formatted}${unit[1] ? ` ${unit[1]}` : ""}`;
}

export function percent(value: number | null, signed = false) {
  if (value === null) return "—";
  return new Intl.NumberFormat("uk-UA", { style: "percent", maximumFractionDigits: 1, signDisplay: signed ? "always" : "auto" }).format(value);
}

export function points(value: number | null) {
  return value === null ? "—" : `${new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 1, signDisplay: "always" }).format(value * 100)} п.п.`;
}

export function monthLabel(period: string | null) {
  return period ? ukMonth.format(new Date(`${period}-01T00:00:00Z`)).replace(" р.", "") : "—";
}

export function growth(current: number | null, previous: number | null) {
  return current === null || previous === null || previous === 0 ? null : current / previous - 1;
}

export function entityValue(month: TurnoverMonth, entity: EntityId) {
  if (entity === "all") return month.baseTurnover ?? 0;
  if (entity === "specservis") return (month.specservisBank ?? 0) + (month.specservisCash ?? 0);
  if (entity === "promtech") return month.promtechCore ?? 0;
  if (entity === "refkey") return (month.refkeyBank ?? 0) + (month.refkeyCash ?? 0);
  if (entity === "naryshkov") return month.fopNaryshkov ?? 0;
  if (entity === "pashkov") return month.fopPashkov ?? 0;
  return month.fopDanilenko ?? 0;
}

export function aggregateEntity(months: TurnoverMonth[], entity: EntityId) {
  return months.reduce((total, month) => total + entityValue(month, entity), 0);
}

function pathFor(values: Array<number | null>, width: number, top: number, bottom: number, minimum: number, maximum: number) {
  const span = width / Math.max(values.length - 1, 1);
  const range = maximum - minimum || 1;
  return values.reduce((path, value, index) => value === null ? path : `${path}${path ? " L" : "M"}${index * span},${bottom - (value - minimum) / range * (bottom - top)}`, "");
}

function priorPeriodMap(comparison: TurnoverMonth[]) {
  return new Map(comparison.map((month) => [`${Number(month.period.slice(0, 4)) + 1}${month.period.slice(4)}`, month]));
}

export function ExecutiveKpi({ label, value, note, comparison, delta, history, historyLabels, formatter = money }: { label: string; value: string; note: string; comparison: string; delta: number | null; history: Array<number | null>; historyLabels: string[]; formatter?: (value: number | null) => string }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const known = history.filter((item): item is number => item !== null);
  const minimum = Math.min(...known, 0);
  const maximum = Math.max(...known, 1);
  const width = 126, top = 6, bottom = 42;
  const x = (index: number) => index * (width / Math.max(history.length - 1, 1));
  const y = (item: number | null) => item === null ? bottom : bottom - (item - minimum) / (maximum - minimum || 1) * (bottom - top);
  const active = hovered ?? Math.max(history.length - 1, 0);
  return <article className={styles.kpiCard}>
    <div><span>{label}</span><strong>{value}</strong><small>{note}</small><em>{comparison}</em></div>
    <div className={styles.kpiTrend} onMouseLeave={() => setHovered(null)}><b className={delta === null ? styles.muted : delta >= 0 ? styles.positive : styles.negative}>{percent(delta, true)} р/р</b><div className={styles.kpiSparkline}><svg viewBox="0 0 126 48" role="img" aria-label={`${label}: ${history.map((item, index) => `${historyLabels[index] ?? index + 1} — ${formatter(item)}`).join(", ")}`}><path d={pathFor(history, width, top, bottom, minimum, maximum)} />{history.map((item, index) => <g key={`${historyLabels[index] ?? index}-${index}`} role="group" tabIndex={0} aria-label={`${historyLabels[index] ?? index + 1}: ${formatter(item)}`} onMouseEnter={() => setHovered(index)} onFocus={() => setHovered(index)} onBlur={() => setHovered(null)}><rect x={x(index) - 12} y="0" width="24" height="48" fill="transparent" /><circle cx={x(index)} cy={y(item)} r={active === index ? 4 : 2.5} /></g>)}</svg>{history[active] !== undefined ? <span className={styles.kpiTooltip}><b>{historyLabels[active]}</b>{formatter(history[active])}</span> : null}</div></div>
  </article>;
}

export function CumulativeTurnoverChart({ history }: { history: ComparableTurnover[] }) {
  const series = history.slice(-4);
  const periods = series.at(-1)?.monthly ?? [];
  const [hovered, setHovered] = useState<number | null>(null);
  const active = hovered ?? Math.max(periods.length - 1, 0);
  const width = 1040, height = 360, left = 82, right = 982, top = 24, bottom = 292;
  const maximum = Math.max(...series.flatMap((item) => item.cumulativeBaseTurnover), 1);
  const x = (index: number) => left + index * ((right - left) / Math.max(periods.length - 1, 1));
  const y = (value: number) => bottom - value / maximum * (bottom - top);
  const currentPath = series.at(-1)?.cumulativeBaseTurnover.map((value, index) => `${index ? "L" : "M"}${x(index)},${y(value)}`).join(" ") ?? "";
  const areaPath = currentPath ? `${currentPath} L${x(periods.length - 1)},${bottom} L${left},${bottom} Z` : "";
  return <div className={styles.cumulativeChartWrap}>
    <div className={styles.chartLegend}>{series.map((item, index) => <span key={item.id} className={index === series.length - 1 ? styles.legendCurrent : ""}><i style={{ background: palette[index] }} />{item.label}<b>{money(item.baseTurnover)}</b></span>)}</div>
    <div className={styles.cumulativeCanvas} onMouseLeave={() => setHovered(null)}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Накопичений оборот за однакові періоди останніх чотирьох років">
        <defs><linearGradient id="finance-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#292477" stopOpacity=".16" /><stop offset="1" stopColor="#292477" stopOpacity="0" /></linearGradient></defs>
        {[0, .25, .5, .75, 1].map((part) => <g key={part}><line x1={left} x2={right} y1={bottom - (bottom - top) * part} y2={bottom - (bottom - top) * part} className={styles.chartGrid} /><text x={left - 12} y={bottom - (bottom - top) * part + 4} textAnchor="end" className={styles.chartAxis}>{money(maximum * part)}</text></g>)}
        {areaPath ? <path d={areaPath} fill="url(#finance-area)" /> : null}
        {series.map((item, index) => <path key={item.id} d={item.cumulativeBaseTurnover.map((value, pointIndex) => `${pointIndex ? "L" : "M"}${x(pointIndex)},${y(value)}`).join(" ")} fill="none" stroke={palette[index]} strokeWidth={index === series.length - 1 ? 4 : 2.5} strokeLinecap="round" strokeLinejoin="round" opacity={index === series.length - 1 ? 1 : .72} />)}
        {periods.map((month, index) => <g key={month.period} role="group" tabIndex={0} aria-label={`${monthLabel(month.period)}: ${series.map((item) => `${item.label} ${money(item.cumulativeBaseTurnover[index] ?? null)}`).join(", ")}`} onMouseEnter={() => setHovered(index)} onFocus={() => setHovered(index)} onBlur={() => setHovered(null)}><rect x={x(index) - Math.max(18, (right - left) / Math.max(periods.length, 1) / 2)} y={top} width={Math.max(36, (right - left) / Math.max(periods.length, 1))} height={bottom - top} fill="transparent" /><text x={x(index)} y="326" textAnchor="middle" className={styles.chartMonth}>{monthLabel(month.period).split(" ")[0]}</text></g>)}
        {periods[active] ? <g><line x1={x(active)} x2={x(active)} y1={top} y2={bottom} className={styles.hoverLine} />{series.map((item, index) => item.cumulativeBaseTurnover[active] === undefined ? null : <circle key={item.id} cx={x(active)} cy={y(item.cumulativeBaseTurnover[active])} r={index === series.length - 1 ? 6 : 4} fill={palette[index]} stroke="white" strokeWidth="2" />)}</g> : null}
      </svg>
      {periods[active] ? <div className={styles.chartTooltip} style={{ left: `${Math.min(86, Math.max(14, active / Math.max(periods.length - 1, 1) * 100))}%` }}><strong>{monthLabel(periods[active].period)}</strong>{series.map((item, index) => <span key={item.id}><i style={{ background: palette[index] }} />{item.label}<b>{money(item.cumulativeBaseTurnover[active] ?? null)}</b></span>)}</div> : null}
    </div>
  </div>;
}

export function TurnoverDonut({ items, total, selected, onSelect, selectableIds }: { items: EntityMix[]; total: number; selected: EntityId; onSelect: (id: EntityId) => void; selectableIds: Set<string> }) {
  const positive = items.filter((item) => item.value > 0);
  const denominator = positive.reduce((sum, item) => sum + item.value, 0) || 1;
  const radius = 72, circumference = 2 * Math.PI * radius;
  const segments = positive.map((item, index) => ({ item, index, length: item.value / denominator * circumference, offset: positive.slice(0, index).reduce((sum, previous) => sum + previous.value, 0) / denominator * circumference }));
  return <div className={styles.donutLayout}>
    <svg viewBox="0 0 190 190" role="img" aria-label="Структура обороту за компаніями"><circle cx="95" cy="95" r={radius} className={styles.donutTrack} />{segments.map(({ item, index, length, offset }) => <circle key={item.id} cx="95" cy="95" r={radius} fill="none" stroke={palette[index % palette.length]} strokeWidth="22" strokeDasharray={`${length} ${circumference - length}`} strokeDashoffset={-offset} transform="rotate(-90 95 95)" role="presentation" />)}<text x="95" y="89" textAnchor="middle" className={styles.donutTotal}>{money(total)}</text><text x="95" y="109" textAnchor="middle" className={styles.donutCaption}>оборот групи</text></svg>
    <div className={styles.donutLegend}>{positive.map((item, index) => { const enabled = selectableIds.has(item.id); return <button type="button" key={item.id} disabled={!enabled} aria-pressed={selected === item.id} className={selected === item.id ? styles.activeEntity : ""} onClick={() => enabled && onSelect(item.id as EntityId)}><i style={{ background: palette[index % palette.length] }} /><span>{item.label}<small>{money(item.value)}</small></span><b>{percent(item.share)}</b></button>; })}</div>
  </div>;
}

export function MonthlyTurnoverChart({ current, comparison, entity }: { current: TurnoverMonth[]; comparison: TurnoverMonth[]; entity: EntityId }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const comparisonMap = priorPeriodMap(comparison);
  const currentValues = current.map((month) => entityValue(month, entity));
  const priorValues = current.map((month) => comparisonMap.has(month.period) ? entityValue(comparisonMap.get(month.period)!, entity) : null);
  const active = hovered ?? Math.max(current.length - 1, 0);
  const width = 930, height = 318, left = 104, right = 900, top = 22, bottom = 260;
  const maximum = Math.max(...currentValues, ...priorValues.filter((value): value is number => value !== null), 1);
  const span = (right - left) / Math.max(current.length, 1), bar = Math.min(25, span * .28);
  const center = (index: number) => left + span * index + span / 2;
  return <div className={styles.interactiveChart} onMouseLeave={() => setHovered(null)}><svg className={styles.monthlyChart} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Оборот за місяцями проти аналогічного періоду минулого року">{[0, .5, 1].map((part) => <g key={part}><line x1={left} x2={right} y1={bottom - (bottom - top) * part} y2={bottom - (bottom - top) * part} className={styles.chartGrid} /><text x={left - 14} y={bottom - (bottom - top) * part + 4} textAnchor="end" className={styles.chartAxis}>{money(maximum * part)}</text></g>)}{current.map((month, index) => { const currentHeight = currentValues[index] / maximum * (bottom - top); const priorHeight = (priorValues[index] ?? 0) / maximum * (bottom - top); return <g key={month.period} role="group" tabIndex={0} aria-label={`${monthLabel(month.period)}: обраний період ${money(currentValues[index])}, торік ${money(priorValues[index])}`} onMouseEnter={() => setHovered(index)} onFocus={() => setHovered(index)} onBlur={() => setHovered(null)}><rect x={center(index) - span / 2} y={top} width={span} height={bottom - top} fill="transparent" /><rect x={center(index) - bar - 2} y={bottom - priorHeight} width={bar} height={priorHeight} rx="5" className={styles.monthlyPrior} /><rect x={center(index) + 2} y={bottom - currentHeight} width={bar} height={currentHeight} rx="5" className={styles.monthlyCurrent} /><text x={center(index)} y="292" textAnchor="middle" className={styles.chartMonth}>{monthLabel(month.period).split(" ")[0]}</text></g>; })}</svg>{current[active] ? <div className={styles.metricTooltip} style={{ left: `${Math.min(86, Math.max(18, center(active) / width * 100))}%` }}><strong>{monthLabel(current[active].period)}</strong><span><i className={styles.currentKey} />Обраний період<b>{money(currentValues[active])}</b></span><span><i className={styles.priorKey} />Роком раніше<b>{money(priorValues[active])}</b></span><span className={styles.tooltipDelta}>Зміна р/р<b>{percent(growth(currentValues[active], priorValues[active]), true)}</b></span></div> : null}</div>;
}

export function VarianceDriverChart({ current, previous, currentLabel, previousLabel }: { current: EntityMix[]; previous: EntityMix[]; currentLabel: string; previousLabel: string }) {
  const currentMap = new Map(current.map((item) => [item.id, item]));
  const previousMap = new Map(previous.map((item) => [item.id, item]));
  const rows = [...new Set([...currentMap.keys(), ...previousMap.keys()])].map((id) => ({ id, label: currentMap.get(id)?.label ?? previousMap.get(id)?.label ?? id, delta: (currentMap.get(id)?.value ?? 0) - (previousMap.get(id)?.value ?? 0) })).filter((item) => Math.abs(item.delta) >= 1).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const previousTotal = previous.reduce((sum, item) => sum + item.value, 0), currentTotal = current.reduce((sum, item) => sum + item.value, 0), totalDelta = currentTotal - previousTotal;
  const maximum = Math.max(...rows.map((item) => Math.abs(item.delta)), 1);
  return <div className={styles.varianceChart}><div className={styles.varianceBridge}><span><small>{previousLabel}</small><b>{money(previousTotal)}</b></span><i>→</i><span className={totalDelta >= 0 ? styles.positive : styles.negative}><small>Різниця</small><b>{money(totalDelta)}</b></span><i>→</i><span><small>{currentLabel}</small><b>{money(currentTotal)}</b></span></div><div className={styles.varianceRows}>{rows.map((item) => <div key={item.id}><span>{item.label}</span><div className={styles.varianceTrack}><i className={item.delta >= 0 ? styles.variancePositive : styles.varianceNegative} style={item.delta >= 0 ? { left: "50%", width: `${Math.abs(item.delta) / maximum * 50}%` } : { right: "50%", width: `${Math.abs(item.delta) / maximum * 50}%` }} /></div><b className={item.delta >= 0 ? styles.positive : styles.negative}>{money(item.delta)}</b></div>)}</div></div>;
}

export function ScaleGrowthChart({ current, comparison }: { current: TurnoverMonth[]; comparison: TurnoverMonth[] }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const comparisonMap = priorPeriodMap(comparison);
  let currentTurnover = 0, previousTurnover = 0, currentFte = 0, previousFte = 0, matched = 0;
  const turnover: Array<number | null> = [], team: Array<number | null> = [];
  current.forEach((month) => {
    const prior = comparisonMap.get(month.period);
    if (prior) {
      currentTurnover += month.baseTurnover ?? 0;
      previousTurnover += prior.baseTurnover ?? 0;
      if (month.fte !== null && prior.fte !== null) { currentFte += month.fte; previousFte += prior.fte; matched += 1; }
    }
    turnover.push(prior ? growth(currentTurnover, previousTurnover) : null);
    team.push(prior && matched ? growth(currentFte / matched, previousFte / matched) : null);
  });
  const active = hovered ?? Math.max(current.length - 1, 0);
  const known = [...turnover, ...team].filter((item): item is number => item !== null);
  const minimum = Math.min(...known, 0), rawMaximum = Math.max(...known, .1), maximum = rawMaximum + Math.max((rawMaximum - minimum) * .08, .03);
  const width = 840, height = 300, left = 82, right = 806, top = 28, bottom = 238;
  const xWidth = right - left;
  const x = (index: number) => left + index * (xWidth / Math.max(current.length - 1, 1));
  const y = (value: number) => bottom - (value - minimum) / (maximum - minimum || 1) * (bottom - top);
  const toPath = (values: Array<number | null>) => pathFor(values, xWidth, top, bottom, minimum, maximum).replace(/([ML])([\d.-]+),/g, (_, command, point) => `${command}${Number(point) + left},`);
  const zeroY = y(0);
  return <div className={styles.scaleChart} onMouseLeave={() => setHovered(null)}><div className={styles.scaleInsight}><span><i className={styles.turnoverLineLegend} />Накопичений оборот <b>{percent(turnover.at(-1) ?? null, true)}</b></span><span><i className={styles.teamLineLegend} />Середня команда <b>{percent(team.at(-1) ?? null, true)}</b></span><span>Різниця темпів <b>{points((turnover.at(-1) ?? 0) - (team.at(-1) ?? 0))}</b></span></div><div className={styles.interactiveChart}><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Накопичена річна зміна обороту та середньої чисельності команди"><line x1={left} x2={right} y1={zeroY} y2={zeroY} className={styles.zeroLine} />{[minimum, (minimum + maximum) / 2, maximum].map((value) => <g key={value}><line x1={left} x2={right} y1={y(value)} y2={y(value)} className={styles.chartGrid} /><text x={left - 12} y={y(value) + 4} textAnchor="end" className={styles.chartAxis}>{percent(value, true)}</text></g>)}<path d={toPath(turnover)} className={styles.turnoverGrowthLine} /><path d={toPath(team)} className={styles.teamGrowthLine} />{current.map((month, index) => <g key={month.period} role="group" tabIndex={0} aria-label={`${monthLabel(month.period)}: накопичений оборот ${percent(turnover[index], true)}, середня команда ${percent(team[index], true)}`} onMouseEnter={() => setHovered(index)} onFocus={() => setHovered(index)} onBlur={() => setHovered(null)}><rect x={x(index) - Math.max(20, xWidth / Math.max(current.length, 1) / 2)} y={top} width={Math.max(40, xWidth / Math.max(current.length, 1))} height={bottom - top} fill="transparent" />{turnover[index] !== null ? <circle cx={x(index)} cy={y(turnover[index]!)} r={active === index ? 5 : 3} className={styles.turnoverPoint} /> : null}{team[index] !== null ? <circle cx={x(index)} cy={y(team[index]!)} r={active === index ? 5 : 3} className={styles.teamPoint} /> : null}<text x={x(index)} y="276" textAnchor="middle" className={styles.chartMonth}>{monthLabel(month.period).split(" ")[0]}</text></g>)}</svg>{current[active] ? <div className={styles.metricTooltip} style={{ left: `${Math.min(84, Math.max(18, x(active) / width * 100))}%` }}><strong>Накопичено по {monthLabel(current[active].period)}</strong><span><i className={styles.turnoverLineLegend} />Оборот р/р<b>{percent(turnover[active], true)}</b></span><span><i className={styles.teamLineLegend} />Середня команда р/р<b>{percent(team[active], true)}</b></span><span className={styles.tooltipDelta}>Різниця темпів<b>{points((turnover[active] ?? 0) - (team[active] ?? 0))}</b></span></div> : null}</div></div>;
}

export function WorkforceEconomicsChart({ months }: { months: TurnoverMonth[] }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const active = hovered ?? Math.max(months.length - 1, 0);
  const productivity = months.map((month) => month.turnoverPerFte);
  const payroll = months.map((month) => month.payrollPerFte);
  const known = [...productivity, ...payroll].filter((item): item is number => item !== null);
  const maximum = Math.max(...known, 1) * 1.08;
  const width = 850, height = 260, left = 94, right = 814, top = 22, bottom = 204;
  const xWidth = right - left;
  const x = (index: number) => left + index * (xWidth / Math.max(months.length - 1, 1));
  const y = (value: number) => bottom - value / maximum * (bottom - top);
  const toPath = (values: Array<number | null>) => pathFor(values, xWidth, top, bottom, 0, maximum).replace(/([ML])([\d.-]+),/g, (_, command, point) => `${command}${Number(point) + left},`);
  return <div className={styles.workforceChart} onMouseLeave={() => setHovered(null)}><div className={styles.workforceLegend}><span><i className={styles.productivityLegend} />Оборот / FTE</span><span><i className={styles.payrollLegend} />ФОП / FTE</span></div><div className={styles.interactiveChart}><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Оборот і фонд оплати праці на один FTE за місяцями">{[0, .5, 1].map((part) => <g key={part}><line x1={left} x2={right} y1={bottom - (bottom - top) * part} y2={bottom - (bottom - top) * part} className={styles.chartGrid} /><text x={left - 12} y={bottom - (bottom - top) * part + 4} textAnchor="end" className={styles.chartAxis}>{money(maximum * part)}</text></g>)}<path d={toPath(productivity)} className={styles.productivityLine} /><path d={toPath(payroll)} className={styles.payrollLine} />{months.map((month, index) => <g key={month.period} role="group" tabIndex={0} aria-label={`${monthLabel(month.period)}: оборот на FTE ${money(productivity[index])}, ФОП на FTE ${money(payroll[index])}`} onMouseEnter={() => setHovered(index)} onFocus={() => setHovered(index)} onBlur={() => setHovered(null)}><rect x={x(index) - Math.max(20, xWidth / Math.max(months.length, 1) / 2)} y={top} width={Math.max(40, xWidth / Math.max(months.length, 1))} height={bottom - top} fill="transparent" />{productivity[index] !== null ? <circle cx={x(index)} cy={y(productivity[index]!)} r={active === index ? 5 : 3} className={styles.productivityPoint} /> : null}{payroll[index] !== null ? <circle cx={x(index)} cy={y(payroll[index]!)} r={active === index ? 5 : 3} className={styles.payrollPoint} /> : null}<text x={x(index)} y="238" textAnchor="middle" className={styles.chartMonth}>{monthLabel(month.period).split(" ")[0]}</text></g>)}</svg>{months[active] ? <div className={styles.metricTooltip} style={{ left: `${Math.min(84, Math.max(18, x(active) / width * 100))}%` }}><strong>{monthLabel(months[active].period)}</strong><span><i className={styles.productivityLegend} />Оборот / FTE<b>{money(productivity[active])}</b></span><span><i className={styles.payrollLegend} />ФОП / FTE<b>{money(payroll[active])}</b></span>{payroll[active] === null ? <small>ФОП за місяць не заповнений</small> : null}</div> : null}</div></div>;
}
