"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowUpRight, X } from "lucide-react";
import { date, integer, money } from "@/lib/dashboard-data";
import type { Direction } from "@/lib/types";

/**
 * Картка компанії. Живе окремо, бо відкривається з двох місць: із таблиці
 * конкурентів і з донату частки ринку. Портал у <body> обовʼязковий — предки
 * мають `transform` після анімації появи, і всередині них `position: fixed`
 * прив'язується не до вікна, а до всієї висоти сторінки.
 */

export type CompetitorCompany = {
  key: string;
  name: string;
  edrpou: string;
  region: string;
  isSpecservis: boolean;
  participations: number;
  wins: number;
  losses: number;
  pending: number;
  disqualified: number;
  winRate: number;
  bidValue: number;
  wonValue: number;
  soloWins: number;
  metSpecservis: number;
  beatSpecservis: number;
  lostToSpecservis: number;
};

export type CompetitorTender = {
  cdbNumber: string;
  title: string;
  buyer: string;
  direction: Exclude<Direction, "Інше">;
  publishedAt: string;
  bidAmount: number;
  won: boolean;
  decided: boolean;
  disqualified: boolean;
  rivals: number;
  territoryLabel: string;
  againstSpecservis: boolean;
  prozorroUrl: string;
};

export type CompetitorDetail = {
  company: CompetitorCompany;
  topBuyers: Array<{ name: string; count: number; won: number }>;
  tenders: CompetitorTender[];
};

type Outcome = "all" | "won" | "lost" | "pending";

/** Довгі юридичні форми з'їдають місце в підписах, тому скорочуємо їх. */
export function compactName(value: string) {
  return value
    .replace(/ТОВАРИСТВО З ОБМЕЖЕНОЮ ВІДПОВІДАЛЬНІСТЮ/gi, "ТОВ")
    .replace(/ПРИВАТНЕ АКЦІОНЕРНЕ ТОВАРИСТВО/gi, "ПрАТ")
    .replace(/ПУБЛІЧНЕ АКЦІОНЕРНЕ ТОВАРИСТВО/gi, "ПАТ")
    .replace(/ПРИВАТНЕ ПІДПРИЄМСТВО/gi, "ПП")
    .replace(/ФІЗИЧНА ОСОБА[- ]ПІДПРИЄМЕЦЬ/gi, "ФОП")
    .replace(/ДЕРЖАВНЕ ПІДПРИЄМСТВО/gi, "ДП")
    .replace(/КОМУНАЛЬНЕ ПІДПРИЄМСТВО/gi, "КП")
    .replace(/\s+/g, " ")
    .trim();
}

export function useCompetitorDetail(days: number, territory: "all" | "target", direction: Exclude<Direction, "Інше"> | null) {
  const [detail, setDetail] = useState<CompetitorDetail | null>(null);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);

  const open = async (key: string) => {
    setLoadingKey(key);
    const params = new URLSearchParams({ days: String(days), territory, company: key });
    if (direction) params.set("direction", direction);
    try {
      const response = await fetch(`/api/competitors?${params}`, { cache: "no-store" });
      if (response.ok) setDetail(await response.json() as CompetitorDetail);
    } finally {
      setLoadingKey(null);
    }
  };

  return { detail, loadingKey, open, close: () => setDetail(null) };
}

export function CompetitorDrawer({ detail, onClose }: { detail: CompetitorDetail | null; onClose: () => void }) {
  const [outcome, setOutcome] = useState<Outcome>("all");
  // Нова компанія — новий фільтр. Скидаємо під час рендера, а не в ефекті,
  // щоб не було зайвого циклу зі старим фільтром на екрані.
  const companyKey = detail?.company.key ?? null;
  const [shownKey, setShownKey] = useState(companyKey);
  if (shownKey !== companyKey) {
    setShownKey(companyKey);
    if (outcome !== "all") setOutcome("all");
  }

  useEffect(() => {
    if (!detail) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", close);
    document.documentElement.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", close);
      document.documentElement.style.overflow = "";
    };
  }, [detail, onClose]);

  if (!detail) return null;

  const all = detail.tenders;
  const outcomes: Array<{ id: Outcome; label: string; count: number }> = [
    { id: "all", label: "Усі", count: all.length },
    { id: "won", label: "Виграв", count: all.filter((tender) => tender.won).length },
    { id: "lost", label: "Програв", count: all.filter((tender) => !tender.won && tender.decided).length },
    { id: "pending", label: "Триває", count: all.filter((tender) => !tender.won && !tender.decided).length },
  ];
  const visible = all.filter((tender) => outcome === "all"
    || (outcome === "won" && tender.won)
    || (outcome === "lost" && !tender.won && tender.decided)
    || (outcome === "pending" && !tender.won && !tender.decided));
  const company = detail.company;

  return createPortal(
    <div className="drawer-backdrop" role="presentation" onMouseDown={onClose}>
      <aside className="drawer rivals-drawer" role="dialog" aria-modal="true" aria-label="Деталі конкурента" onMouseDown={(event) => event.stopPropagation()}>
        <div className="drawer-head">
          <span className={company.isSpecservis ? "source-pill is-live" : "source-pill"}>
            {company.isSpecservis ? "ЦЕ ВАША КОМПАНІЯ" : "PROZORRO · РЕАЛЬНІ СТАВКИ"}
          </span>
          <button className="icon-button" onClick={onClose} aria-label="Закрити"><X size={19} /></button>
        </div>
        <div className="drawer-title">
          <span>{company.region || "Регіон не вказано"}</span>
          <h2>{compactName(company.name)}</h2>
          <p>{company.edrpou ? `ЄДРПОУ ${company.edrpou}` : "ЄДРПОУ не вказано"}</p>
        </div>
        <div className="rivals-kpis">
          <div><span>Участей</span><b>{integer(company.participations)}</b></div>
          <div><span>Перемог</span><b>{integer(company.wins)}</b></div>
          <div><span>Відсоток</span><b>{company.wins + company.losses ? `${company.winRate}%` : "—"}</b></div>
          <div><span>Ще в процесі</span><b>{integer(company.pending)}</b></div>
        </div>
        <div className="drawer-section">
          <h3>Підсумок за період</h3>
          <dl className="decision-list">
            <div><dt>Сума укладених договорів</dt><dd>{money(company.wonValue)}</dd></div>
            <div><dt>Сума всіх пропозицій</dt><dd>{money(company.bidValue)}</dd></div>
            <div><dt>Перемоги без суперників</dt><dd>{integer(company.soloWins)} із {integer(company.wins)}</dd></div>
            <div><dt>Дискваліфікації</dt><dd>{integer(company.disqualified)}</dd></div>
            <div><dt>Зустрічі зі Спецсервісом</dt><dd>{company.isSpecservis ? "це ваша компанія" : company.metSpecservis ? `${company.metSpecservis} · виграли вони ${company.beatSpecservis}, виграли ми ${company.lostToSpecservis}` : "не перетиналися"}</dd></div>
          </dl>
        </div>
        {detail.topBuyers.length ? (
          <div className="drawer-section">
            <h3>Основні замовники</h3>
            <ol className="participant-list">{detail.topBuyers.map((buyer) => <li key={buyer.name}>{buyer.name} — {buyer.count} закупівель, виграно {buyer.won}</li>)}</ol>
          </div>
        ) : null}
        <div className="drawer-section">
          <h3>Закупівлі ({visible.length} із {all.length})</h3>
          <div className="rivals-outcome-tabs">
            {outcomes.map((item) => (
              <button type="button" key={item.id} className={outcome === item.id ? "active" : ""} onClick={() => setOutcome(item.id)}>
                {item.label} <b>{item.count}</b>
              </button>
            ))}
          </div>
          <div className="rivals-tender-list">
            {visible.map((tender) => (
              <a key={`${tender.cdbNumber}-${tender.bidAmount}`} href={tender.prozorroUrl} target="_blank" rel="noreferrer" className={tender.won ? "won" : ""}>
                <span className="rivals-tender-head">
                  <em>{tender.won ? "Виграв" : tender.disqualified ? "Дискваліфіковано" : tender.decided ? "Програв" : "Триває"}</em>
                  <small>{date(tender.publishedAt)} · {tender.rivals === 1 ? "без суперників" : `${tender.rivals} учасники`}{tender.againstSpecservis ? " · проти нас" : ""}</small>
                </span>
                <b>{tender.title}</b>
                <small>{tender.buyer}</small>
                <span className="rivals-tender-foot">
                  <strong>{money(tender.bidAmount)}</strong>
                  <small>{tender.territoryLabel}</small>
                  <ArrowUpRight size={14} />
                </span>
              </a>
            ))}
            {!visible.length ? <p className="rivals-empty">За цим фільтром закупівель немає.</p> : null}
          </div>
        </div>
      </aside>
    </div>,
    document.body,
  );
}
