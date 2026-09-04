"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import {
  BriefcaseBusiness,
  ChevronDown,
  ClipboardCheck,
  CircleAlert,
  LayoutDashboard,
  Landmark,
  LoaderCircle,
  LogOut,
  Menu,
  Network,
  ScanSearch,
  RefreshCw,
  Search,
  UsersRound,
  WalletCards,
  X,
} from "lucide-react";
import {
  EmployeeModule,
  Hint,
  Legend,
  ManagerModule,
  OwnerModule,
  RegistryNotice,
  type DashboardRole,
  type RoleWorkTarget,
} from "@/components/role-modules";
import { TenderDrawer, type TenderSelection } from "@/components/tender-drawer";
import type { DashboardPayload } from "@/lib/dashboard-data";
import { date, dateTime, integer, money } from "@/lib/dashboard-data";
import type { Direction, InternalTender, MarketCoveragePoint, MarketCoverageSummary } from "@/lib/types";

type View = "overview" | "work" | "tender-workspace" | "projects" | "market" | "competitors";
type Workspace = "tenders" | "finance";
type Period = "day" | "week" | "month" | "all";
type WorkFilter = RoleWorkTarget;
type DirectionScope = "all" | Exclude<Direction, "Інше">;
type WorkSort = "deadline" | "value-desc" | "value-asc" | "status";

const ProjectsView = dynamic(() => import("@/components/projects-view").then((module) => module.ProjectsView));
const AnalyticsV2View = dynamic(() => import("@/components/analytics-v2-view").then((module) => module.AnalyticsV2View));
const MonitoringV2View = dynamic(() => import("@/components/monitoring-v2-view").then((module) => module.MonitoringV2View), {
  loading: () => <Loading />,
});
const TenderWorkspace = dynamic(() => import("@/components/tender-workspace").then((module) => module.TenderWorkspace), {
  loading: () => <Loading />,
});
const FinanceDashboard = dynamic(() => import("@/components/confidential-dashboard").then((module) => module.FinanceDashboard), {
  loading: () => <Loading />,
});

const navigation = [
  { id: "overview" as const, label: "Головна", hint: "Ваш дашборд", icon: LayoutDashboard },
  { id: "work" as const, label: "Тендери команди", hint: "SharePoint", icon: BriefcaseBusiness },
  { id: "tender-workspace" as const, label: "Робоча черга", hint: "Кондиціонування", icon: ClipboardCheck },
  { id: "projects" as const, label: "Проєкти", hint: "Стадії та люди", icon: Network },
  { id: "market" as const, label: "Ринок Prozorro", hint: "Нові можливості", icon: ScanSearch },
  { id: "competitors" as const, label: "Аналітика", hint: "Участі й договори", icon: UsersRound },
];

const financeNavigation = [
  { id: "finance-overview", label: "Огляд", hint: "Оборот і працівники", icon: LayoutDashboard },
] as const;

function isViewAllowed(role: DashboardRole | undefined, view: View, workspaceAccess?: "manager" | "employee" | null) {
  if (view === "tender-workspace") return Boolean(workspaceAccess);
  if (!role) return view === "overview";
  if (role === "employee") return view !== "projects" && view !== "competitors";
  return true;
}

const roleLabels: Record<DashboardRole, string> = {
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

const periods: Array<{ id: Period; label: string; days: number }> = [
  { id: "day", label: "Сьогодні", days: 1 },
  { id: "week", label: "7 днів", days: 7 },
  { id: "month", label: "31 день", days: 31 },
  { id: "all", label: "Увесь зріз", days: Number.MAX_SAFE_INTEGER },
];

const periodDaysOf = (period: Period) => periods.find((item) => item.id === period)?.days ?? 7;
const periodLabelOf = (period: Period) => periods.find((item) => item.id === period)?.label ?? "7 днів";

// Статуси беруться з довідника «База» робочого файлу, а не вгадуються за текстом.
const workQueueCodes = new Set(["analysis", "preparing", "submitted", "qualification", "complaint-terms", "complaint-competitor", "complaint-own-disqualification"]);
const preSubmissionCodes = new Set(["analysis", "preparing"]);
const stageCodes: Record<Exclude<WorkFilter, "active" | "stale" | "idle" | "all">, Set<string>> = {
  analysis: new Set(["analysis"]),
  preparing: new Set(["preparing"]),
  submitted: new Set(["submitted", "qualification"]),
  complaints: new Set(["complaint-terms", "complaint-competitor", "complaint-own-disqualification"]),
};
const inWorkQueue = (tender: InternalTender) => workQueueCodes.has(tender.statusCode);
const isPreSubmission = (tender: InternalTender) => preSubmissionCodes.has(tender.statusCode);
// Після подачі документів дедлайн подачі вже в минулому — і це нормально:
// кваліфікація та розгляд скарг тривають далі. Але якщо статус не рухався
// місяцями, це вже не процедура, а незакритий запис.
const postSubmissionCodes = new Set(["submitted", "qualification", "complaint-terms", "complaint-competitor", "complaint-own-disqualification"]);
const isPostSubmission = (tender: InternalTender) => postSubmissionCodes.has(tender.statusCode);
const STALE_AFTER_DAYS = 45;

/**
 * Пояснення станів. Вони навмисно написані так, щоб різницю між «не знайшли в
 * Excel» і «немає Excel для напрямку» було видно з першого прочитання.
 */
const overviewLegend = [
  { term: "Цільовий ринок", text: "Скільки закупівель Prozorro за обраний період підходять Спецсервісу за ДК-кодом і територією. Для будівництва й сервісу це Київ і область, для кондиціонування — уся Україна." },
  { term: "Покриття командою", text: "Яка частка цільового ринку вже є у вашому Excel: знайдені ÷ (знайдені + не знайдені). Якщо тут 55 %, це означає, що з кожних 100 придатних закупівель команда веде 55, а решта 45 — у списку «Підтверджено не в Excel»." },
  { term: "Підтверджено не в Excel", text: "Ті самі закупівлі, яких у вашому файлі немає. Це не «покриття» у відсотках, а конкретний список тендерів — саме вони і зменшують покриття. Статус ставиться лише для капбудівництва, бо лише для нього є файл для звірки." },
  { term: "Немає внутрішнього джерела", text: "Закупівля підходить профілю, але порівнювати нема з чим: Excel сервісу й кондиціонування ще не підключено. Це не «пропущено» — ми просто не знаємо." },
  { term: "Портфель у роботі", text: "Тендери команди в активних статусах: аналіз, підготовка, документи подано, кваліфікація, скарги від нас." },
  { term: "Конкурентні дані", text: "Частка рядків Excel, де заповнені колонки «Учасник 1–4». Показує повноту файлу, а не кількість конкурентів." },
];

const workLegend = [
  { term: "Дедлайн у минулому — і це нормально", text: "«Документи подано», «Кваліфікація» і «Скарга від нас» настають після закриття подачі. Процедура триває далі: замовник розглядає пропозиції тижнями. Тому такі тендери лишаються в роботі." },
  { term: "Не подано вчасно", text: "Статус досі «Аналіз» або «Готуємо пропозицію», хоча подача вже минула. Це означає, що запис не оновили — участь не відбулася або її не зафіксували." },
  { term: `Без руху > ${STALE_AFTER_DAYS} дн.`, text: "Подано або на кваліфікації, але з дня закриття подачі минуло понад 45 днів. Найімовірніше, результат уже відомий, а статус ніхто не змінив. У файлі немає дати оновлення, тому точніше сказати неможливо." },
  { term: "Увесь файл", text: "Усі 1 273 записи Excel, включно із закритими: відмови, програші, скасовані закупівлі." },
];

const emptyCoverageSummary: MarketCoverageSummary = {
  market: 0,
  seen: 0,
  missed: 0,
  needsReview: 0,
  untracked: 0,
  unavailable: 0,
  outsideScope: 0,
  unknownTerritory: 0,
  marketValue: 0,
  seenValue: 0,
  missedValue: 0,
  needsReviewValue: 0,
  untrackedValue: 0,
  unavailableValue: 0,
  outsideScopeValue: 0,
  unknownTerritoryValue: 0,
};

function coverageForDirection(point: MarketCoveragePoint, direction: DirectionScope): MarketCoverageSummary {
  return direction === "all" ? point : point.byDirection[direction];
}

function daysUntil(deadline: string, today: string) {
  return Math.round((Date.parse(`${deadline}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

/** Скільки днів запис стоїть без руху після того, як подача завершилася. */
function idleDays(tender: InternalTender, today: string) {
  if (!tender.deadline || !isPostSubmission(tender)) return 0;
  return Math.max(0, -daysUntil(tender.deadline, today));
}

function submissionState(tender: InternalTender, today: string) {
  const deadline = tender.deadline;
  if (!deadline) return { label: "Дата подачі не вказана", urgent: false };
  const days = daysUntil(deadline, today);

  if (isPreSubmission(tender)) {
    if (days < 0) return { label: `Статус не оновлено · подача була ${date(deadline)}`, urgent: true };
    if (days === 0) return { label: "Подати сьогодні", urgent: true };
    if (days === 1) return { label: "Подати завтра", urgent: true };
    return { label: `Подати через ${days} дн.`, urgent: false };
  }

  if (isPostSubmission(tender)) {
    const idle = idleDays(tender, today);
    if (idle > STALE_AFTER_DAYS) {
      return { label: `Триває ${idle} дн. після подачі — перевірити статус`, urgent: true };
    }
    if (days < 0) return { label: `Подано · процедура триває ${idle} дн.`, urgent: false };
    return { label: `Подано · подача відкрита ще ${days} дн.`, urgent: false };
  }

  if (days < 0) return { label: `Подача завершена ${date(deadline)}`, urgent: false };
  return { label: `Подача до ${date(deadline)}`, urgent: false };
}

function PeriodSwitch({ value, onChange, caption }: { value: Period; onChange: (value: Period) => void; caption: string }) {
  return (
    <div className="owner-period-block">
      <span className="owner-period-caption">{caption}</span>
      <div className="owner-period">{periods.map((item) => <button type="button" key={item.id} className={value === item.id ? "active" : ""} onClick={() => onChange(item.id)}>{item.label}</button>)}</div>
    </div>
  );
}

function WorkRow({ tender, today, onOpen }: { tender: InternalTender; today: string; onOpen: () => void }) {
  const submission = submissionState(tender, today);
  return (
    <button type="button" className="owner-work-row" onClick={onOpen}>
      <span className="owner-work-copy">
        <span className="owner-work-meta"><span className="owner-work-status">{tender.status}</span><span className={`owner-work-deadline ${submission.urgent ? "urgent" : ""}`}>{submission.label}</span></span>
        <b className="owner-work-title">{tender.title}</b>
        <small>{tender.buyer || "Замовника не вказано"}</small>
      </span>
      <strong>{tender.value ? money(tender.value) : "Сума не вказана"}</strong>
    </button>
  );
}

function Loading({ error, retry }: { error?: string; retry?: () => void }) {
  return <main className="owner-loading">{error ? <CircleAlert size={30} /> : <LoaderCircle className="spin" size={30} />}<h1>{error || "Збираємо дані"}</h1><p>{error ? "Спробуйте ще раз." : "SharePoint і Prozorro"}</p>{retry ? <button type="button" onClick={retry}>Повторити</button> : null}</main>;
}

export function OwnerDashboard() {
  const router = useRouter();
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [view, setView] = useState<View>("overview");
  const [workspace, setWorkspace] = useState<Workspace>("tenders");
  const [financeSection, setFinanceSection] = useState<(typeof financeNavigation)[number]["id"]>("finance-overview");
  const [directionScope, setDirectionScope] = useState<DirectionScope>("all");
  const [period, setPeriod] = useState<Period>("week");
  // Кожна сторінка тримає свій період: вони фільтрують різні речі.
  const [workPeriod, setWorkPeriod] = useState<Period>("all");
  const [workLimit, setWorkLimit] = useState(80);
  const [appliedListKey, setAppliedListKey] = useState("");
  const [workFilter, setWorkFilter] = useState<WorkFilter>("active");
  const [workSort, setWorkSort] = useState<WorkSort>("deadline");
  const [workQuery, setWorkQuery] = useState("");
  const [mobileMenu, setMobileMenu] = useState(false);
  const [selected, setSelected] = useState<TenderSelection | null>(null);
  const [monitoringTotal, setMonitoringTotal] = useState<number | null>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await fetch("/api/dashboard", { cache: "no-store" });
      if (response.status === 401) { router.push("/login"); return; }
      if (!response.ok) throw new Error("Не вдалося завантажити дані");
      const payload = await response.json() as DashboardPayload;
      setData(payload);
      setDirectionScope((current) => payload.viewer.role === "owner" && current === "all"
        ? current
        : payload.viewer.availableDirections.includes(current as Exclude<Direction, "Інше">)
          ? current
          : payload.viewer.direction ?? "all");
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Невідома помилка");
    } finally {
      setRefreshing(false);
    }
  }, [router]);

  useEffect(() => {
    let active = true;
    fetch("/api/dashboard", { cache: "no-store" })
      .then((response) => {
        if (response.status === 401) { router.push("/login"); throw new Error("Unauthorized"); }
        if (!response.ok) throw new Error("Не вдалося завантажити дані");
        return response.json() as Promise<DashboardPayload>;
      })
      .then((payload) => {
        if (!active) return;
        setData(payload);
        setDirectionScope(payload.viewer.direction ?? "all");
      })
      .catch((cause: unknown) => { if (active && cause instanceof Error && cause.message !== "Unauthorized") setError(cause.message); });
    return () => { active = false; };
  }, [router]);

  useEffect(() => {
    const restoreView = () => {
      const candidate = new URL(window.location.href).searchParams.get("view") as View | null;
      const role = data?.viewer.role;
      if (candidate && navigation.some((item) => item.id === candidate) && isViewAllowed(role, candidate, data?.viewer.tenderWorkspaceAccess)) setView(candidate);
      else setView("overview");
    };
    restoreView();
    window.addEventListener("popstate", restoreView);
    return () => window.removeEventListener("popstate", restoreView);
  }, [data?.viewer.role, data?.viewer.tenderWorkspaceAccess]);

  useEffect(() => {
    if (!data) return;
    const restoreWorkspace = () => {
      const requested = new URL(window.location.href).searchParams.get("workspace");
      setWorkspace(requested === "finance" && data.viewer.financeAccess ? "finance" : "tenders");
    };
    restoreWorkspace();
    window.addEventListener("popstate", restoreWorkspace);
    return () => window.removeEventListener("popstate", restoreWorkspace);
  }, [data]);

  if (!data && !error) return <Loading />;
  if (!data) return <Loading error={error} retry={() => void load()} />;

  const { viewer, snapshot, sharePointSync, coverage, control, competitorRadar } = data;
  const role = viewer.role as DashboardRole;
  // Внутрішній Excel підключено лише для одного напрямку. Для решти порожній
  // список означає «немає джерела», а не «немає роботи», і це треба сказати вголос.
  const hasRegistry = directionScope === "all" || snapshot.registry.direction === directionScope;
  const scopeDirection = directionScope === "all" ? snapshot.registry.direction : directionLabels[directionScope];
  const listKey = `${directionScope}|${workFilter}|${workPeriod}|${workQuery}`;
  if (appliedListKey !== listKey) {
    setAppliedListKey(listKey);
    if (workLimit !== 80) setWorkLimit(80);
  }
  const scopedTenders = directionScope === "all"
    ? snapshot.tenders
    : snapshot.tenders.filter((tender) => tender.direction === directionScope);
  const scopedCoveragePoints = coverage.daily.map((point) => ({
    ...point,
    ...coverageForDirection(point, directionScope),
    byDirection: directionScope === "all"
      ? point.byDirection
      : Object.fromEntries(Object.keys(point.byDirection).map((direction) => [direction, direction === directionScope ? point.byDirection[direction as Exclude<Direction, "Інше">] : emptyCoverageSummary])) as MarketCoveragePoint["byDirection"],
  }));
  const scopedCoverageTenders = directionScope === "all"
    ? coverage.tenders
    : coverage.tenders.filter((tender) => tender.direction === directionScope);
  const workflowTenders = scopedTenders
    .filter(inWorkQueue)
    .sort((left, right) => {
      const leftPast = Boolean(left.deadline && left.deadline < control.today);
      const rightPast = Boolean(right.deadline && right.deadline < control.today);
      if (leftPast !== rightPast) return Number(leftPast) - Number(rightPast);
      return leftPast
        ? (right.deadline ?? "").localeCompare(left.deadline ?? "") || right.value - left.value
        : (left.deadline ?? "9999").localeCompare(right.deadline ?? "9999") || right.value - left.value;
    });
  const staleTenders = workflowTenders.filter((tender) => tender.deadline && tender.deadline < control.today && isPreSubmission(tender));
  const staleIds = new Set(staleTenders.map((tender) => tender.id));
  const activeTenders = workflowTenders.filter((tender) => !staleIds.has(tender.id));
  const activeValue = activeTenders.reduce((total, tender) => total + tender.value, 0);
  const stageCounts = {
    analysis: activeTenders.filter((item) => stageCodes.analysis.has(item.statusCode)).length,
    preparing: activeTenders.filter((item) => stageCodes.preparing.has(item.statusCode)).length,
    submitted: activeTenders.filter((item) => stageCodes.submitted.has(item.statusCode)).length,
    complaints: activeTenders.filter((item) => stageCodes.complaints.has(item.statusCode)).length,
  };
  // Подано/кваліфікація/скарга з дедлайном давно позаду: процедура або справді
  // триває, або запис просто не закривали. Показуємо це окремим станом.
  const idleTenders = activeTenders.filter((tender) => idleDays(tender, control.today) > STALE_AFTER_DAYS);
  const unclassifiedFuture = scopedTenders.filter((tender) => tender.statusCode === "none" && tender.deadline && tender.deadline >= control.today);
  const dueToday = activeTenders.filter((tender) => tender.deadline === control.today);
  const due72h = activeTenders.filter((tender) => {
    if (!tender.deadline) return false;
    const days = Math.round((Date.parse(`${tender.deadline}T00:00:00Z`) - Date.parse(`${control.today}T00:00:00Z`)) / 86_400_000);
    return days >= 0 && days <= 3;
  });
  const sumTenderValue = (items: InternalTender[]) => items.reduce((total, tender) => total + tender.value, 0);
  const scopedIds = new Set(scopedTenders.map((tender) => tender.id));
  const participantRecords = scopedTenders.filter((tender) => tender.participants.length > 0).length;
  const participantCoverage = scopedTenders.length ? Math.round((participantRecords / scopedTenders.length) * 1000) / 10 : 0;
  const scopedCompetitorItems = competitorRadar.items.filter((item) => directionScope === "all" || item.directions.includes(directionScope));
  const moduleData: DashboardPayload = {
    ...data,
    snapshot: {
      ...snapshot,
      summary: { ...snapshot.summary, totalCount: scopedTenders.length, totalValue: sumTenderValue(scopedTenders) },
      tenders: scopedTenders,
    },
    coverage: { ...coverage, daily: scopedCoveragePoints, tenders: scopedCoverageTenders },
    control: {
      ...control,
      dueToday: { count: dueToday.length, value: sumTenderValue(dueToday) },
      due72h: { count: due72h.length, value: sumTenderValue(due72h) },
      decisions: control.decisions.filter((decision) => scopedIds.has(decision.id)),
      dataQuality: { ...control.dataQuality, recordsWithParticipants: participantRecords, participantCoverage },
    },
    competitorRadar: { ...competitorRadar, total: scopedCompetitorItems.length, participantCoverage, items: scopedCompetitorItems },
  };
  const periodDays = periodDaysOf(period);
  const rawPeriodPoints = scopedCoveragePoints.slice(-periodDays);
  const firstMarketDate = rawPeriodPoints[0]?.date ?? coverage.endDate;
  const rawPeriodMarket = scopedCoverageTenders.filter((tender) => tender.publishedAt.slice(0, 10) >= firstMarketDate);
  const periodMarket = rawPeriodMarket.filter((tender) => tender.actionable);
  const marketNeedReview = periodMarket.filter((tender) => (tender.territoryStatus === "target" || tender.territoryStatus === "nationwide") && tender.coverageStatus === "missed").sort((left, right) => right.amount - left.amount);
  const workNeedle = workQuery.trim().toLowerCase();
  const allTenders = [...scopedTenders];
  const workSource = workFilter === "all" ? allTenders : workFilter === "stale" ? staleTenders : workFilter === "idle" ? idleTenders : activeTenders;
  // Період на цій сторінці = «наскільки свіжий дедлайн подачі». Майбутні подачі
  // видно завжди, бо ховати їх за періодом було б небезпечно.
  const workHorizon = periodDaysOf(workPeriod);
  const workFrom = workHorizon === Number.MAX_SAFE_INTEGER
    ? "0000-00-00"
    : new Date(Date.parse(`${control.today}T00:00:00Z`) - (workHorizon - 1) * 86_400_000).toISOString().slice(0, 10);
  const filteredWork = workSource
    .filter((tender) => workFilter === "active" || workFilter === "stale" || workFilter === "idle" || workFilter === "all" || stageCodes[workFilter].has(tender.statusCode))
    .filter((tender) => !tender.deadline || tender.deadline >= workFrom)
    .filter((tender) => !workNeedle || `${tender.title} ${tender.buyer} ${tender.status}`.toLowerCase().includes(workNeedle))
    .sort((left, right) => workSort === "value-desc"
      ? right.value - left.value
      : workSort === "value-asc"
        ? left.value - right.value
        : workSort === "status"
          ? left.status.localeCompare(right.status, "uk")
          : (left.deadline ?? "9999").localeCompare(right.deadline ?? "9999") || right.value - left.value);

  const navigate = (target: View) => {
    if (!isViewAllowed(role, target, viewer.tenderWorkspaceAccess)) return;
    setView(target);
    setWorkspace("tenders");
    setMobileMenu(false);
    const url = new URL(window.location.href);
    if (target === "overview") url.searchParams.delete("view");
    else url.searchParams.set("view", target);
    url.searchParams.delete("workspace");
    window.history.pushState({ view: target }, "", `${url.pathname}${url.search}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const navigateWorkspace = (target: Workspace) => {
    if (target === "finance" && !viewer.financeAccess) return;
    setWorkspace(target);
    if (target === "finance") setFinanceSection("finance-overview");
    setMobileMenu(false);
    const url = new URL(window.location.href);
    if (target === "finance") url.searchParams.set("workspace", "finance");
    else url.searchParams.delete("workspace");
    window.history.pushState({ workspace: target }, "", `${url.pathname}${url.search}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const navigateFinance = (target: (typeof financeNavigation)[number]["id"]) => {
    setFinanceSection(target);
    setMobileMenu(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const openWork = (target: RoleWorkTarget) => {
    setWorkFilter(target);
    navigate("work");
  };

  const openInternal = (tender: InternalTender) => setSelected({ kind: "internal", item: tender });
  const availableNavigation = role === "employee"
    ? navigation.filter((item) => item.id !== "projects" && item.id !== "competitors")
    : navigation;
  const roleNavigation = availableNavigation.filter((item) => item.id !== "tender-workspace" || Boolean(viewer.tenderWorkspaceAccess));
  const activeView = isViewAllowed(role, view, viewer.tenderWorkspaceAccess) ? view : "overview";
  const currentPage = workspace === "finance"
    ? { id: "finance", label: "Фінанси", hint: "Оборот і команда", icon: WalletCards }
    : roleNavigation.find((item) => item.id === activeView) ?? roleNavigation[0];

  return (
    <div className="owner-app">
      <aside className={mobileMenu ? "owner-sidebar open" : "owner-sidebar"}>
        <button type="button" className="owner-brand" onClick={() => navigate("overview")} aria-label="Спецсервіс — головна">
          <span className="owner-brand-logo" />
        </button>
        <div className="owner-account">
          <span>{viewer.label.slice(0, 1)}</span>
          <div><b>{viewer.label}</b><small>{roleLabels[role]}</small></div>
        </div>
        <nav aria-label={workspace === "finance" ? "Фінансове меню" : "Головне меню"}>
          {workspace === "finance" ? financeNavigation.map((item) => {
            const Icon = item.icon;
            return <button type="button" key={item.id} className={financeSection === item.id ? "active" : ""} onClick={() => navigateFinance(item.id)}><Icon size={18} /><span><b>{item.label}</b><small>{item.hint}</small></span></button>;
          }) : roleNavigation.map((item) => {
            const Icon = item.icon;
            const count = item.id === "work" ? activeTenders.length : item.id === "market" ? monitoringTotal ?? marketNeedReview.length : null;
            return <button type="button" key={item.id} className={workspace === "tenders" && activeView === item.id ? "active" : ""} onClick={() => navigate(item.id)}><Icon size={18} /><span><b>{item.label}</b><small>{item.hint}</small></span>{count !== null ? <em>{count}</em> : null}</button>;
          })}
        </nav>
        <div className="owner-sidebar-bottom">
          {workspace === "finance"
            ? <div className="owner-side-sync"><i /><span><b>Фінансові дані</b><small>активний набір · без кешу</small></span></div>
            : <div className={`owner-side-sync ${sharePointSync.state}`}><i /><span><b>SharePoint</b><small>{sharePointSync.state === "live" ? "оновлення кожні 15 хв" : `копія ${dateTime(sharePointSync.fileModifiedAt)}`}</small></span></div>}
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
          {viewer.financeAccess ? (
            <nav className="owner-workspace-tabs" aria-label="Розділи кабінету">
              <button type="button" className={workspace === "tenders" ? "active" : ""} onClick={() => navigateWorkspace("tenders")}><Landmark size={16} />Тендери</button>
              <button type="button" className={workspace === "finance" ? "active" : ""} onClick={() => navigateWorkspace("finance")}><WalletCards size={16} />Фінанси</button>
            </nav>
          ) : null}
          <div className="owner-topbar-actions">
            {workspace === "tenders" ? <label className="owner-direction-select">
              <span>Напрямок</span>
              <div><select value={directionScope} onChange={(event) => setDirectionScope(event.target.value as DirectionScope)} disabled={viewer.role !== "owner"}>
                {viewer.role === "owner" ? <option value="all">Уся компанія</option> : null}
                {viewer.availableDirections.map((direction) => <option key={direction} value={direction}>{directionLabels[direction]}</option>)}
              </select><ChevronDown size={15} /></div>
            </label> : null}
            {workspace === "tenders" ? <button type="button" className="owner-icon-button" aria-label="Оновити дані" onClick={() => void load()} disabled={refreshing}><RefreshCw className={refreshing ? "spin" : ""} size={17} /></button> : null}
          </div>
        </header>

        <main className="owner-main">
        {workspace === "finance" ? <FinanceDashboard /> : null}
        {workspace === "tenders" && error ? <div className="owner-error"><CircleAlert size={16} />{error}</div> : null}

        {workspace === "tenders" && activeView === "overview" ? (
          <div className="owner-overview-controls">
            <PeriodSwitch value={period} onChange={setPeriod} caption="Ринкові показники нижче рахуються за:" />
            <Legend title="Що означають ці цифри" items={overviewLegend} />
          </div>
        ) : null}

        {workspace === "tenders" && activeView === "overview" ? (
          role === "owner"
            ? <OwnerModule data={moduleData} activeTenders={activeTenders} staleTenders={staleTenders} unclassifiedFuture={unclassifiedFuture} marketNeedReview={marketNeedReview} activeValue={activeValue} stageCounts={stageCounts} idleTenders={idleTenders} hasRegistry={hasRegistry} scopeDirection={scopeDirection} periodDays={periodDays} periodLabel={periodLabelOf(period)} scopeFilter={directionScope === "all" ? null : directionScope} onWork={openWork} onMarket={() => navigate("market")} onCompetitors={() => navigate("competitors")} onOpenInternal={openInternal} />
            : role === "manager"
              ? <ManagerModule data={moduleData} activeTenders={activeTenders} staleTenders={staleTenders} unclassifiedFuture={unclassifiedFuture} marketNeedReview={marketNeedReview} activeValue={activeValue} stageCounts={stageCounts} idleTenders={idleTenders} hasRegistry={hasRegistry} scopeDirection={scopeDirection} periodDays={periodDays} periodLabel={periodLabelOf(period)} scopeFilter={directionScope === "all" ? null : directionScope} onWork={openWork} onMarket={() => navigate("market")} onCompetitors={() => navigate("competitors")} onOpenInternal={openInternal} />
              : <EmployeeModule data={moduleData} activeTenders={activeTenders} staleTenders={staleTenders} unclassifiedFuture={unclassifiedFuture} marketNeedReview={marketNeedReview} activeValue={activeValue} stageCounts={stageCounts} idleTenders={idleTenders} hasRegistry={hasRegistry} scopeDirection={scopeDirection} periodDays={periodDays} periodLabel={periodLabelOf(period)} scopeFilter={directionScope === "all" ? null : directionScope} onWork={openWork} onMarket={() => navigate("market")} onCompetitors={() => navigate("competitors")} onOpenInternal={openInternal} />
        ) : null}

        {workspace === "tenders" && activeView === "work" ? (
          <div className="owner-stack">
            <section className="owner-page-head"><div><span>SHAREPOINT · ЗАКУПІВЛІ.XLSX</span><h1>{integer(activeTenders.length)} актуальних статусів</h1><p>{integer(scopedTenders.length)} записів на {money(sumTenderValue(scopedTenders))} · {directionLabels[directionScope]} · оновлено {dateTime(sharePointSync.fileModifiedAt)}</p></div><div className={`owner-head-sync ${sharePointSync.state}`}><i /><span><b>{sharePointSync.state === "live" ? "Автооновлення 15 хв" : "Read-only копія"}</b><small>{sharePointSync.message}</small></span></div></section>
            {hasRegistry ? null : <RegistryNotice direction={scopeDirection} onMarket={() => navigate("market")} />}
            <div className="owner-overview-controls">
              <PeriodSwitch value={workPeriod} onChange={setWorkPeriod} caption="Показувати записи, у яких дедлайн подачі не старіший за:" />
              <Legend title="Чому тендер із дедлайном у минулому досі «у роботі»" items={workLegend} />
            </div>
            <section className="owner-filters">
              <div className="owner-filter-tabs">
                <button type="button" className={workFilter === "active" ? "active" : ""} onClick={() => setWorkFilter("active")}>У роботі <b>{activeTenders.length}</b></button>
                <button type="button" className={workFilter === "analysis" ? "active" : ""} onClick={() => setWorkFilter("analysis")}>Аналіз <b>{stageCounts.analysis}</b></button>
                <button type="button" className={workFilter === "preparing" ? "active" : ""} onClick={() => setWorkFilter("preparing")}>Готують <b>{stageCounts.preparing}</b></button>
                <button type="button" className={workFilter === "submitted" ? "active" : ""} onClick={() => setWorkFilter("submitted")}>Подано <b>{stageCounts.submitted}</b></button>
                <button type="button" className={workFilter === "complaints" ? "active" : ""} onClick={() => setWorkFilter("complaints")}>Скарги <b>{stageCounts.complaints}</b></button>
                <button type="button" className={workFilter === "stale" ? "active" : ""} onClick={() => setWorkFilter("stale")}>Не подано вчасно <b>{staleTenders.length}</b></button>
                <button type="button" className={workFilter === "idle" ? "active" : ""} onClick={() => setWorkFilter("idle")}>Без руху &gt; {STALE_AFTER_DAYS} дн. <b>{idleTenders.length}</b></button>
                <button type="button" className={workFilter === "all" ? "active" : ""} onClick={() => setWorkFilter("all")}>Увесь файл <b>{scopedTenders.length}</b></button>
              </div>
              <div className="owner-filter-actions">
                <label className="owner-search"><Search size={17} /><input aria-label="Пошук тендерів команди" value={workQuery} onChange={(event) => setWorkQuery(event.target.value)} placeholder="Назва, замовник або статус" />{workQuery ? <button type="button" aria-label="Очистити" onClick={() => setWorkQuery("")}><X size={15} /></button> : null}</label>
                <label className="owner-sort"><span>Сортування</span><select value={workSort} onChange={(event) => setWorkSort(event.target.value as WorkSort)}><option value="deadline">Найближчий дедлайн</option><option value="value-desc">Найбільша сума</option><option value="value-asc">Найменша сума</option><option value="status">За статусом</option></select><ChevronDown size={14} /></label>
              </div>
            </section>
            <section className="owner-work-list owner-work-page">
              {filteredWork.slice(0, workLimit).map((tender) => <WorkRow key={tender.id} tender={tender} today={control.today} onOpen={() => openInternal(tender)} />)}
              {!filteredWork.length ? <div className="owner-empty"><b>Нічого не знайдено</b><span>Змініть фільтр, період або пошук.</span></div> : null}
            </section>
            {filteredWork.length ? (
              <div className="owner-load-more">
                <span>Показано {integer(Math.min(workLimit, filteredWork.length))} із {integer(filteredWork.length)} за цим фільтром.</span>
                {filteredWork.length > workLimit ? <button type="button" onClick={() => setWorkLimit((value) => value + 120)}>Показати ще {Math.min(120, filteredWork.length - workLimit)}</button> : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {workspace === "tenders" && activeView === "tender-workspace" && viewer.tenderWorkspaceAccess ? (
          <TenderWorkspace viewerId={viewer.id} />
        ) : null}

        {workspace === "tenders" && activeView === "projects" ? (
          <div className="owner-stack">
            <ProjectsView />
          </div>
        ) : null}

        {workspace === "tenders" && activeView === "market" ? (
          <div className="owner-stack">
            <MonitoringV2View initialDirection={directionScope === "all" ? null : directionScope} canManage={role !== "employee"} canConfigureIntegrations={role === "owner"} onTotalChange={setMonitoringTotal} />
          </div>
        ) : null}

        {workspace === "tenders" && activeView === "competitors" ? (
          <AnalyticsV2View key={directionScope} initialDirection={directionScope === "all" ? null : directionScope} />
        ) : null}
        </main>
      </div>
      <TenderDrawer selected={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
