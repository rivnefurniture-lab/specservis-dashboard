"use client";

import { useState } from "react";
import type { TurnoverMonth } from "@/lib/confidential-dashboard";
import styles from "./confidential-dashboard.module.css";

export type EntityId = "specservis" | "promtech" | "refkey" | "naryshkov" | "pashkov" | "danilenko";
export type FinanceMetric = "turnover" | "productivity" | "averageProductivity" | "fte" | "averageFte" | "cocaCola";
export type FinanceChartPoint = { id: string; label: string; value: number | null; months: TurnoverMonth[] };
export type CompanySlice = { id: string; label: string; value: number; share: number };
export type FinanceLocale = "uk" | "ru";

export const wholeNumber = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 });
export const oneDecimal = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 1 });
export const chartPalette = ["#2f2a80", "#3978b7", "#28a16f", "#dc8a45", "#806ab0", "#5da3a5", "#c45d6d"];

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

export function monthLabel(period: string | null, locale: FinanceLocale = "uk") {
  if (!period) return "—";
  const formatted = new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : "uk-UA", { month: "short", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${period}-01T00:00:00Z`));
  return formatted.replace(" р.", "").replace(" г.", "");
}

export function growth(current: number | null, previous: number | null) {
  return current === null || previous === null || previous === 0 ? null : current / previous - 1;
}

export function entityValue(month: TurnoverMonth, entity: EntityId) {
  if (entity === "specservis") return (month.specservisBank ?? 0) + (month.specservisCash ?? 0);
  if (entity === "promtech") return month.promtechCore ?? 0;
  if (entity === "refkey") return (month.refkeyBank ?? 0) + (month.refkeyCash ?? 0);
  if (entity === "naryshkov") return month.fopNaryshkov ?? 0;
  if (entity === "pashkov") return month.fopPashkov ?? 0;
  return month.fopDanilenko ?? 0;
}

function valuePath(points: FinanceChartPoint[], x: (index: number) => number, y: (value: number) => number) {
  return points.reduce((path, point, index) => point.value === null ? path : `${path}${path ? " L" : "M"}${x(index)},${y(point.value)}`, "");
}

function niceMaximum(value: number) {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const step = [1, 1.25, 1.5, 2, 2.5, 4, 5, 7.5, 10].find((candidate) => candidate >= normalized) ?? 10;
  return step * magnitude;
}

export function InteractiveMetricChart({ title, locale, points, variant, format, tone = "blue", onSelect }: {
  title: string;
  locale: FinanceLocale;
  points: FinanceChartPoint[];
  variant: "bar" | "line";
  format: (value: number | null) => string;
  tone?: "blue" | "green" | "orange" | "red";
  onSelect: (point: FinanceChartPoint) => void;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const width = 900, height = 316, left = 92, right = 870, top = 24, bottom = 246;
  const maximum = niceMaximum(Math.max(...points.map((point) => point.value ?? 0), 1));
  const span = (right - left) / Math.max(points.length, 1);
  const x = (index: number) => left + span * index + span / 2;
  const y = (value: number) => bottom - value / maximum * (bottom - top);
  const barWidth = Math.min(58, span * .52);
  const active = hovered === null ? null : points[hovered] ?? null;
  const tooltipPosition = hovered === null ? 50 : x(hovered) / width * 100;
  const tooltipTransform = tooltipPosition > 72 ? "translateX(-100%)" : tooltipPosition < 28 ? "translateX(0)" : "translateX(-50%)";
  const toneClass = tone === "green" ? styles.greenChart : tone === "orange" ? styles.orangeChart : tone === "red" ? styles.redChart : styles.blueChart;
  const interaction = locale === "ru"
    ? { chart: "Наведите для значения, нажмите для расшифровки.", open: "Открыть состав показателя.", click: "Нажмите для расшифровки" }
    : { chart: "Наведіть для значення, натисніть для деталізації.", open: "Відкрити склад показника.", click: "Натисніть для розшифровки" };
  return <article className={styles.chartCard}>
    <header><h2>{title}</h2></header>
    <div className={`${styles.chartCanvas} ${toneClass}`} onMouseLeave={() => setHovered(null)}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${title}. ${interaction.chart}`}>
        <line x1={left} x2={left} y1={top} y2={bottom} className={styles.chartAxis} />
        <line x1={left} x2={right} y1={bottom} y2={bottom} className={styles.chartAxis} />
        {[0, .5, 1].map((part) => {
          const axisY = bottom - (bottom - top) * part;
          return <g key={part}><line x1={left} x2={right} y1={axisY} y2={axisY} className={styles.chartGrid} /><text x={left - 12} y={axisY + 4} textAnchor="end" className={styles.axisTick}>{format(maximum * part)}</text></g>;
        })}
        {variant === "line" ? <path d={valuePath(points, x, y)} className={styles.metricLine} /> : null}
        {points.map((point, index) => {
          const value = point.value ?? 0;
          const pointY = y(value);
          return <g key={point.id} role="button" tabIndex={0} aria-label={`${point.label}: ${format(point.value)}. ${interaction.open}`} onMouseEnter={() => setHovered(index)} onFocus={() => setHovered(index)} onBlur={() => setHovered(null)} onClick={() => onSelect(point)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(point); } }}>
            <rect x={left + span * index} y={top} width={span} height={bottom - top + 48} fill="transparent" className={styles.chartHitbox} />
            {variant === "bar" ? <rect x={x(index) - barWidth / 2} y={pointY} width={barWidth} height={Math.max(bottom - pointY, 2)} rx="8" className={styles.metricBar} /> : point.value !== null ? <circle cx={x(index)} cy={pointY} r={hovered === index ? 7 : 5} className={styles.metricPoint} /> : null}
            <text x={x(index)} y="270" textAnchor="middle" className={styles.chartLabel}>{point.label}</text>
          </g>;
        })}
      </svg>
      {active ? <div className={styles.chartTooltip} style={{ left: `${tooltipPosition}%`, transform: tooltipTransform }}><span>{active.label}</span><strong>{format(active.value)}</strong><small>{interaction.click}</small></div> : null}
    </div>
  </article>;
}

function piePath(start: number, end: number) {
  const radius = 82, center = 100;
  const startPoint = { x: center + radius * Math.cos(start), y: center + radius * Math.sin(start) };
  const endPoint = { x: center + radius * Math.cos(end), y: center + radius * Math.sin(end) };
  const large = end - start > Math.PI ? 1 : 0;
  return `M${center},${center} L${startPoint.x},${startPoint.y} A${radius},${radius} 0 ${large} 1 ${endPoint.x},${endPoint.y} Z`;
}

export function CompanyPieChart({ items, total, locale, format = money }: { items: CompanySlice[]; total: number; locale: FinanceLocale; format?: (value: number | null) => string }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const positive = items.filter((item) => item.value > 0);
  const slices = positive.reduce<Array<{ item: CompanySlice; index: number; path: string; end: number }>>((result, item, index) => {
    const start = result.at(-1)?.end ?? -Math.PI / 2;
    const end = start + item.share * Math.PI * 2;
    return [...result, { item, index, path: piePath(start, end), end }];
  }, []);
  const active = hovered === null ? null : slices[hovered]?.item ?? null;
  return <div className={styles.pieLayout}>
    <div className={styles.pieCanvas} onMouseLeave={() => setHovered(null)}><svg viewBox="0 0 200 200" role="img" aria-label={locale === "ru" ? "Распределение показателя по компаниям" : "Розподіл показника за компаніями"}>{slices.map(({ item, index, path }) => <path key={item.id} d={path} fill={chartPalette[index % chartPalette.length]} className={hovered === index ? styles.activeSlice : ""} onMouseEnter={() => setHovered(index)} />)}</svg>{active ? <div className={styles.pieTooltip}><span>{active.label}</span><b>{format(active.value)}</b><small>{percent(active.share)}</small></div> : <div className={styles.pieCenter}><b>{format(total)}</b><span>{locale === "ru" ? "всего" : "разом"}</span></div>}</div>
    <div className={styles.pieLegend}>{positive.map((item, index) => <div key={item.id}><i style={{ background: chartPalette[index % chartPalette.length] }} /><span>{item.label}</span><b>{format(item.value)}</b><small>{percent(item.share)}</small></div>)}</div>
  </div>;
}

export function SourceBars({ rows, format, selectedId }: { rows: Array<{ id: string; label: string; value: number | null }>; format: (value: number | null) => string; selectedId?: string }) {
  const maximum = Math.max(...rows.map((row) => row.value ?? 0), 1);
  return <div className={styles.sourceBars}>{rows.map((row) => <div key={row.id} className={row.id === selectedId ? styles.selectedSource : ""}><span>{row.label}</span><i><em style={{ width: `${Math.max(((row.value ?? 0) / maximum) * 100, row.value ? 2 : 0)}%` }} /></i><b>{format(row.value)}</b></div>)}</div>;
}
