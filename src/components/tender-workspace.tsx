"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowDownUp, Check, ChevronDown, CircleAlert, Clock3, ExternalLink, FileSpreadsheet, LoaderCircle, MapPin, RefreshCw, Search, UserRoundCheck, UsersRound, X } from "lucide-react";
import styles from "./tender-workspace.module.css";
import { validDecisionReason } from "@/lib/tender-workspace";
import type { TenderParticipationDecision, TenderWorkflowStatus, TenderWorkPriority, TenderWorkspaceItem, TenderWorkspacePatch, TenderWorkspacePayload } from "@/lib/tender-workspace";

type Scope = "focus" | "mine" | "unassigned" | "participate" | "all";
type Sort = "deadline" | "newest" | "value";

const decisionLabels: Record<TenderParticipationDecision, string> = { undecided: "Ще не вирішили", participate: "Беремо участь", skip: "Не беремо участь", partner: "Передаємо партнеру" };
const statusLabels: Record<TenderWorkflowStatus, string> = { new: "Новий", review: "Аналізуємо", preparing: "Готуємо пропозицію", submitted: "Пропозицію подано", qualification: "Кваліфікація", won: "Перемога", lost: "Не перемогли", contract: "Договір", closed: "Закрито" };
const priorityLabels: Record<TenderWorkPriority, string> = { low: "Низький", normal: "Звичайний", high: "Високий", critical: "Критичний" };
const terminalStatuses = new Set<TenderWorkflowStatus>(["lost", "contract", "closed"]);

const money = (value: number | null, currency: string | null) => value == null ? "Не вказано" : `${new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 2 }).format(value)} ${currency === "UAH" ? "грн" : currency || ""}`.trim();
const dateTime = (value: string | null) => value && !Number.isNaN(Date.parse(value)) ? new Intl.DateTimeFormat("uk-UA", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "Не вказано";
const dateOnly = (value: string | null) => value && !Number.isNaN(Date.parse(value)) ? new Intl.DateTimeFormat("uk-UA", { day: "2-digit", month: "long", year: "numeric" }).format(new Date(value)) : "Не вказано";

function localDateTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function deadlineState(item: TenderWorkspaceItem, clock: number) {
  if (!item.submissionDeadline) return { label: "Дедлайн не вказано", tone: "muted" };
  const delta = Date.parse(item.submissionDeadline) - clock;
  const hours = Math.ceil(delta / 3_600_000);
  if (hours < 0) return { label: `Подачу завершено ${dateTime(item.submissionDeadline)}`, tone: "past" };
  if (hours <= 3) return { label: hours <= 0 ? "Менше години" : `${hours} год. до завершення`, tone: "critical" };
  if (hours <= 24) return { label: `${hours} год. до завершення`, tone: "urgent" };
  if (hours <= 72) return { label: `${Math.ceil(hours / 24)} дн. до завершення`, tone: "watch" };
  return { label: `Подати до ${dateTime(item.submissionDeadline)}`, tone: "open" };
}

function paymentSummary(terms: Array<Record<string, unknown>>) {
  if (!terms.length) return "Не вказано";
  return terms.map((term) => {
    const duration = term.duration && typeof term.duration === "object" ? `${String((term.duration as Record<string, unknown>).days ?? "")} дн.` : null;
    return [term.title, term.paymentMethod, duration].filter(Boolean).join(" · ");
  }).filter(Boolean).join("; ") || "Вказано без текстового опису";
}

type Draft = { participationDecision: TenderParticipationDecision; workflowStatus: TenderWorkflowStatus; priority: TenderWorkPriority; assignedAccountId: string; decisionReason: string; actionNote: string; managerNote: string; nextActionAt: string };
function draftOf(item: TenderWorkspaceItem): Draft {
  return { participationDecision: item.participationDecision, workflowStatus: item.workflowStatus, priority: item.priority, assignedAccountId: item.assignedAccountId ?? "", decisionReason: item.decisionReason ?? "", actionNote: item.actionNote ?? "", managerNote: item.managerNote ?? "", nextActionAt: localDateTime(item.nextActionAt) };
}

function SelectField({ label, value, onChange, children, disabled }: { label: string; value: string; onChange: (value: string) => void; children: React.ReactNode; disabled?: boolean }) {
  return <label className={styles.field}><span>{label}</span><div><select value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled}>{children}</select><ChevronDown size={15} /></div></label>;
}

export function TenderWorkspace({ viewerId }: { viewerId: string }) {
  const [payload, setPayload] = useState<TenderWorkspacePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const [scope, setScope] = useState<Scope>("focus");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("deadline");
  const [statusFilter, setStatusFilter] = useState("all");
  const [regionFilter, setRegionFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const response = await fetch("/api/tender-workspace", { cache: "no-store" });
      if (!response.ok) throw new Error(response.status === 403 ? "Цей модуль недоступний для акаунта" : "Не вдалося завантажити робочу чергу");
      setPayload(await response.json() as TenderWorkspacePayload);
      setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Помилка завантаження"); }
    finally { if (!quiet) setLoading(false); }
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/tender-workspace", { cache: "no-store" })
      .then((response) => { if (!response.ok) throw new Error(response.status === 403 ? "Цей модуль недоступний для акаунта" : "Не вдалося завантажити робочу чергу"); return response.json() as Promise<TenderWorkspacePayload>; })
      .then((next) => { if (active) { setPayload(next); setError(""); } })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : "Помилка завантаження"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let minute = 0;
    const timer = window.setInterval(() => { setClock(Date.now()); minute += 1; if (minute % 5 === 0 && document.visibilityState === "visible") void load(true); }, 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const items = payload?.items ?? [];
  const manager = payload?.access === "manager";
  const selected = items.find((item) => item.id === selectedId) ?? null;
  const decisionReasonMissing = Boolean(draft && !validDecisionReason(draft.participationDecision, draft.decisionReason));
  const memberNames = useMemo(() => new Map((payload?.members ?? []).map((member) => [member.id, member.label])), [payload?.members]);
  const regions = useMemo(() => [...new Set(items.map((item) => item.region).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b, "uk")), [items]);

  useEffect(() => {
    if (!selectedId) return;
    const root = document.documentElement;
    const previousOverflow = root.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedId(null);
        setDraft(null);
      }
    };
    root.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      root.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [selectedId]);
  const counters = useMemo(() => {
    const active = items.filter((item) => !terminalStatuses.has(item.workflowStatus));
    return { active: active.length, mine: active.filter((item) => item.assignedAccountId === viewerId).length, unassigned: active.filter((item) => !item.assignedAccountId).length, urgent: active.filter((item) => item.submissionDeadline && Date.parse(item.submissionDeadline) >= clock && Date.parse(item.submissionDeadline) - clock <= 24 * 3_600_000).length, participate: active.filter((item) => item.participationDecision === "participate").length };
  }, [clock, items, viewerId]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("uk-UA");
    return items.filter((item) => {
      const active = !terminalStatuses.has(item.workflowStatus);
      const inScope = scope === "all" || (scope === "mine" && item.assignedAccountId === viewerId) || (scope === "unassigned" && !item.assignedAccountId && active) || (scope === "participate" && item.participationDecision === "participate") || (scope === "focus" && active && (manager ? (!item.assignedAccountId || item.participationDecision === "undecided") : (item.assignedAccountId === viewerId || !item.assignedAccountId)));
      return inScope && (statusFilter === "all" || item.workflowStatus === statusFilter) && (regionFilter === "all" || item.region === regionFilter) && (!needle || `${item.tenderId} ${item.title} ${item.buyerName} ${item.buyerEdrpou ?? ""} ${item.cpvCodes.join(" ")}`.toLocaleLowerCase("uk-UA").includes(needle));
    }).toSorted((left, right) => sort === "value" ? (right.expectedAmount ?? -1) - (left.expectedAmount ?? -1) : sort === "newest" ? (right.publishedAt ?? "").localeCompare(left.publishedAt ?? "") : (left.submissionDeadline ?? "9999").localeCompare(right.submissionDeadline ?? "9999"));
  }, [items, manager, query, regionFilter, scope, sort, statusFilter, viewerId]);

  const patchItem = async (item: TenderWorkspaceItem, patch: Partial<TenderWorkspacePatch>, success?: () => void) => {
    setSavingId(item.id); setError("");
    try {
      const response = await fetch("/api/tender-workspace", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: item.id, version: item.version, ...patch }) });
      if (response.status === 409) throw new Error("Картку вже змінив інший користувач. Дані оновлено — повторіть дію.");
      if (!response.ok) throw new Error(response.status === 403 ? "Ця дія недоступна для вашої ролі" : "Не вдалося зберегти зміни");
      success?.(); await load(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Помилка збереження"); await load(true); }
    finally { setSavingId(null); }
  };

  const saveDraft = async () => {
    if (!selected || !draft) return;
    if (!manager && selected.assignedAccountId !== viewerId) { setError("Спочатку натисніть «Взяти тендер собі»."); return; }
    if (!validDecisionReason(draft.participationDecision, draft.decisionReason)) { setError("Для рішення «Не беремо участь» вкажіть коротку причину."); return; }
    const patch: Partial<TenderWorkspacePatch> = { participationDecision: draft.participationDecision, workflowStatus: draft.workflowStatus, decisionReason: draft.decisionReason || null, actionNote: draft.actionNote || null, nextActionAt: draft.nextActionAt ? new Date(draft.nextActionAt).toISOString() : null };
    if (manager) { patch.priority = draft.priority; patch.assignedAccountId = draft.assignedAccountId || null; patch.managerNote = draft.managerNote || null; }
    await patchItem(selected, patch, closeCard);
  };

  const synchronize = async () => {
    setSyncing(true);
    try { const response = await fetch("/api/tender-workspace", { method: "POST" }); if (!response.ok) throw new Error("Не вдалося оновити дані Prozorro"); await load(true); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Помилка синхронізації"); }
    finally { setSyncing(false); }
  };

  if (loading && !payload) return <div className={styles.state}><LoaderCircle className={styles.spin} /><b>Завантажуємо актуальні тендери</b><span>У черзі будуть лише відкриті або вже взяті в роботу.</span></div>;
  if (!payload) return <div className={styles.state}><CircleAlert /><b>{error || "Модуль недоступний"}</b><button type="button" onClick={() => void load()}>Повторити</button></div>;
  const openCard = (item: TenderWorkspaceItem) => { setSelectedId(item.id); setDraft(draftOf(item)); setError(""); };
  function closeCard() { setSelectedId(null); setDraft(null); setError(""); }

  return <div className={styles.app}>
    <section className={styles.header}><div><span>КОНДИЦІОНУВАННЯ · РОБОЧА ЧЕРГА</span><h1>{manager ? "Розподіл і контроль тендерів" : "Мої тендери та нові можливості"}</h1><p>{manager ? "Призначте відповідального, зафіксуйте рішення і контролюйте наступну дію." : "Візьміть вільний тендер собі, зафіксуйте рішення та наступний крок."}</p></div><div className={styles.sync}><i /><span><b>Дані актуальні</b><small>{payload.lastSyncAt ? `Оновлено ${dateTime(payload.lastSyncAt)}` : "Синхронізація готується"}</small></span>{manager ? <button type="button" onClick={() => void synchronize()} disabled={syncing} aria-label="Оновити дані"><RefreshCw className={syncing ? styles.spin : ""} size={17} /></button> : null}</div></section>
    {error ? <div className={styles.error}><CircleAlert size={16} /><span>{error}</span><button type="button" onClick={() => setError("")} aria-label="Закрити повідомлення"><X size={15} /></button></div> : null}

    <section className={styles.summary}>
      <button type="button" onClick={() => setScope(manager ? "unassigned" : "focus")}><span>{manager ? "Без відповідального" : "Доступні мені"}</span><strong>{manager ? counters.unassigned : counters.mine + counters.unassigned}</strong><small>{manager ? "потрібно розподілити" : "мої та ще не призначені"}</small></button>
      <button type="button" onClick={() => { setScope("focus"); setSort("deadline"); }}><span>Дедлайн сьогодні</span><strong>{counters.urgent}</strong><small>менше 24 годин</small></button>
      <button type="button" onClick={() => setScope("participate")}><span>Беремо участь</span><strong>{counters.participate}</strong><small>активна підготовка</small></button>
      <div><span>У роботі команди</span><strong>{counters.active}</strong><small>без історичного сміття</small></div>
    </section>

    <section className={styles.controls}><div className={styles.tabs}><button type="button" className={scope === "focus" ? styles.active : ""} onClick={() => setScope("focus")}>{manager ? "Потрібна дія" : "Мій фокус"}</button><button type="button" className={scope === "mine" ? styles.active : ""} onClick={() => setScope("mine")}>Мої <b>{counters.mine}</b></button>{manager ? <button type="button" className={scope === "unassigned" ? styles.active : ""} onClick={() => setScope("unassigned")}>Не призначені <b>{counters.unassigned}</b></button> : null}<button type="button" className={scope === "participate" ? styles.active : ""} onClick={() => setScope("participate")}>Беремо участь</button><button type="button" className={scope === "all" ? styles.active : ""} onClick={() => setScope("all")}>Усі актуальні</button></div><div className={styles.tools}><label className={styles.search}><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Тендер, замовник або ДК" aria-label="Пошук" />{query ? <button type="button" onClick={() => setQuery("")} aria-label="Очистити"><X size={14} /></button> : null}</label><label className={styles.sort}><ArrowDownUp size={15} /><select value={sort} onChange={(event) => setSort(event.target.value as Sort)} aria-label="Сортування"><option value="deadline">За дедлайном</option><option value="newest">Спочатку нові</option><option value="value">За сумою</option></select><ChevronDown size={14} /></label></div><details className={styles.filters}><summary>Додаткові фільтри <ChevronDown size={14} /></summary><div><SelectField label="Етап" value={statusFilter} onChange={setStatusFilter}><option value="all">Усі етапи</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</SelectField><SelectField label="Регіон" value={regionFilter} onChange={setRegionFilter}><option value="all">Уся Україна</option>{regions.map((region) => <option key={region} value={region}>{region}</option>)}</SelectField>{statusFilter !== "all" || regionFilter !== "all" ? <button type="button" onClick={() => { setStatusFilter("all"); setRegionFilter("all"); }}>Скинути</button> : null}</div></details></section>

    <section className={styles.queue}><header><div><span>АКТУАЛЬНА РОБОТА</span><h2>{filtered.length} {filtered.length === 1 ? "тендер" : "тендерів"}</h2></div><p>Прострочені без роботи приховано автоматично</p></header><details className={styles.criteria}><summary>Що саме потрапляє в цю чергу <ChevronDown size={14} /></summary><p><b>Нові:</b> лише закупівлі кондиціонування/вентиляції, де подання ще відкрите. <b>У роботі:</b> записи з Excel або Prozorro, якщо вже є рішення, відповідальний, нотатка чи активний етап. Завершені без жодної роботи автоматично приховуються.</p></details><div className={styles.tableHead}><span>Тендер</span><span>Рішення</span><span>Дедлайн</span><span>Відповідальний</span><span>Сума</span></div><div className={styles.rows}>{filtered.map((item) => {
      const deadline = deadlineState(item, clock); const assigneeName = item.assignedAccountId ? memberNames.get(item.assignedAccountId) : null;
      return <article key={item.id} className={`${styles.row} ${styles[item.priority]}`}><button type="button" className={styles.rowMain} onClick={() => openCard(item)} aria-label={`Відкрити ${item.tenderId}`}><div className={styles.tenderCell}><span>{item.workbookTracked ? <><FileSpreadsheet size={12} />З Excel</> : <>Новий з Prozorro</>} · {item.tenderId}</span><b>{item.title}</b><small>{item.buyerName}</small><em><MapPin size={12} />{[item.region, item.locality].filter(Boolean).join(", ") || "Місце не вказано"}</em></div><div className={styles.decisionCell}><b className={styles[item.participationDecision]}>{decisionLabels[item.participationDecision]}</b><small>{statusLabels[item.workflowStatus]}</small>{item.decisionReason ? <em>{item.decisionReason}</em> : null}</div><div className={`${styles.deadlineCell} ${styles[deadline.tone]}`}><Clock3 size={15} /><b>{deadline.label}</b><small>{item.nextActionAt ? `Наступна дія: ${dateTime(item.nextActionAt)}` : "Наступну дію не задано"}</small></div></button><div className={styles.assignmentCell}>{manager ? <label><select value={item.assignedAccountId ?? ""} onChange={(event) => void patchItem(item, { assignedAccountId: event.target.value || null })} disabled={savingId === item.id}><option value="">Не призначено</option>{payload.members.map((member) => <option key={member.id} value={member.id}>{member.label}</option>)}</select><ChevronDown size={14} /></label> : item.assignedAccountId === viewerId ? <span className={styles.owned}><UserRoundCheck size={15} />Ви відповідальний</span> : !item.assignedAccountId ? <button type="button" className={styles.claimInline} onClick={() => void patchItem(item, { assignedAccountId: viewerId, workflowStatus: "review" })} disabled={savingId === item.id}>{savingId === item.id ? <LoaderCircle className={styles.spin} size={15} /> : <UserRoundCheck size={15} />}Взяти собі</button> : <span>{assigneeName || "Призначено іншому"}</span>}<small>{priorityLabels[item.priority]} пріоритет</small></div><button type="button" className={styles.amountCell} onClick={() => openCard(item)}><b>{money(item.expectedAmount, item.currency)}</b><small>{item.quantity ? `${item.quantity} ${item.unitCode || "од."}` : item.cpvCodes[0] || "ДК не вказано"}</small></button></article>;
    })}{!filtered.length ? <div className={styles.empty}><Check size={26} /><b>У цьому зрізі все опрацьовано</b><span>Спробуйте іншу вкладку або очистьте пошук.</span></div> : null}</div></section>

    {selected && draft ? createPortal(<div className={styles.backdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeCard(); }}><aside className={styles.drawer} role="dialog" aria-modal="true" aria-label={`Картка ${selected.tenderId}`}><header><div><span>{selected.workbookTracked ? "З EXCEL · " : "З PROZORRO · "}{selected.tenderId}</span><h2>{selected.title}</h2><p>{selected.buyerName} · {selected.buyerEdrpou || "ЄДРПОУ не вказано"}</p></div><button type="button" onClick={closeCard} aria-label="Закрити"><X size={20} /></button></header><div className={styles.drawerBody}>
      {error ? <div className={styles.drawerError}><CircleAlert size={15} /><span>{error}</span></div> : null}
      <section className={styles.step}><header><b>1</b><div><h3>Хто працює з тендером?</h3><p>{manager ? "Призначте відповідального працівника." : "Вільний тендер можна взяти лише на себе."}</p></div></header>{manager ? <SelectField label="Відповідальний" value={draft.assignedAccountId} onChange={(value) => setDraft({ ...draft, assignedAccountId: value })}><option value="">Не призначено</option>{payload.members.map((member) => <option key={member.id} value={member.id}>{member.label}</option>)}</SelectField> : selected.assignedAccountId === viewerId ? <div className={styles.assignedBanner}><UserRoundCheck size={17} />Цей тендер закріплений за вами</div> : !selected.assignedAccountId ? <button type="button" className={styles.claim} onClick={() => { setDraft({ ...draft, assignedAccountId: viewerId, workflowStatus: "review" }); void patchItem(selected, { assignedAccountId: viewerId, workflowStatus: "review" }); }}><UserRoundCheck size={17} />Взяти тендер собі</button> : <div className={styles.assignedBanner}><UsersRound size={17} />Відповідальний: {memberNames.get(selected.assignedAccountId) || "інший працівник"}</div>}</section>
      <section className={styles.step}><header><b>2</b><div><h3>Чи беремо участь?</h3><p>Оберіть рішення. Для відмови причина обов’язкова.</p></div></header><div className={styles.decisionButtons}>{Object.entries(decisionLabels).map(([value, label]) => <button type="button" key={value} className={draft.participationDecision === value ? styles.activeDecision : ""} onClick={() => { const nextDecision = value as TenderParticipationDecision; setError(""); setDraft({ ...draft, participationDecision: nextDecision, workflowStatus: nextDecision === "skip" ? "closed" : nextDecision === "participate" && ["new", "review"].includes(draft.workflowStatus) ? "preparing" : draft.workflowStatus }); }}>{label}</button>)}</div><label className={`${styles.textField} ${decisionReasonMissing ? styles.invalidField : ""}`}><span>{draft.participationDecision === "skip" ? "Причина відмови *" : "Обґрунтування рішення"}</span><textarea value={draft.decisionReason} onChange={(event) => { setError(""); setDraft({ ...draft, decisionReason: event.target.value }); }} placeholder="ТЗ, ціна, наявність, регіон, строки або інша конкретна причина" />{decisionReasonMissing ? <small className={styles.validation}>Вкажіть причину — без неї рішення не збережеться.</small> : null}</label></section>
      <section className={styles.step}><header><b>3</b><div><h3>Що робимо далі?</h3><p>Зафіксуйте етап, наступну дію та строк.</p></div></header><div className={styles.formGrid}><SelectField label="Етап роботи" value={draft.workflowStatus} onChange={(value) => setDraft({ ...draft, workflowStatus: value as TenderWorkflowStatus })}>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</SelectField><label className={styles.field}><span>Наступна дія до</span><div><input type="datetime-local" value={draft.nextActionAt} onChange={(event) => setDraft({ ...draft, nextActionAt: event.target.value })} /></div></label>{manager ? <SelectField label="Пріоритет" value={draft.priority} onChange={(value) => setDraft({ ...draft, priority: value as TenderWorkPriority })}>{Object.entries(priorityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</SelectField> : null}</div><label className={styles.textField}><span>Наступний крок / робоча нотатка</span><textarea value={draft.actionNote} onChange={(event) => setDraft({ ...draft, actionNote: event.target.value })} placeholder="Наприклад: запросити ціну у постачальника, перевірити ТЗ, підготувати гарантію" /></label>{manager ? <label className={styles.textField}><span>Коментар керівника</span><textarea value={draft.managerNote} onChange={(event) => setDraft({ ...draft, managerNote: event.target.value })} placeholder="Вказівка або контрольна точка для працівника" /></label> : selected.managerNote ? <div className={styles.managerNote}><b>Коментар керівника</b><p>{selected.managerNote}</p></div> : null}</section>
      <section className={styles.keyFacts}><header><div><span>КЛЮЧОВІ ДАНІ</span><h3>Що потрібно для рішення</h3></div><a href={selected.prozorroUrl} target="_blank" rel="noreferrer">Відкрити Prozorro <ExternalLink size={14} /></a></header><div><article><small>Подати до</small><b>{dateTime(selected.submissionDeadline)}</b></article><article><small>Очікувана вартість</small><b>{money(selected.expectedAmount, selected.currency)}</b></article><article><small>Гарантія</small><b>{money(selected.guaranteeAmount, selected.currency)}</b></article><article><small>Поставка до</small><b>{dateOnly(selected.deliveryDeadline)}</b></article><article><small>Обсяг</small><b>{selected.quantity ? `${selected.quantity} ${selected.unitCode || "од."}` : "Не вказано"}</b></article><article><small>Процедура</small><b>{selected.procedureType || "Не вказано"}</b></article></div><p><MapPin size={14} />{selected.deliveryAddress || [selected.region, selected.locality].filter(Boolean).join(", ") || "Місце поставки не вказано"}</p></section>
      <details className={styles.allFields}><summary><span><FileSpreadsheet size={16} /><b>Усі 34 поля з Excel</b><small>Повний реєстр без перевантаження основної картки</small></span><ChevronDown size={17} /></summary><div>{[
        ["1. Номер тендеру на SmartTender", selected.workbookFields.smartTenderId || "Не надається Prozorro"], ["2. Номер тендеру в Prozorro", selected.tenderId], ["3. Організатор", selected.workbookFields.organizer || selected.buyerName], ["4. Головна організація", selected.workbookFields.parentOrganization || "Не вказано"], ["5. Код ЄДРПОУ", selected.buyerEdrpou || selected.workbookFields.buyerEdrpou || "Не вказано"], ["6. Область", selected.region || selected.workbookFields.region || "Не вказано"], ["7. Місто", selected.locality || selected.workbookFields.city || "Не вказано"], ["8. Предмет торгів", selected.title], ["9. Вид торгів", selected.procedureType || selected.workbookFields.procedure || "Не вказано"], ["10. Класифікація", selected.cpvCodes.join(", ") || selected.workbookFields.classification || "Не вказано"], ["11. Опис тендеру", selected.description || selected.workbookFields.description || "Не вказано"], ["12. Місце поставки", selected.deliveryAddress || selected.workbookFields.deliveryPlace || "Не вказано"], ["13. Строк поставки до", dateOnly(selected.deliveryDeadline)], ["14. Очікувана вартість", money(selected.expectedAmount, selected.currency)], ["15. Сума електронної гарантії", money(selected.guaranteeAmount, selected.currency)], ["16. Прийом пропозицій до", dateTime(selected.submissionDeadline)], ["17. Дата аукціону", dateTime(selected.auctionAt)], ["18. Дія з тендером", selected.actionNote || selected.decisionReason || selected.workbookFields.tenderAction || "Не вказано"], ["19. Одиниця виміру", selected.unitCode || selected.workbookFields.unit || "Не вказано"], ["20. Об’єм закупівлі", selected.quantity?.toString() || selected.workbookFields.quantity || "Не вказано"], ["21. Початкова ціна", money(selected.unitPrice, selected.currency)], ["22. Період оплати", paymentSummary(selected.paymentTerms) !== "Не вказано" ? paymentSummary(selected.paymentTerms) : selected.workbookFields.paymentPeriod || "Не вказано"], ["23. Повторно опублікована закупівля", selected.workbookFields.republished || "Немає структурованих даних"], ["24. Попередня закупівля", selected.workbookFields.previousProcurement || "Не вказано"], ["25. Чи приймаємо участь?", decisionLabels[selected.participationDecision]], ["26. Інформування про термінову подачу", deadlineState(selected, clock).label], ["27. Інформація про зміни", selected.workbookFields.changes || "Немає структурованих даних"], ["28. Запитання, вимоги, скарги", selected.workbookFields.questionsComplaints || "Немає структурованих даних"], ["29. Статус закупівлі", selected.sourceStatus || selected.workbookFields.monitoringStatus || "Не вказано"], ["30. Найнижча пропозиція", selected.lowestBidder ? `${selected.lowestBidder} · ${money(selected.lowestBidAmount, selected.currency)}` : selected.workbookFields.lowestBid || "Ще немає"], ["31. День кваліфікації", dateOnly(selected.awardDate)], ["32. Переможець", selected.winnerName ? `${selected.winnerName} · ${dateOnly(selected.awardDate)}` : selected.workbookFields.winner || "Ще не визначено"], ["33. Договір", selected.contractStatus ? `${selected.contractStatus} · ${money(selected.contractAmount, selected.currency)}` : selected.workbookFields.contract || "Ще не опубліковано"], ["34. Менеджер", selected.assignedAccountId ? memberNames.get(selected.assignedAccountId) || selected.assignedAccountId : selected.workbookFields.manager || "Не призначено"],
      ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</div></details>
    </div><footer><span>Версія {selected.version} · оновлено {dateTime(selected.updatedAt)}</span><button type="button" onClick={() => void saveDraft()} disabled={savingId === selected.id || decisionReasonMissing || (!manager && selected.assignedAccountId !== viewerId)}>{savingId === selected.id ? <LoaderCircle className={styles.spin} size={16} /> : <Check size={16} />}{!manager && selected.assignedAccountId !== viewerId ? "Спочатку візьміть собі" : decisionReasonMissing ? "Вкажіть причину" : "Зберегти"}</button></footer></aside></div>, document.body) : null}
  </div>;
}
