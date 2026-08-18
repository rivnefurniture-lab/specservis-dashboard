"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { MarketShare } from "@/components/market-share";
import { HelpCircle, X } from "lucide-react";
import type { DashboardPayload } from "@/lib/dashboard-data";
import { date, integer, money } from "@/lib/dashboard-data";
import type { InternalTender, MarketCoveragePoint, MarketCoverageSummary, MarketCoverageTenderView } from "@/lib/types";

export type DashboardRole = "owner" | "manager" | "employee";
export type RoleWorkTarget = "active" | "analysis" | "preparing" | "submitted" | "complaints" | "stale" | "idle" | "all";

type StageCounts = {
  analysis: number;
  preparing: number;
  submitted: number;
  complaints: number;
};

const HINT_HALF_WIDTH = 140;

/**
 * Підказка біля цифри. Два свідомі рішення:
 *   — не атрибут `title`: системна підказка браузера зʼявляється із затримкою
 *     в пару секунд, і це читається як «нічого не відбувається»;
 *   — бабл рендериться порталом у <body>. Самого `position: fixed` мало:
 *     картки мають `overflow: hidden` під декоративне коло, а на hover
 *     отримують `transform`, який робить їх контейнером навіть для fixed —
 *     і підказку знову обрізає. Портал виносить її з-під будь-яких предків.
 */
export function Hint({ text }: { text: string }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [box, setBox] = useState<{ top: number; left: number; below: boolean } | null>(null);

  const show = () => {
    const rect = anchor.current?.getBoundingClientRect();
    if (!rect) return;
    const below = rect.top < 150;
    setBox({
      top: below ? rect.bottom + 9 : rect.top - 9,
      left: Math.min(Math.max(rect.left + rect.width / 2, HINT_HALF_WIDTH + 8), window.innerWidth - HINT_HALF_WIDTH - 8),
      below,
    });
  };
  const hide = () => setBox(null);

  useEffect(() => {
    if (!box) return;
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [box]);

  return (
    <span
      className="owner-hint"
      ref={anchor}
      tabIndex={0}
      role="note"
      aria-label={text}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      <i aria-hidden="true">?</i>
      {box ? createPortal(
        <span
          className={box.below ? "owner-hint-bubble below" : "owner-hint-bubble"}
          style={{ top: box.top, left: box.left }}
        >
          {text}
        </span>,
        document.body,
      ) : null}
    </span>
  );
}

/**
 * Пояснення станів. Розкривний блок штовхав решту сторінки, тому це модальне
 * вікно: воно нічого не зсуває і закривається Esc або кліком повз нього.
 *
 * Рендериться порталом у <body>. Без цього `inset: 0` рахується не від вікна,
 * а від `.owner-stack`: у нього анімація появи з `transform` і `fill-mode: both`,
 * тож трансформ лишається назавжди і робить блок контейнером навіть для `fixed`.
 * Модалка тоді центрується у висоті всієї сторінки й опиняється десь унизу.
 */
export function Legend({ title, items }: { title: string; items: Array<{ term: string; text: string }> }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", close);
    // Сторінка прокручується на <html>, тому блокувати треба саме його.
    document.documentElement.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", close);
      document.documentElement.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      <button type="button" className="owner-legend-trigger" onClick={() => setOpen(true)}>
        <HelpCircle size={15} />{title}
      </button>
      {open ? createPortal(
        <div className="owner-modal-backdrop" role="presentation" onMouseDown={() => setOpen(false)}>
          <aside className="owner-modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <h2>{title}</h2>
              <button type="button" aria-label="Закрити" onClick={() => setOpen(false)}><X size={18} /></button>
            </header>
            <dl>{items.map((item) => <div key={item.term}><dt>{item.term}</dt><dd>{item.text}</dd></div>)}</dl>
          </aside>
        </div>,
        document.body,
      ) : null}
    </>
  );
}

export type RoleModuleProps = {
  data: DashboardPayload;
  activeTenders: InternalTender[];
  staleTenders: InternalTender[];
  unclassifiedFuture: InternalTender[];
  marketNeedReview: MarketCoverageTenderView[];
  activeValue: number;
  stageCounts: StageCounts;
  /** Подано або на кваліфікації, але без руху понад 45 днів після подачі. */
  idleTenders: InternalTender[];
  /** Чи підключено внутрішній Excel саме для напрямку, який зараз відкритий. */
  hasRegistry: boolean;
  /** Скільки днів охоплює обраний період і як він підписаний у заголовках. */
  periodDays: number;
  periodLabel: string;
  /** Напрямок для зрізу конкурентів: null = уся компанія. */
  scopeFilter: Exclude<import("@/lib/types").Direction, "Інше"> | null;
  /** Назва напрямку, який зараз відкритий — для чесного пояснення порожнього стану. */
  scopeDirection: string;
  onWork: (target: RoleWorkTarget) => void;
  onMarket: () => void;
  onCompetitors: () => void;
  onOpenInternal: (tender: InternalTender) => void;
};

/**
 * Нуль у внутрішньому реєстрі має два різні значення: «роботи немає» і
 * «файлу цього напрямку ще немає». Показуємо друге явно, щоб їх не плутали.
 */
export function RegistryNotice({ direction, onMarket }: { direction: string; onMarket?: () => void }) {
  return (
    <div className="registry-notice">
      <b>Внутрішній Excel напрямку «{direction}» ще не підключено</b>
      <span>Тому тут порожньо: це не означає, що роботи немає — означає, що джерела для порівняння поки немає. Ринок Prozorro по цьому напрямку працює і показується окремо.</span>
      {onMarket ? <button type="button" onClick={onMarket}>Відкрити ринок Prozorro</button> : null}
    </div>
  );
}

const directions = ["Капбудівництво", "Сервіс", "Кондиціонування"] as const;

function sumCoverage(points: MarketCoverageSummary[]) {
  return points.reduce((total, point) => ({
    market: total.market + point.market,
    seen: total.seen + point.seen,
    missed: total.missed + point.missed,
    needsReview: total.needsReview + point.needsReview,
    untracked: total.untracked + point.untracked,
    unavailable: total.unavailable + point.unavailable,
    outsideScope: total.outsideScope + point.outsideScope,
    unknownTerritory: total.unknownTerritory + point.unknownTerritory,
    marketValue: total.marketValue + point.marketValue,
    seenValue: total.seenValue + point.seenValue,
    missedValue: total.missedValue + point.missedValue,
    needsReviewValue: total.needsReviewValue + point.needsReviewValue,
    untrackedValue: total.untrackedValue + point.untrackedValue,
    unavailableValue: total.unavailableValue + point.unavailableValue,
    outsideScopeValue: total.outsideScopeValue + point.outsideScopeValue,
    unknownTerritoryValue: total.unknownTerritoryValue + point.unknownTerritoryValue,
  }), { market: 0, seen: 0, missed: 0, needsReview: 0, untracked: 0, unavailable: 0, outsideScope: 0, unknownTerritory: 0, marketValue: 0, seenValue: 0, missedValue: 0, needsReviewValue: 0, untrackedValue: 0, unavailableValue: 0, outsideScopeValue: 0, unknownTerritoryValue: 0 });
}

function shortDay(value: string) {
  return new Intl.DateTimeFormat("uk-UA", { weekday: "short" }).format(new Date(`${value}T12:00:00Z`)).replace(".", "");
}

function ModuleHead({ role, title, stamp }: { role: string; title: string; stamp: string }) {
  return <header className="role-module-head"><div><span>{role}</span><h1>{title}</h1></div><time>{stamp}</time></header>;
}

function Metric({ label, value, detail, hint, tone = "plain", onClick }: { label: string; value: string; detail: string; hint?: string; tone?: "plain" | "good" | "risk" | "accent"; onClick?: () => void }) {
  const body = <><span>{label}{hint ? <Hint text={hint} /> : null}</span><strong>{value}</strong><small>{detail}</small></>;
  return onClick
    ? <button type="button" className={`role-metric ${tone}`} onClick={onClick}>{body}</button>
    : <article className={`role-metric ${tone}`}>{body}</article>;
}

function CoverageCard({ summary, hasRegistry, periodLabel, onClick }: { summary: MarketCoverageSummary; hasRegistry: boolean; periodLabel: string; onClick: () => void }) {
  const open = summary.seen + summary.missed;
  const percent = open ? Math.round((summary.seen / open) * 100) : 0;
  const ringStyle = { "--coverage": `${percent * 3.6}deg` } as CSSProperties;
  // Відсоток покриття означає «скільки ринку команда вже веде у себе». Без
  // внутрішнього файлу порівнювати нема з чим, тому замість 0 % показуємо обсяг
  // ринку, який чекає на підключення джерела.
  return (
    <button type="button" className="role-panel coverage-panel" onClick={onClick}>
      <header><div><span>ЦІЛЬОВИЙ РИНОК</span><h2>{hasRegistry ? "Скільки бачить команда" : "Ринок без внутрішнього джерела"}</h2></div><b>{periodLabel}</b></header>
      <div className="coverage-body">
        {hasRegistry
          ? <div className="coverage-ring" style={ringStyle}><strong>{percent}%</strong><small>у роботі</small></div>
          : <div className="coverage-ring no-source"><strong>{integer(summary.untracked)}</strong><small>без джерела</small></div>}
        {hasRegistry
          ? <dl><div><dt>Команда бачить</dt><dd>{integer(summary.seen)} · {money(summary.seenValue)}</dd></div><div className="risk"><dt>Підтверджено не в Excel</dt><dd>{integer(summary.missed)} · {money(summary.missedValue)}</dd></div>{summary.untracked ? <div><dt>Немає внутрішнього джерела</dt><dd>{integer(summary.untracked)} тендерів</dd></div> : null}</dl>
          : <dl><div><dt>Цільовий ринок напрямку</dt><dd>{integer(summary.untracked)} · {money(summary.untrackedValue)}</dd></div><div><dt>Поза цільовою територією</dt><dd>{integer(summary.outsideScope)} тендерів</dd></div><div><dt>Уточнити місце робіт</dt><dd>{integer(summary.unknownTerritory)} тендерів</dd></div></dl>}
      </div>
    </button>
  );
}

function SevenDayChart({ points, periodLabel }: { points: MarketCoveragePoint[]; periodLabel: string }) {
  const rows = points.slice(-14);
  const maximum = Math.max(...rows.map((point) => point.seen + point.missed), 1);
  return (
    <article className="role-panel pulse-panel">
      <header><div><span>ПОТОК ТЕНДЕРІВ</span><h2>Що заходило щодня</h2></div><b>{periodLabel}</b></header>
      <div className="pulse-chart">
        {rows.map((point) => {
          const total = point.seen + point.missed;
          const seenHeight = (point.seen / maximum) * 100;
          const missedHeight = (point.missed / maximum) * 100;
          return (
            <div
              className="pulse-day"
              key={point.date}
              tabIndex={0}
              aria-label={`${date(point.date)}: ${total} відкритих; команда бачить ${point.seen}; поза командою ${point.missed}`}
            >
              <div className="pulse-column"><i className="seen" style={{ height: `${seenHeight}%` }} /><i className="missed" style={{ height: `${missedHeight}%` }} /></div>
              <b>{total}</b>
              <span>{shortDay(point.date)}</span>
              <span className="pulse-tooltip" role="tooltip">
                <strong>{date(point.date)}</strong>
                <em><i className="seen" />Команда бачить <b>{integer(point.seen)} · {money(point.seenValue)}</b></em>
                <em><i className="missed" />Не в роботі <b>{integer(point.missed)} · {money(point.missedValue)}</b></em>
                {point.outsideScope ? <em><i className="outside" />Інші області <b>{integer(point.outsideScope)} · {money(point.outsideScopeValue)}</b></em> : null}
              </span>
            </div>
          );
        })}
      </div>
      <footer><span><i className="seen" />Команда бачить</span><span><i className="missed" />Не в роботі</span></footer>
    </article>
  );
}

/**
 * Кольорова смуга без підпису нечитабельна, тому кожен сегмент — це кнопка
 * з підказкою (етап, кількість, частка, сума) і переходом у відповідний фільтр.
 */
function StagePanel({ counts, activeTenders, activeValue, onWork }: { counts: StageCounts; activeTenders: InternalTender[]; activeValue: number; onWork: (target: RoleWorkTarget) => void }) {
  const stageCodes: Record<Exclude<RoleWorkTarget, "active" | "stale" | "idle" | "all">, string[]> = {
    analysis: ["analysis"],
    preparing: ["preparing"],
    submitted: ["submitted", "qualification"],
    complaints: ["complaint-terms", "complaint-competitor", "complaint-own-disqualification"],
  };
  const items = ([
    { id: "analysis", label: "Аналіз" },
    { id: "preparing", label: "Готують" },
    { id: "submitted", label: "Подано" },
    { id: "complaints", label: "Скарги" },
  ] as const).map((item) => ({
    ...item,
    value: counts[item.id],
    sum: activeTenders
      .filter((tender) => stageCodes[item.id].includes(tender.statusCode))
      .reduce((total, tender) => total + tender.value, 0),
  }));
  const total = Math.max(items.reduce((sum, item) => sum + item.value, 0), 1);
  return (
    <article className="role-panel stage-panel">
      <header><div><span>ПОРТФЕЛЬ КОМАНДИ</span><h2>{money(activeValue)} у роботі</h2></div><button type="button" onClick={() => onWork("active")}>Відкрити</button></header>
      <div className="stage-bar" role="group" aria-label="Етапи роботи">
        {items.filter((item) => item.value > 0).map((item) => (
          <button
            type="button"
            key={item.id}
            className={item.id}
            style={{ width: `${(item.value / total) * 100}%` }}
            onClick={() => onWork(item.id)}
            aria-label={`${item.label}: ${item.value} із ${total}, ${money(item.sum)}`}
          >
            <span className="stage-tip">
              <b>{item.label}</b>
              <em>{integer(item.value)} із {integer(total)} · {Math.round((item.value / total) * 100)}%</em>
              <i>{money(item.sum)}</i>
            </span>
          </button>
        ))}
      </div>
      <div className="stage-cells">{items.map((item) => <button type="button" key={item.id} onClick={() => onWork(item.id)}><strong>{item.value}</strong><span>{item.label}</span><small>{item.sum ? money(item.sum) : "—"}</small></button>)}</div>
    </article>
  );
}

function DirectionPanel({ points, onMarket }: { points: MarketCoveragePoint[]; onMarket: () => void }) {
  const rows = directions.map((direction) => ({ direction, ...sumCoverage(points.map((point) => point.byDirection[direction])) }));
  const maximum = Math.max(...rows.map((row) => row.seen + row.missed), 1);
  return (
    <article className="role-panel direction-panel">
      <header><div><span>НАПРЯМКИ</span><h2>Де зараз ринок</h2></div><button type="button" onClick={onMarket}>Деталі</button></header>
      <div className="direction-bars">{rows.map((row) => <div key={row.direction}><span>{row.direction === "Капбудівництво" ? "Будівництво" : row.direction}</span><i><em style={{ width: `${((row.seen + row.missed) / maximum) * 100}%` }} /></i><b>{row.seen + row.missed}</b><small>{money(row.seenValue + row.missedValue)}</small></div>)}</div>
    </article>
  );
}

function SignalPanel({ stale, idle, unclassified, onWork }: { stale: number; idle: number; unclassified: number; onWork: (target: RoleWorkTarget) => void }) {
  return (
    <article className="role-panel signal-panel">
      <header><div><span>СИГНАЛИ</span><h2>Де потрібен контроль</h2></div></header>
      <button type="button" onClick={() => onWork("stale")}><strong>{stale}</strong><span>подача минула, а статус ні</span><b>Оновити</b></button>
      <button type="button" onClick={() => onWork("idle")}><strong>{idle}</strong><span>подано, але без руху 45+ дн.</span><b>Перевірити</b></button>
      <button type="button" onClick={() => onWork("all")}><strong>{unclassified}</strong><span>майбутніх без статусу</span><b>Розібрати</b></button>
    </article>
  );
}

function OpportunityPanel({ items, onMarket }: { items: MarketCoverageTenderView[]; onMarket: () => void }) {
  return (
    <article className="role-panel opportunity-panel">
      <header><div><span>НАЙБІЛЬШІ ПРОГАЛИНИ</span><h2>Гроші поза увагою</h2></div><button type="button" onClick={onMarket}>Усі</button></header>
      <div>{items.slice(0, 4).map((item) => <a key={item.id} href={item.prozorroUrl} target="_blank" rel="noreferrer"><span>{item.direction === "Капбудівництво" ? "Будівництво" : item.direction}</span><b>{item.title}</b><strong>{money(item.amount)}</strong></a>)}</div>
    </article>
  );
}

function QueuePanel({ title, eyebrow, items, today, onOpen }: { title: string; eyebrow: string; items: InternalTender[]; today: string; onOpen: (tender: InternalTender) => void }) {
  return (
    <article className="role-panel queue-panel">
      <header><div><span>{eyebrow}</span><h2>{title}</h2></div></header>
      <div>{items.slice(0, 8).map((item) => {
        const days = item.deadline ? Math.round((Date.parse(`${item.deadline}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000) : null;
        const deadline = days === null ? "без дати" : days < 0 ? "статус прострочено" : days === 0 ? "сьогодні" : days === 1 ? "завтра" : `через ${days} дн.`;
        return <button type="button" key={item.id} onClick={() => onOpen(item)}><span><em>{item.status}</em><b>{item.title}</b><small>{item.buyer}</small></span><strong>{money(item.value)}<small>{deadline}</small></strong></button>;
      })}</div>
    </article>
  );
}

export function OwnerModule(props: RoleModuleProps) {
  const { data, activeTenders, staleTenders, unclassifiedFuture, marketNeedReview, activeValue, stageCounts, idleTenders, hasRegistry, scopeDirection, periodDays, periodLabel, scopeFilter, onWork, onMarket, onCompetitors } = props;
  const weekly = data.coverage.daily.slice(-periodDays);
  const summary = sumCoverage(weekly);
  const open = summary.seen + summary.missed;
  const coveragePercent = open ? Math.round((summary.seen / open) * 100) : 0;
  return (
    <div className="role-dashboard owner-role-dashboard">
      <ModuleHead role="МОДУЛЬ ДИРЕКТОРА" title="Пульс бізнесу" stamp={`${date(data.control.today)} · ${periodLabel}`} />
      {hasRegistry ? null : <RegistryNotice direction={scopeDirection} onMarket={onMarket} />}
      <section className="role-metrics owner-metrics">
        <Metric label="Цільовий ринок" hint="Закупівлі Prozorro за період, що підходять профілю і території Спецсервісу." value={integer(open)} detail={money(summary.seenValue + summary.missedValue)} onClick={onMarket} />
        <Metric label="Покриття командою" hint="Частка цільового ринку, яку команда вже веде у себе: бачить ÷ (бачить + не знайдені). Це відсоток, а не список." value={`${coveragePercent}%`} detail={`${integer(summary.seen)} тендерів`} tone="good" onClick={onMarket} />
        <Metric label="Підтверджено не в Excel" hint="Конкретні закупівлі, яких у файлі немає. Саме вони і зменшують покриття вище." value={integer(summary.missed)} detail={money(summary.missedValue)} tone="risk" onClick={onMarket} />
        <Metric label="Портфель у роботі" hint="Тендери в активних статусах: аналіз, підготовка, подано, кваліфікація, скарги від нас." value={integer(activeTenders.length)} detail={money(activeValue)} tone="accent" onClick={() => onWork("active")} />
        <Metric label="Конкурентні дані" hint="Наскільки заповнені колонки «Учасник 1–4» у файлі. Це повнота даних, а не кількість конкурентів." value={`${data.competitorRadar.participantCoverage}%`} detail="заповнено в Excel" onClick={onCompetitors} />
      </section>
      <section className="role-grid owner-grid-top"><CoverageCard summary={summary} hasRegistry={hasRegistry} periodLabel={periodLabel} onClick={onMarket} /><SevenDayChart points={weekly} periodLabel={periodLabel} /><StagePanel counts={stageCounts} activeTenders={activeTenders} activeValue={activeValue} onWork={onWork} /></section>
      <section className="role-grid owner-grid-bottom"><DirectionPanel points={weekly} onMarket={onMarket} /><OpportunityPanel items={marketNeedReview} onMarket={onMarket} /><SignalPanel stale={staleTenders.length} idle={idleTenders.length} unclassified={unclassifiedFuture.length} onWork={onWork} /></section>
      <section className="role-grid owner-grid-share"><MarketShare direction={scopeFilter} territory="all" title="Скільки з договорів дістається нам" /></section>
    </div>
  );
}

export function ManagerModule(props: RoleModuleProps) {
  const { data, activeTenders, staleTenders, marketNeedReview, activeValue, stageCounts, idleTenders, hasRegistry, scopeDirection, periodDays, periodLabel, onWork, onMarket, onOpenInternal } = props;
  const urgent = [...activeTenders].sort((a, b) => (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999") || b.value - a.value);
  const weekly = data.coverage.daily.slice(-periodDays);
  const summary = sumCoverage(weekly);
  return (
    <div className="role-dashboard manager-role-dashboard">
      <ModuleHead role="МОДУЛЬ КЕРІВНИКА" title="Контроль команди" stamp={date(data.control.today)} />
      {hasRegistry ? null : <RegistryNotice direction={scopeDirection} onMarket={onMarket} />}
      <section className="role-metrics manager-metrics">
        <Metric label="У роботі" value={integer(activeTenders.length)} detail={money(activeValue)} tone="accent" onClick={() => onWork("active")} />
        <Metric label="Дедлайн сьогодні" value={integer(data.control.dueToday.count)} detail={money(data.control.dueToday.value)} tone="risk" onClick={() => onWork("active")} />
        <Metric label="Наступні 72 години" value={integer(data.control.due72h.count)} detail={money(data.control.due72h.value)} onClick={() => onWork("active")} />
        <Metric label="Статус застарів" hint="Подача вже минула, а статус досі «Аналіз» чи «Готуємо пропозицію»." value={integer(staleTenders.length)} detail="потрібне оновлення" tone="risk" onClick={() => onWork("stale")} />
        <Metric label="Без руху 45+ дн." hint="Подано або на кваліфікації, але з дня закриття подачі минуло понад 45 днів. Найімовірніше, статус просто не оновлювали." value={integer(idleTenders.length)} detail="перевірити результат" onClick={() => onWork("idle")} />
      </section>
      <section className="role-grid manager-grid"><StagePanel counts={stageCounts} activeTenders={activeTenders} activeValue={activeValue} onWork={onWork} /><CoverageCard summary={summary} hasRegistry={hasRegistry} periodLabel={periodLabel} onClick={onMarket} /></section>
      <section className="role-grid manager-work-grid"><QueuePanel eyebrow="НАЙБЛИЖЧІ ДЕДЛАЙНИ" title="Черга контролю" items={urgent} today={data.control.today} onOpen={onOpenInternal} /><OpportunityPanel items={marketNeedReview} onMarket={onMarket} /></section>
    </div>
  );
}

export function EmployeeModule(props: RoleModuleProps) {
  const { data, activeTenders, staleTenders, marketNeedReview, stageCounts, hasRegistry, scopeDirection, onWork, onMarket, onOpenInternal } = props;
  const workQueue = [...activeTenders, ...staleTenders].sort((a, b) => (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999") || b.value - a.value);
  return (
    <div className="role-dashboard employee-role-dashboard">
      <ModuleHead role="МОДУЛЬ ПРАЦІВНИКА" title="Робочий стіл" stamp={date(data.control.today)} />
      {hasRegistry ? null : <RegistryNotice direction={scopeDirection} onMarket={onMarket} />}
      <section className="role-metrics employee-metrics">
        <Metric label="Подати сьогодні" value={integer(data.control.dueToday.count)} detail={money(data.control.dueToday.value)} tone="risk" onClick={() => onWork("active")} />
        <Metric label="До 72 годин" value={integer(data.control.due72h.count)} detail="найближчі подачі" tone="accent" onClick={() => onWork("active")} />
        <Metric label="Готуємо" value={integer(stageCounts.preparing)} detail="активні пропозиції" tone="good" onClick={() => onWork("preparing")} />
        <Metric label="Оновити статус" value={integer(staleTenders.length)} detail="подача вже минула" onClick={() => onWork("stale")} />
      </section>
      {hasRegistry && !data.control.dataQuality.hasAssigneeField ? <div className="employee-source-warning"><b>Загальна черга</b><span>У закупівлі.xlsx немає поля «Відповідальний», тому персональні задачі поки неможливо розподілити автоматично.</span></div> : null}
      <section className="role-grid employee-grid"><QueuePanel eyebrow="ЩО РОБИТИ ДАЛІ" title="Черга за дедлайном" items={workQueue} today={data.control.today} onOpen={onOpenInternal} /><OpportunityPanel items={marketNeedReview} onMarket={onMarket} /></section>
    </div>
  );
}
