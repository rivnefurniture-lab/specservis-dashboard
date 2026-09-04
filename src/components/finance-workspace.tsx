"use client";

import { useState } from "react";
import {
  Landmark,
  LayoutDashboard,
  LogOut,
  Menu,
  WalletCards,
  X,
} from "lucide-react";
import { FinanceDashboard, type FinanceLocale } from "@/components/confidential-dashboard";
import type { ConfidentialTurnoverDataset } from "@/lib/confidential-turnover";
import type { DashboardViewer } from "@/lib/dashboard-data";

const financeNavigation = [
  { id: "finance-overview", icon: LayoutDashboard },
] as const;

type FinanceSection = (typeof financeNavigation)[number]["id"];

export function FinanceWorkspace({ viewer, dataset }: { viewer: DashboardViewer; dataset?: ConfidentialTurnoverDataset }) {
  const [section, setSection] = useState<FinanceSection>("finance-overview");
  const [mobileMenu, setMobileMenu] = useState(false);
  const [locale, setLocale] = useState<FinanceLocale>("uk");
  const ru = locale === "ru";

  const openTenders = () => window.location.assign("/");
  const navigate = (target: FinanceSection) => {
    setSection(target);
    setMobileMenu(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return <div className="owner-app">
    <aside className={mobileMenu ? "owner-sidebar open" : "owner-sidebar"}>
      <button type="button" className="owner-brand" onClick={openTenders} aria-label={ru ? "Спецсервис — главная" : "Спецсервіс — головна"}><span className="owner-brand-logo" /></button>
      <div className="owner-account"><span>{viewer.label.slice(0, 1)}</span><div><b>{viewer.label}</b><small>Директор</small></div></div>
      <nav aria-label={ru ? "Финансовое меню" : "Фінансове меню"}>
        {financeNavigation.map((item) => { const Icon = item.icon; return <button type="button" key={item.id} className={section === item.id ? "active" : ""} onClick={() => navigate(item.id)}><Icon size={18} /><span><b>{ru ? "Обзор" : "Огляд"}</b><small>{ru ? "Оборот и сотрудники" : "Оборот і працівники"}</small></span></button>; })}
      </nav>
      <div className="owner-sidebar-bottom">
        <div className="owner-side-sync"><i /><span><b>{ru ? "Финансовые данные" : "Фінансові дані"}</b><small>{ru ? "активный набор · без кеша" : "активний набір · без кешу"}</small></span></div>
        <form action="/api/auth/logout" method="post"><button type="submit" className="owner-side-logout"><LogOut size={17} />{ru ? "Выйти из системы" : "Вийти із системи"}</button></form>
      </div>
    </aside>
    {mobileMenu ? <button type="button" className="owner-sidebar-backdrop" aria-label={ru ? "Закрыть меню" : "Закрити меню"} onClick={() => setMobileMenu(false)} /> : null}

    <div className="owner-workspace">
      <header className="owner-topbar">
        <div className="owner-page-context">
          <button type="button" className="owner-icon-button owner-menu" aria-label={ru ? "Открыть меню" : "Відкрити меню"} onClick={() => setMobileMenu((value) => !value)}>{mobileMenu ? <X size={19} /> : <Menu size={19} />}</button>
          <div><span>{ru ? "Спецсервис / Финансы" : "Спецсервіс / Фінанси"}</span><h1>{ru ? "Финансы" : "Фінанси"}</h1></div>
        </div>
        <nav className="owner-workspace-tabs" aria-label={ru ? "Разделы кабинета" : "Розділи кабінету"}>
          <button type="button" onClick={openTenders}><Landmark size={16} />{ru ? "Тендеры" : "Тендери"}</button>
          <button type="button" className="active"><WalletCards size={16} />{ru ? "Финансы" : "Фінанси"}</button>
        </nav>
        <div className="owner-topbar-actions" />
      </header>
      <main className="owner-main"><FinanceDashboard dataset={dataset} locale={locale} onLocaleChange={setLocale} /></main>
    </div>
  </div>;
}
