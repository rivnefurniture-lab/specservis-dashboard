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
  const formatted = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: unit[0] === 1 ? 0 : 1 }).format(value / unit[0]);
  return `₴${formatted}${unit[1] ? ` ${unit[1]}` : ""}`;
}

export function percent(value: number | null, signed = false) {
  if (value === null) return "—";
  return new Intl.NumberFormat("uk-UA", { style: "percent", maximumFractionDigits: 1, signDisplay: signed ? "always" : "auto" }).format(value);
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

export function ExecutiveKpi({ label, value, note, delta, history, formatter = money }: { label: string; value: string; note: string; delta: number | null; history: Array<number | null>; formatter?: (value: number | null) => string }) {
  const known = history.filter((item): item is number => item !== null);
  const minimum = Math.min(...known, 0);
  const maximum = Math.max(...known, 1);
  const line = pathFor(history, 126, 6, 42, minimum, maximum);
  return <article className={styles.kpiCard}>
    <div><span>{label}</span><strong>{value}</strong><small>{note}</small></div>
    <div className={styles.kpiTrend}><b className={delta === null ? styles.muted : delta >= 0 ? styles.positive : styles.negative}>{percent(delta, true)} р/р</b><svg viewBox="0 0 126 48" role="img" aria-label={`${label}: ${history.map(formatter).join(", ")}`}><path d={line} /><circle cx="126" cy={history.at(-1) === null || history.at(-1) === undefined ? 42 : 42 - (((history.at(-1) ?? 0) - minimum) / (maximum - minimum || 1)) * 36} r="4" /></svg></div>
  </article>;
}

export function CumulativeTurnoverChart({ history }: { history: ComparableTurnover[] }) {
  const series = history.slice(-4);
  const periods = series.at(-1)?.monthly ?? [];
  const [hovered, setHovered] = useState(Math.max(periods.length - 1, 0));
  const width = 1040, height = 390, left = 72, right = 982, top = 24, bottom = 320;
  const maximum = Math.max(...series.flatMap((item) => item.cumulativeBaseTurnover), 1);
  const x = (index: number) => left + index * ((right - left) / Math.max(periods.length - 1, 1));
  const y = (value: number) => bottom - value / maximum * (bottom - top);
  const currentPath = series.at(-1)?.cumulativeBaseTurnover.map((value, index) => `${index ? "L" : "M"}${x(index)},${y(value)}`).join(" ") ?? "";
  const areaPath = currentPath ? `${currentPath} L${x(periods.length - 1)},${bottom} L${left},${bottom} Z` : "";

  return <div className={styles.cumulativeChartWrap}>
    <div className={styles.chartLegend}>{series.map((item, index) => <span key={item.id} className={index === series.length - 1 ? styles.legendCurrent : ""}><i style={{ background: palette[index] }} />{item.label}<b>{money(item.baseTurnover)}</b></span>)}</div>
    <div className={styles.cumulativeCanvas} onMouseLeave={() => setHovered(Math.max(periods.length - 1, 0))}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Накопичений оборот за однакові періоди останніх чотирьох років">
        <defs><linearGradient id="finance-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#292477" stopOpacity=".16" /><stop offset="1" stopColor="#292477" stopOpacity="0" /></linearGradient></defs>
        {[0, .25, .5, .75, 1].map((part) => <g key={part}><line x1={left} x2={right} y1={bottom - (bottom - top) * part} y2={bottom - (bottom - top) * part} className={styles.chartGrid} /><text x={left - 12} y={bottom - (bottom - top) * part + 4} textAnchor="end" className={styles.chartAxis}>{money(maximum * part)}</text></g>)}
        {areaPath ? <path d={areaPath} fill="url(#finance-area)" /> : null}
        {series.map((item, index) => <path key={item.id} d={item.cumulativeBaseTurnover.map((value, pointIndex) => `${pointIndex ? "L" : "M"}${x(pointIndex)},${y(value)}`).join(" ")} fill="none" stroke={palette[index]} strokeWidth={index === series.length - 1 ? 4 : 2.5} strokeLinecap="round" strokeLinejoin="round" opacity={index === series.length - 1 ? 1 : .72} />)}
        {periods.map((month, index) => <g key={month.period}><rect x={x(index) - Math.max(18, (right - left) / Math.max(periods.length, 1) / 2)} y={top} width={Math.max(36, (right - left) / Math.max(periods.length, 1))} height={bottom - top} fill="transparent" onMouseEnter={() => setHovered(index)} /><text x={x(index)} y="354" textAnchor="middle" className={styles.chartMonth}>{monthLabel(month.period).split(" ")[0]}</text></g>)}
        {periods[hovered] ? <g><line x1={x(hovered)} x2={x(hovered)} y1={top} y2={bottom} className={styles.hoverLine} />{series.map((item, index) => item.cumulativeBaseTurnover[hovered] === undefined ? null : <circle key={item.id} cx={x(hovered)} cy={y(item.cumulativeBaseTurnover[hovered])} r={index === series.length - 1 ? 6 : 4} fill={palette[index]} stroke="white" strokeWidth="2" />)}</g> : null}
      </svg>
      {periods[hovered] ? <div className={styles.chartTooltip} style={{ left: `${Math.min(88, Math.max(12, hovered / Math.max(periods.length - 1, 1) * 100))}%` }}><strong>{monthLabel(periods[hovered].period)}</strong>{series.map((item, index) => <span key={item.id}><i style={{ background: palette[index] }} />{item.label}<b>{money(item.cumulativeBaseTurnover[hovered] ?? null)}</b></span>)}</div> : null}
    </div>
  </div>;
}

export function TurnoverDonut({ items, total, selected, onSelect, selectableIds }: { items: EntityMix[]; total: number; selected: EntityId; onSelect: (id: EntityId) => void; selectableIds: Set<string> }) {
  const positive = items.filter((item) => item.value > 0);
  const denominator = positive.reduce((sum, item) => sum + item.value, 0) || 1;
  const radius = 72, circumference = 2 * Math.PI * radius;
  const segments = positive.map((item, index) => ({
    item,
    index,
    length: item.value / denominator * circumference,
    offset: positive.slice(0, index).reduce((sum, previous) => sum + previous.value, 0) / denominator * circumference,
  }));
  return <div className={styles.donutLayout}>
    <svg viewBox="0 0 190 190" role="img" aria-label="Структура обороту за компаніями"><circle cx="95" cy="95" r={radius} className={styles.donutTrack} />{segments.map(({ item, index, length, offset }) => <circle key={item.id} cx="95" cy="95" r={radius} fill="none" stroke={palette[index % palette.length]} strokeWidth="22" strokeDasharray={`${length} ${circumference - length}`} strokeDashoffset={-offset} transform="rotate(-90 95 95)" />)}<text x="95" y="89" textAnchor="middle" className={styles.donutTotal}>{money(total)}</text><text x="95" y="109" textAnchor="middle" className={styles.donutCaption}>оборот групи</text></svg>
    <div className={styles.donutLegend}>{positive.map((item, index) => { const enabled = selectableIds.has(item.id); return <button type="button" key={item.id} disabled={!enabled} aria-pressed={selected === item.id} className={selected === item.id ? styles.activeEntity : ""} onClick={() => enabled && onSelect(item.id as EntityId)}><i style={{ background: palette[index % palette.length] }} /><span>{item.label}<small>{money(item.value)}</small></span><b>{percent(item.share)}</b></button>; })}</div>
  </div>;
}

export function MonthlyTurnoverChart({ current, comparison, entity }: { current: TurnoverMonth[]; comparison: TurnoverMonth[]; entity: EntityId }) {
  const width = 900, height = 330, left = 58, right = 866, top = 22, bottom = 276;
  const currentValues = current.map((month) => entityValue(month, entity));
  const priorValues = comparison.map((month) => entityValue(month, entity));
  const maximum = Math.max(...currentValues, ...priorValues, 1);
  const span = (right - left) / Math.max(current.length, 1), bar = Math.min(24, span * .28);
  return <svg className={styles.monthlyChart} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Оборот за місяцями проти минулого року">{[0, .5, 1].map((part) => <g key={part}><line x1={left} x2={right} y1={bottom - (bottom - top) * part} y2={bottom - (bottom - top) * part} className={styles.chartGrid} /><text x={left - 10} y={bottom - (bottom - top) * part + 4} textAnchor="end" className={styles.chartAxis}>{money(maximum * part)}</text></g>)}{current.map((month, index) => { const center = left + span * index + span / 2; const currentHeight = currentValues[index] / maximum * (bottom - top); const priorHeight = (priorValues[index] ?? 0) / maximum * (bottom - top); return <g key={month.period} aria-label={`${monthLabel(month.period)}: ${money(currentValues[index])}`}><rect x={center - bar - 2} y={bottom - priorHeight} width={bar} height={priorHeight} rx="5" className={styles.monthlyPrior} /><rect x={center + 2} y={bottom - currentHeight} width={bar} height={currentHeight} rx="5" className={styles.monthlyCurrent} /><text x={center} y="306" textAnchor="middle" className={styles.chartMonth}>{monthLabel(month.period).split(" ")[0]}</text></g>; })}</svg>;
}

export function VarianceDriverChart({ current, previous }: { current: EntityMix[]; previous: EntityMix[] }) {
  const currentMap = new Map(current.map((item) => [item.id, item]));
  const previousMap = new Map(previous.map((item) => [item.id, item]));
  const rows = [...new Set([...currentMap.keys(), ...previousMap.keys()])].map((id) => ({ id, label: currentMap.get(id)?.label ?? previousMap.get(id)?.label ?? id, delta: (currentMap.get(id)?.value ?? 0) - (previousMap.get(id)?.value ?? 0) })).filter((item) => Math.abs(item.delta) >= 1).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const previousTotal = previous.reduce((sum, item) => sum + item.value, 0), currentTotal = current.reduce((sum, item) => sum + item.value, 0), totalDelta = currentTotal - previousTotal;
  const maximum = Math.max(...rows.map((item) => Math.abs(item.delta)), 1);
  return <div className={styles.varianceChart}><div className={styles.varianceBridge}><span><small>Було</small><b>{money(previousTotal)}</b></span><i>→</i><span className={totalDelta >= 0 ? styles.positive : styles.negative}><small>Зміна</small><b>{money(totalDelta)}</b></span><i>→</i><span><small>Стало</small><b>{money(currentTotal)}</b></span></div><div className={styles.varianceRows}>{rows.map((item) => <div key={item.id}><span>{item.label}</span><div className={styles.varianceTrack}><i className={item.delta >= 0 ? styles.variancePositive : styles.varianceNegative} style={item.delta >= 0 ? { left: "50%", width: `${Math.abs(item.delta) / maximum * 50}%` } : { right: "50%", width: `${Math.abs(item.delta) / maximum * 50}%` }} /></div><b className={item.delta >= 0 ? styles.positive : styles.negative}>{money(item.delta)}</b></div>)}</div></div>;
}

export function ScaleGrowthChart({ current, comparison }: { current: TurnoverMonth[]; comparison: TurnoverMonth[] }) {
  const turnover = current.map((month, index) => growth(month.baseTurnover, comparison[index]?.baseTurnover ?? null));
  const team = current.map((month, index) => growth(month.fte, comparison[index]?.fte ?? null));
  const known = [...turnover, ...team].filter((item): item is number => item !== null);
  const minimum = Math.min(...known, 0), maximum = Math.max(...known, 0.1);
  const width = 820, height = 300, left = 66, right = 786, top = 28, bottom = 240;
  const xWidth = right - left;
  const toPath = (values: Array<number | null>) => pathFor(values, xWidth, top, bottom, minimum, maximum).replace(/([ML])([\d.-]+),/g, (_, command, x) => `${command}${Number(x) + left},`);
  const zeroY = bottom - (0 - minimum) / (maximum - minimum || 1) * (bottom - top);
  const gap = growth(current.reduce((sum, month) => sum + (month.baseTurnover ?? 0), 0), comparison.reduce((sum, month) => sum + (month.baseTurnover ?? 0), 0));
  return <div className={styles.scaleChart}><div className={styles.scaleInsight}><span><i className={styles.turnoverLineLegend} />Оборот <b>{percent(gap, true)}</b></span><span><i className={styles.teamLineLegend} />Команда <b>{percent(growth(current.at(-1)?.fte ?? null, comparison.at(-1)?.fte ?? null), true)}</b></span></div><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Річна зміна обороту та чисельності команди за місяцями"><line x1={left} x2={right} y1={zeroY} y2={zeroY} className={styles.zeroLine} />{[minimum, maximum].map((value) => <text key={value} x={left - 10} y={bottom - (value - minimum) / (maximum - minimum || 1) * (bottom - top) + 4} textAnchor="end" className={styles.chartAxis}>{percent(value, true)}</text>)}<path d={toPath(turnover)} className={styles.turnoverGrowthLine} /><path d={toPath(team)} className={styles.teamGrowthLine} />{current.map((month, index) => <text key={month.period} x={left + index * (xWidth / Math.max(current.length - 1, 1))} y="276" textAnchor="middle" className={styles.chartMonth}>{monthLabel(month.period).split(" ")[0]}</text>)}</svg></div>;
}
