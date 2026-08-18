"use client";

import { useEffect } from "react";
import { ArrowUpRight, Building2, CalendarDays, CircleDollarSign, MapPin, Tag, X } from "lucide-react";
import { date, money } from "@/lib/dashboard-data";
import type { InternalTender, LiveTender } from "@/lib/types";

export type TenderSelection =
  | { kind: "internal"; item: InternalTender }
  | { kind: "live"; item: LiveTender };

export function TenderDrawer({ selected, onClose }: { selected: TenderSelection | null; onClose: () => void }) {
  useEffect(() => {
    if (!selected) return;
    const close = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", close);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", close);
      document.body.style.overflow = "";
    };
  }, [selected, onClose]);

  if (!selected) return null;
  const live = selected.kind === "live";
  const item = selected.item;
  const amount = selected.kind === "live" ? selected.item.amount : selected.item.value;
  const deadline = item.deadline;

  return (
    <div className="drawer-backdrop" role="presentation" onMouseDown={onClose}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="Деталі тендера" onMouseDown={(event) => event.stopPropagation()}>
        <div className="drawer-head">
          <span className={`source-pill ${live ? "is-live" : ""}`}>{live ? "LIVE · SMARTTENDER" : "SHAREPOINT · ЗАКУПІВЛІ.XLSX"}</span>
          <button className="icon-button" onClick={onClose} aria-label="Закрити"><X size={19} /></button>
        </div>
        <div className="drawer-title">
          <span>{item.direction}</span>
          <h2>{item.title}</h2>
          <p>{selected.kind === "live" ? selected.item.cdbNumber : `Внутрішній запис №${selected.item.id}`}</p>
        </div>
        <div className="drawer-kpis">
          <div><CircleDollarSign size={17} /><span>Очікувана вартість</span><b>{money(amount)}</b></div>
          <div><CalendarDays size={17} /><span>Подання до</span><b>{date(deadline)}</b></div>
        </div>
        <div className="drawer-section">
          <h3>Замовник</h3>
          <div className="drawer-row"><Building2 size={17} /><div><b>{item.buyer}</b><span>ЄДРПОУ: {item.buyerEdrpou || "—"}</span></div></div>
          {selected.kind === "live" && <div className="drawer-row"><MapPin size={17} /><div><b>{selected.item.delivery}</b><span>Місце виконання</span></div></div>}
        </div>
        {selected.kind === "live" ? (
          <>
            <div className="drawer-section">
              <h3>Оцінка можливості</h3>
              <div className="score-block"><strong>{selected.item.relevance}</strong><span>/ 100</span><div><b>{selected.item.relevanceLabel} відповідність</b><p>Напрям, CPV, ключові слова та географія</p></div></div>
              <div className="tag-list"><Tag size={15} />{selected.item.cpv.length ? selected.item.cpv.map((code) => <span key={code}>{code}</span>) : <span>CPV не вказано</span>}</div>
            </div>
            <a className="drawer-primary" href={selected.item.prozorroUrl} target="_blank" rel="noreferrer">Відкрити в Prozorro <ArrowUpRight size={17} /></a>
          </>
        ) : (
          <>
            <div className="drawer-section">
              <h3>Рішення команди</h3>
              <dl className="decision-list">
                <div><dt>Статус</dt><dd>{selected.item.status}</dd></div>
                <div><dt>Причина</dt><dd>{selected.item.reason}</dd></div>
                <div><dt>Кваліфікація</dt><dd>{selected.item.qualification || "—"}</dd></div>
                <div><dt>Принципове рішення</dt><dd>{selected.item.decision || "—"}</dd></div>
                <div><dt>Кошторис / специфіка</dt><dd>{selected.item.estimateNotes || "—"}</dd></div>
                {selected.item.comment && <div><dt>Коментар</dt><dd>{selected.item.comment}</dd></div>}
              </dl>
            </div>
            {selected.item.participants.length > 0 && <div className="drawer-section"><h3>Учасники</h3><ol className="participant-list">{selected.item.participants.map((participant) => <li key={participant}>{participant}</li>)}</ol></div>}
          </>
        )}
      </aside>
    </div>
  );
}
