"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  BriefcaseBusiness,
  ChevronDown,
  ClipboardCheck,
  LayoutDashboard,
  Landmark,
  LoaderCircle,
  LogOut,
  Menu,
  Network,
  ScanSearch,
  UsersRound,
  WalletCards,
  X,
} from "lucide-react";
import type { DashboardViewer } from "@/lib/dashboard-data";

export type FastTenderView = "market" | "competitors" | "projects" | "tender-workspace";
type TenderView = "overview" | "work" | FastTenderView;
type DirectionScope = "all" | NonNullable<DashboardViewer["direction"]>;

const ProjectsView = dynamic(() => import("@/components/projects-view").then((module) => module.ProjectsView), { loading: ModuleLoading });
const AnalyticsV2View = dynamic(() => import("@/components/analytics-v2-view").then((module) => module.AnalyticsV2View), { loading: ModuleLoading });
const MonitoringV2View = dynamic(() => import("@/components/monitoring-v2-view").then((module) => module.MonitoringV2View), { loading: ModuleLoading });
const TenderWorkspace = dynamic(() => import("@/components/tender-workspace").then((module) => module.TenderWorkspace), { loading: ModuleLoading });

const navigation = [
  { id: "overview" as const, label: "Головна", hint: "Ваш дашборд", icon: LayoutDashboard },
  { id: "work" as const, label: "Тендери команди", hint: "SharePoint", icon: BriefcaseBusiness },
  { id: "tender-workspace" as const, label: "Робоча черга", hint: "Кондиціонування", icon: ClipboardCheck },
  { id: "projects" as const, label: "Проєкти", hint: "Стадії та люди", icon: Network },
  { id: "market" as const, label: "Ринок Prozorro", hint: "Нові можливості", icon: ScanSearch },
  { id: "competitors" as const, label: "Аналітика", hint: "Участі й договори", icon: UsersRound },
];

const roleLabels: Record<DashboardViewer["role"], string> = {
  owner: "Директор",
  manager: "Керівник напрямку",
  employee: "Працівник",
};

const directionLabels: Record<DirectionScope, string> = {
  all: "Уся компанія",
  "Капбудівництво": "Капітальне будівництво",
  "Сервіс": "Сервіс",
  "Кондиціонування": "Кондиціонування",
};

function ModuleLoading() {
  return (
    <section className="owner-page-head" aria-live="polite">
      <div><span>ВІДКРИВАЄМО МОДУЛЬ</span><h1>Готуємо робочий екран</h1><p>Меню та навігація вже доступні.</p></div>
      <LoaderCircle className="spin" size={24} />
    </section>
  );
}

function isAllowed(viewer: DashboardViewer, view: TenderView) {
  if (view === "tender-workspace") return Boolean(viewer.tenderWorkspaceAccess);
  if (viewer.role === "employee") return view !== "projects" && view !== "competitors";
  return true;
}

function hrefFor(view: TenderView) {
  return view === "overview" ? "/" : `/?view=${view}`;
}

export function FastTenderDashboard({ viewer, initialView }: { viewer: DashboardViewer; initialView: FastTenderView }) {
  const router = useRouter();
  const [view, setView] = useState<FastTenderView>(initialView);
  const [directionScope, setDirectionScope] = useState<DirectionScope>(viewer.direction ?? "all");
  const [mobileMenu, setMobileMenu] = useState(false);
  const [monitoringTotal, setMonitoringTotal] = useState<number | null>(null);

  const availableNavigation = navigation
    .filter((item) => viewer.role !== "employee" || (item.id !== "projects" && item.id !== "competitors"))
    .filter((item) => item.id !== "tender-workspace" || Boolean(viewer.tenderWorkspaceAccess));
  const currentPage = availableNavigation.find((item) => item.id === view) ?? availableNavigation[0];

  const navigate = (target: TenderView) => {
    if (!isAllowed(viewer, target)) return;
    setMobileMenu(false);
    if (target === "market" || target === "competitors" || target === "projects" || target === "tender-workspace") {
      setView(target);
      window.history.pushState({ view: target }, "", hrefFor(target));
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    router.push(hrefFor(target));
  };

  useEffect(() => {
    const restore = () => {
      const candidate = new URL(window.location.href).searchParams.get("view") as TenderView | null;
      if (candidate && isAllowed(viewer, candidate) && ["market", "competitors", "projects", "tender-workspace"].includes(candidate)) {
        setView(candidate as FastTenderView);
      }
    };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [viewer]);

  return (
    <div className="owner-app">
      <aside className={mobileMenu ? "owner-sidebar open" : "owner-sidebar"}>
        <button type="button" className="owner-brand" onClick={() => navigate("overview")} aria-label="Спецсервіс — головна"><span className="owner-brand-logo" /></button>
        <div className="owner-account"><span>{viewer.label.slice(0, 1)}</span><div><b>{viewer.label}</b><small>{roleLabels[viewer.role]}</small></div></div>
        <nav aria-label="Головне меню">
          {availableNavigation.map((item) => {
            const Icon = item.icon;
            const count = item.id === "market" ? monitoringTotal : null;
            return <button type="button" key={item.id} className={view === item.id ? "active" : ""} onClick={() => navigate(item.id)}><Icon size={18} /><span><b>{item.label}</b><small>{item.hint}</small></span>{count !== null ? <em>{count}</em> : null}</button>;
          })}
        </nav>
        <div className="owner-sidebar-bottom">
          <div className="owner-side-sync live"><i /><span><b>Prozorro</b><small>оновлюється автоматично</small></span></div>
          <form action="/api/auth/logout" method="post"><button type="submit" className="owner-side-logout"><LogOut size={17} />Вийти із системи</button></form>
        </div>
      </aside>
      {mobileMenu ? <button type="button" className="owner-sidebar-backdrop" aria-label="Закрити меню" onClick={() => setMobileMenu(false)} /> : null}

      <div className="owner-workspace">
        <header className="owner-topbar">
          <div className="owner-page-context">
            <button type="button" className="owner-icon-button owner-menu" aria-label="Відкрити меню" onClick={() => setMobileMenu((value) => !value)}>{mobileMenu ? <X size={19} /> : <Menu size={19} />}</button>
            <div><span>Спецсервіс / {currentPage.label}</span><h1>{currentPage.label}</h1></div>
          </div>
          {viewer.financeAccess ? <nav className="owner-workspace-tabs" aria-label="Розділи кабінету"><button type="button" className="active"><Landmark size={16} />Тендери</button><button type="button" onClick={() => router.push("/?workspace=finance")}><WalletCards size={16} />Фінанси</button></nav> : null}
          <div className="owner-topbar-actions">
            <label className="owner-direction-select"><span>Напрямок</span><div><select value={directionScope} onChange={(event) => setDirectionScope(event.target.value as DirectionScope)} disabled={viewer.role !== "owner"}>{viewer.role === "owner" ? <option value="all">Уся компанія</option> : null}{viewer.availableDirections.map((direction) => <option key={direction} value={direction}>{directionLabels[direction]}</option>)}</select><ChevronDown size={15} /></div></label>
          </div>
        </header>

        <main className="owner-main">
          {view === "market" ? <div className="owner-stack"><MonitoringV2View key={directionScope} initialDirection={directionScope === "all" ? null : directionScope} canManage={viewer.role !== "employee"} canConfigureIntegrations={viewer.role === "owner"} onTotalChange={setMonitoringTotal} /></div> : null}
          {view === "competitors" ? <AnalyticsV2View key={directionScope} initialDirection={directionScope === "all" ? null : directionScope} /> : null}
          {view === "projects" ? <div className="owner-stack"><ProjectsView /></div> : null}
          {view === "tender-workspace" && viewer.tenderWorkspaceAccess ? <TenderWorkspace viewerId={viewer.id} /> : null}
        </main>
      </div>
    </div>
  );
}
