"use client";

import { useCallback, useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { Hint } from "@/components/role-modules";
import { CompetitorDrawer, compactName, useCompetitorDetail, type CompetitorCompany } from "@/components/competitor-drawer";
import { integer, money } from "@/lib/dashboard-data";
import type { Direction } from "@/lib/types";

/**
 * Частка ринку за сумою укладених договорів.
 *
 * База навмисно вузька і про це сказано в інтерфейсі: рахуються лише конкурентні
 * процедури профілю Спецсервісу за обраний період, напрямок і територію. Прямі
 * договори без електронної системи — близько 81 % закупівель — не входять, бо
 * там немає конкуренції. Тому це «частка серед тих, з ким ми змагаємось»,
 * а не частка всього ринку.
 */

type SharePayload = {
  totals: { companies: number; tenders: number; bids: number; awardedValue: number; averageBidders: number; top5Share: number };
  own: CompetitorCompany | null;
  ownRank: number | null;
  ownShare: number;
  items: CompetitorCompany[];
};

type Slice = CompetitorCompany & { share: number; colour: string; isRest?: boolean };

const RADIUS = 62;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const TOP_SLICES = 8;
const OWN_COLOUR = "#25216f";
const REST_COLOUR = "#dfe2ec";
const PALETTE = ["#4a96cc", "#249b69", "#e88a35", "#7b7fd8", "#c5952d", "#9a6fb0", "#3fa39b", "#d06a6a"];

/**
 * Власний період, а не період сторінки. Конкурентна процедура отримує ставки
 * не в день публікації, а через тижні, тому на семиденному вікні часток
 * практично немає — і графік показував би порожнечу замість картини ринку.
 */
const WINDOWS = [
  { days: 31, label: "31 день" },
  { days: 90, label: "90 днів" },
  { days: 120, label: "Увесь зріз" },
] as const;

export function MarketShare({ direction, territory, title, defaultDays = 120 }: {
  direction: Exclude<Direction, "Інше"> | null;
  territory: "all" | "target";
  title: string;
  defaultDays?: number;
}) {
  const [data, setData] = useState<SharePayload | null>(null);
  const [error, setError] = useState("");
  const [active, setActive] = useState<string | null>(null);
  const [days, setDays] = useState(defaultDays);
  const { detail, open, close } = useCompetitorDetail(days, territory, direction);

  const load = useCallback(async (signal: AbortSignal) => {
    try {
      const params = new URLSearchParams({ days: String(days), territory, sort: "wonValue", limit: String(TOP_SLICES) });
      if (direction) params.set("direction", direction);
      const response = await fetch(`/api/competitors?${params}`, { cache: "no-store", signal });
      if (!response.ok) throw new Error("Не вдалося порахувати частку ринку");
      setData(await response.json() as SharePayload);
      setError("");
    } catch (cause) {
      if ((cause as Error).name !== "AbortError") setError(cause instanceof Error ? cause.message : "Невідома помилка");
    }
  }, [days, direction, territory]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => void load(controller.signal), 0);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [load]);

  const windowSwitch = (
    <div className="share-window">
      {WINDOWS.map((item) => (
        <button type="button" key={item.days} className={days === item.days ? "active" : ""} onClick={() => setDays(item.days)}>{item.label}</button>
      ))}
    </div>
  );
  const head = (
    <header>
      <div>
        <span>ЧАСТКА РИНКУ</span>
        <h2>{title}<Hint text="Рахується за сумою укладених договорів у конкурентних закупівлях вашого профілю за обраний період, напрямок і територію. Прямі договори без електронної процедури — близько 81 % закупівель — не входять: у них немає конкуренції. Це частка серед тих, з ким ви реально змагаєтесь." /></h2>
      </div>
      {windowSwitch}
    </header>
  );

  if (error) return <article className="role-panel share-panel">{head}<div className="owner-empty"><b>{error}</b></div></article>;
  if (!data) return <article className="role-panel share-panel">{head}<div className="share-loading"><LoaderCircle className="spin" size={22} /></div></article>;

  const total = data.totals.awardedValue;
  if (!total) {
    return (
      <article className="role-panel share-panel">
        {head}
        <div className="owner-empty"><b>За цим зрізом договорів ще немає</b><span>Розширте період або зніміть фільтр території.</span></div>
      </article>
    );
  }

  const top = data.items.slice(0, TOP_SLICES);
  const ownInTop = top.some((item) => item.isSpecservis);
  // Спецсервіс має бути в діаграмі завжди, навіть якщо не входить у топ за сумою.
  const shown = ownInTop || !data.own ? top : [...top.slice(0, TOP_SLICES - 1), data.own];
  const restValue = Math.max(total - shown.reduce((sum, item) => sum + item.wonValue, 0), 0);

  const slices: Slice[] = shown
    .map((item, index) => ({ ...item, share: (item.wonValue / total) * 100, colour: item.isSpecservis ? OWN_COLOUR : PALETTE[index % PALETTE.length] }))
    .sort((left, right) => right.share - left.share);

  if (restValue > 0) {
    slices.push({
      key: "__rest__", name: "Інші компанії", edrpou: "", region: "", isSpecservis: false,
      participations: 0, wins: 0, losses: 0, pending: 0, disqualified: 0, winRate: 0, bidValue: 0,
      wonValue: restValue, soloWins: 0, metSpecservis: 0, beatSpecservis: 0, lostToSpecservis: 0,
      share: (restValue / total) * 100, colour: REST_COLOUR, isRest: true,
    });
  }

  const hovered = slices.find((slice) => slice.key === active) ?? null;
  // Зсув кожного сегмента рахується наперед: мутувати змінну під час рендера не можна.
  const arcs = slices.reduce<Array<{ slice: Slice; length: number; offset: number }>>((acc, slice) => {
    const previous = acc.at(-1);
    const offset = previous ? previous.offset + previous.length : 0;
    acc.push({ slice, length: (slice.share / 100) * CIRCUMFERENCE, offset });
    return acc;
  }, []);
  // У легенді показуємо верхівку, але свій рядок закріплюємо завжди.
  const legend = slices.slice(0, 6);
  const ownSlice = slices.find((slice) => slice.isSpecservis);
  const legendRows = ownSlice && !legend.includes(ownSlice) ? [...legend, ownSlice] : legend;

  const openCompany = (slice: Slice) => { if (!slice.isRest) void open(slice.key); };

  return (
    <article className="role-panel share-panel">
      {head}
      <p className="share-total">Укладено договорів у зрізі: <b>{money(total)}</b></p>

      <div className="share-body">
        <div className="share-donut">
          <svg viewBox="0 0 160 160" role="img" aria-label={`Частка Спецсервісу — ${data.ownShare}%`}>
            <circle cx="80" cy="80" r={RADIUS} className="share-track" />
            {arcs.map(({ slice, length, offset }) => (
              <circle
                key={slice.key}
                cx="80"
                cy="80"
                r={RADIUS}
                stroke={slice.colour}
                strokeDasharray={`${length} ${CIRCUMFERENCE - length}`}
                strokeDashoffset={-offset}
                className={[
                  "share-slice",
                  slice.isSpecservis ? "own" : "",
                  active && active !== slice.key ? "dim" : "",
                  slice.isRest ? "" : "clickable",
                ].filter(Boolean).join(" ")}
                onMouseEnter={() => setActive(slice.key)}
                onMouseLeave={() => setActive(null)}
                onClick={() => openCompany(slice)}
              />
            ))}
          </svg>
          <div className="share-centre">
            {hovered ? (
              <>
                <strong>{hovered.share < 0.1 ? "<0,1" : hovered.share.toFixed(1)}%</strong>
                <small>{hovered.isRest ? "інші компанії" : compactName(hovered.name)}</small>
              </>
            ) : (
              <>
                <strong className={data.own ? "own" : ""}>{data.ownShare < 0.1 && data.ownShare > 0 ? "<0,1" : data.ownShare.toFixed(1)}%</strong>
                <small>частка Спецсервісу</small>
              </>
            )}
          </div>
        </div>

        <div className="share-side">
          <dl className="share-facts">
            {hovered && !hovered.isRest ? (
              <>
                <div><dt>Компанія</dt><dd>{compactName(hovered.name)}{hovered.edrpou ? ` · ЄДРПОУ ${hovered.edrpou}` : ""}</dd></div>
                <div><dt>Сума договорів</dt><dd>{money(hovered.wonValue)} · {hovered.share.toFixed(1)}%</dd></div>
                <div><dt>Перемоги</dt><dd>{integer(hovered.wins)} із {integer(hovered.wins + hovered.losses)} вирішених{hovered.wins + hovered.losses ? ` · ${hovered.winRate}%` : ""}</dd></div>
                <div><dt>Без суперників</dt><dd>{integer(hovered.soloWins)} із {integer(hovered.wins)} перемог</dd></div>
                <div><dt>Проти нас</dt><dd>{hovered.isSpecservis ? "це ваша компанія" : hovered.metSpecservis ? `${hovered.metSpecservis} зустрічей · виграли вони ${hovered.beatSpecservis}, виграли ми ${hovered.lostToSpecservis}` : "не перетиналися"}</dd></div>
              </>
            ) : hovered?.isRest ? (
              <>
                <div><dt>Інші компанії</dt><dd>{integer(Math.max(data.totals.companies - slices.length + 1, 0))} учасників поза діаграмою</dd></div>
                <div><dt>Сума договорів</dt><dd>{money(hovered.wonValue)} · {hovered.share.toFixed(1)}%</dd></div>
                <div><dt /><dd /></div>
                <div><dt /><dd /></div>
                <div><dt /><dd /></div>
              </>
            ) : (
              <>
                <div><dt>Наше місце</dt><dd>{data.ownRank ? `${data.ownRank} з ${integer(data.totals.companies)} компаній` : "ставок у цьому зрізі немає"}</dd></div>
                <div><dt>Наші договори</dt><dd>{data.own ? money(data.own.wonValue) : "—"}</dd></div>
                <div><dt>Перша пʼятірка тримає</dt><dd>{data.totals.top5Share}% усіх договорів</dd></div>
                <div><dt>Проаналізовано</dt><dd>{integer(data.totals.tenders)} закупівель · {integer(data.totals.bids)} ставок</dd></div>
                <div><dt>Учасників у середньому</dt><dd>{data.totals.averageBidders} на закупівлю</dd></div>
              </>
            )}
          </dl>

          {data.totals.tenders < 60 ? (
            <p className="share-thin">Замало даних за цей період: {integer(data.totals.tenders)} закупівель. Ставки й переможці зʼявляються за тижні після публікації, тому коротке вікно майже порожнє — візьміть довший період.</p>
          ) : null}

          <ul className="share-legend">
            {legendRows.map((slice) => (
              <li key={slice.key} className={slice.isSpecservis ? "own" : ""}>
                <button
                  type="button"
                  disabled={slice.isRest}
                  onMouseEnter={() => setActive(slice.key)}
                  onMouseLeave={() => setActive(null)}
                  onClick={() => openCompany(slice)}
                >
                  <i style={{ background: slice.colour }} />
                  <span>{slice.isRest ? "Інші компанії" : compactName(slice.name)}{slice.isSpecservis ? " · це ви" : ""}</span>
                  <b>{slice.share < 0.1 ? "<0,1" : slice.share.toFixed(1)}%</b>
                </button>
              </li>
            ))}
          </ul>
          <p className="share-hint-click">Натисніть на компанію, щоб побачити всі її закупівлі.</p>
        </div>
      </div>

      <CompetitorDrawer detail={detail} onClose={close} />
    </article>
  );
}
