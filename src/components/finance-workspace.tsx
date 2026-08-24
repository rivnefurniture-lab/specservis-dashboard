"use client";

import { useState } from "react";
import {
  BarChart3,
  CircleAlert,
  History,
  Landmark,
  LayoutDashboard,
  ListFilter,
  LogOut,
  Menu,
  UsersRound,
  WalletCards,
  X,
} from "lucide-react";
import { FinanceDashboard } from "@/components/confidential-dashboard";
import type { ConfidentialTurnoverDataset } from "@/lib/confidential-turnover";
import type { DashboardViewer } from "@/lib/dashboard-data";

const financeNavigation = [
  { id: "finance-overview", label: "Огляд", hint: "Основні показники", marker: "ОСНОВНІ ПОКАЗНИКИ", icon: LayoutDashboard },
  { id: "finance-focus", label: "Контроль", hint: "Факти для перевірки", marker: "ФАКТИ ДЛЯ ПЕРЕВІРКИ", icon: CircleAlert },
  { id: "finance-dynamics", label: "Динаміка", hint: "Зміни та джерела", marker: "ЗМІНА ДО ПОПЕРЕДНЬОГО РОКУ", icon: BarChart3 },
  { id: "finance-team", label: "Команда", hint: "FTE, оборот і ФОП", marker: "ЕКОНОМІКА КОМАНДИ", icon: UsersRound },
  { id: "finance-history", label: "Історія", hint: "Однакові періоди", marker: "ДИНАМІКА ЗА РОКАМИ", icon: History },
  { id: "finance-audit", label: "Місячні дані", hint: "Фільтри й сортування", marker: "ДЕТАЛІ ТА ПЕРЕВІРКА", icon: ListFilter },
] as const;

type FinanceSection = (typeof financeNavigation)[number]["id"];

export function FinanceWorkspace({ viewer, dataset }: { viewer: DashboardViewer; dataset?: ConfidentialTurnoverDataset }) {
  const [section, setSection] = useState<FinanceSection>("finance-overview");
  const [mobileMenu, setMobileMenu] = useState(false);

  const openTenders = () => window.location.assign("/");
  const navigate = (target: FinanceSection) => {
    setSection(target);
    setMobileMenu(false);
    const marker = financeNavigation.find((item) => item.id === target)?.marker;
    const element = [...document.querySelectorAll<HTMLElement>("main section")]
      .find((item) => marker && item.textContent?.includes(marker));
    element?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return <div className="owner-app">
    <aside className={mobileMenu ? "owner-sidebar open" : "owner-sidebar"}>
      <button type="button" className="owner-brand" onClick={openTenders} aria-label="Спецсервіс — головна"><span className="owner-brand-logo" /></button>
      <div className="owner-account"><span>{viewer.label.slice(0, 1)}</span><div><b>{viewer.label}</b><small>Директор</small></div></div>
      <nav aria-label="Фінансове меню">
        {financeNavigation.map((item) => { const Icon = item.icon; return <button type="button" key={item.id} className={section === item.id ? "active" : ""} onClick={() => navigate(item.id)}><Icon size={18} /><span><b>{item.label}</b><small>{item.hint}</small></span></button>; })}
      </nav>
      <div className="owner-sidebar-bottom">
        <div className="owner-side-sync"><i /><span><b>Фінансові дані</b><small>активний набір · без кешу</small></span></div>
        <form action="/api/auth/logout" method="post"><button type="submit" className="owner-side-logout"><LogOut size={17} />Вийти із системи</button></form>
      </div>
    </aside>
    {mobileMenu ? <button type="button" className="owner-sidebar-backdrop" aria-label="Закрити меню" onClick={() => setMobileMenu(false)} /> : null}

    <div className="owner-workspace">
      <header className="owner-topbar">
        <div className="owner-page-context">
          <button type="button" className="owner-icon-button owner-menu" aria-label="Відкрити меню" onClick={() => setMobileMenu((value) => !value)}>{mobileMenu ? <X size={19} /> : <Menu size={19} />}</button>
          <div><span>Спецсервіс / Фінанси</span><h1>Фінанси</h1></div>
        </div>
        <nav className="owner-workspace-tabs" aria-label="Розділи кабінету">
          <button type="button" onClick={openTenders}><Landmark size={16} />Тендери</button>
          <button type="button" className="active"><WalletCards size={16} />Фінанси</button>
        </nav>
        <div className="owner-topbar-actions" />
      </header>
      <main className="owner-main"><FinanceDashboard dataset={dataset} /></main>
    </div>
  </div>;
}
