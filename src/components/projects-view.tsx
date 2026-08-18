"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ExternalLink, LoaderCircle, Search, X } from "lucide-react";
import { integer, money } from "@/lib/dashboard-data";
import type { ProjectsSnapshot, SharePointSync } from "@/lib/types";

type Payload = { projects: ProjectsSnapshot; projectsSync: SharePointSync };
type Tab = "pipeline" | "delivery";
type Sort = "budget-desc" | "budget-asc" | "stage" | "owner";

const sortLabels: Record<Sort, string> = {
  "budget-desc": "Бюджет: від більшого",
  "budget-asc": "Бюджет: від меншого",
  stage: "За стадією",
  owner: "За відповідальним",
};

const phaseTone: Record<string, string> = {
  preparation: "prep",
  tender: "tender",
  delivery: "delivery",
  archive: "archive",
  mixed: "mixed",
};

/** Бюджет може бути не вказаний — це окремий стан, а не нуль. */
const budgetLabel = (value: number | null) => (value == null ? "Бюджет не вказано" : money(value));

export function ProjectsView() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("pipeline");
  const [phase, setPhase] = useState<string>("active");
  const [owner, setOwner] = useState<string>("all");
  const [sort, setSort] = useState<Sort>("budget-desc");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(40);
  const [appliedKey, setAppliedKey] = useState("");
  const [snapshotIsStale, setSnapshotIsStale] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/projects", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("Не вдалося завантажити реєстри проєктів");
        return response.json() as Promise<Payload>;
      })
      .then((payload) => {
        if (!active) return;
        setData(payload);
        setSnapshotIsStale(
          payload.projectsSync.state !== "live"
          && Date.now() - Date.parse(payload.projects.exportedAt) > 24 * 60 * 60 * 1000,
        );
      })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : "Невідома помилка"); });
    return () => { active = false; };
  }, []);

  if (error) return <section className="owner-section"><div className="owner-empty"><b>{error}</b><span>Оновіть сторінку.</span></div></section>;
  if (!data) return <section className="owner-section"><div className="owner-empty"><LoaderCircle className="spin" size={26} /><span>Читаємо реєстри проєктів</span></div></section>;

  const { projects, projectsSync } = data;
  const s = projects.summary;

  // Скидаємо порцію списку, щойно змінюється сам список — інакше після зміни
  // фільтра користувач бачить хвіст попередньої вибірки.
  const listKey = `${tab}|${phase}|${owner}|${sort}|${query}`;
  if (appliedKey !== listKey) {
    setAppliedKey(listKey);
    if (limit !== 40) setLimit(40);
  }

  const normalized = query.trim().toLowerCase();
  const matches = (...fields: string[]) => !normalized || fields.some((field) => field.toLowerCase().includes(normalized));

  const pipeline = projects.pipeline
    .filter((project) => (phase === "all" ? true : phase === "active" ? project.active : project.phase === phase))
    .filter((project) => owner === "all" || project.responsible === owner)
    .filter((project) => matches(project.registryName, project.workingName, project.responsible, project.stage, project.tag))
    .sort((left, right) => {
      if (sort === "stage") return left.stageCode.localeCompare(right.stageCode) || (right.budget ?? 0) - (left.budget ?? 0);
      if (sort === "owner") return left.responsible.localeCompare(right.responsible, "uk") || (right.budget ?? 0) - (left.budget ?? 0);
      const delta = (right.budget ?? 0) - (left.budget ?? 0);
      return sort === "budget-asc" ? -delta : delta;
    });

  const delivery = projects.delivery
    .filter((project) => matches(project.title, project.status, project.manager, project.entity))
    .sort((left, right) => (right.contractValue ?? 0) - (left.contractValue ?? 0));

  const rows = tab === "pipeline" ? pipeline : delivery;
  const shown = rows.slice(0, limit);

  return (
    <div className="role-grid">
      <section className="owner-page-head">
        <div>
          <span>SHAREPOINT · CRM_DEV</span>
          <h1>Проєкти</h1>
          <p>Реєстр обʼєктів із власною воронкою стадій і відповідальними, плюс реалізація договорів 2026 року. Це друге джерело поруч із реєстром закупівель — тут видно, хто веде проєкт.</p>
        </div>
        <div className={`owner-head-sync ${projectsSync.state}`}>
          <i />
          <span>
            <b>{projectsSync.state === "live" ? "Синхронізовано" : projectsSync.state === "error" ? "Джерело недоступне" : "Збережена копія"}</b>
            <small>{projectsSync.message}</small>
          </span>
        </div>
      </section>

      {snapshotIsStale ? (
        <div className="owner-error">
          Резервна копія проєктів старша за 24 години. Дані можна використовувати для орієнтиру, але перед рішенням треба відновити Microsoft Graph або перебудувати зріз.
        </div>
      ) : null}

      <section className="owner-market-summary projects-summary">
        <div>
          <span>Проєктів у роботі</span>
          <strong>{integer(s.pipelineActive)}</strong>
          <small>{money(s.activeBudget)} планового бюджету</small>
        </div>
        <div>
          <span>Усього в реєстрі</span>
          <strong>{integer(s.pipelineCount)}</strong>
          <small>{money(s.pipelineBudget)} разом із зупиненими</small>
        </div>
        <div className={s.withoutResponsible ? "review" : "seen"}>
          <span>Із відповідальним</span>
          <strong>{integer(s.withResponsible)}</strong>
          <small>{s.withoutResponsible ? `${s.withoutResponsible} без відповідального` : "усі проєкти закріплені"}</small>
        </div>
        <div>
          <span>Договорів 2026</span>
          <strong>{integer(s.deliveryContracted)}</strong>
          <small>{money(s.deliveryContractValue)} з ПДВ</small>
        </div>
      </section>

      <section className="owner-section">
        <header>
          <div>
            <span>ВОРОНКА ЗА ДОВІДНИКОМ ФАЙЛУ</span>
            <h2>На яких етапах стоять проєкти</h2>
          </div>
        </header>
        <p className="owner-section-note">Стадії й фази взяті з довідника самого файлу, з якого команда обирає значення. Нічого не вгадано за текстом назв.</p>
        <div className="projects-funnel">
          {s.phases.map((entry) => (
            <button
              type="button"
              key={entry.phase}
              className={`projects-phase ${phaseTone[entry.phase] ?? "mixed"} ${phase === entry.phase ? "active" : ""}`}
              onClick={() => { setTab("pipeline"); setPhase(phase === entry.phase ? "active" : entry.phase); }}
            >
              <span>{entry.label}</span>
              <strong>{integer(entry.count)}</strong>
              <small>{money(entry.budget)}</small>
              <ul>
                {entry.stages.slice(0, 4).map((stage) => (
                  <li key={stage.name}><i>{stage.value}</i> {stage.name}</li>
                ))}
                {entry.stages.length > 4 ? <li className="more">ще {entry.stages.length - 4} стадії</li> : null}
              </ul>
            </button>
          ))}
        </div>
      </section>

      <section className="owner-section">
        <header>
          <div>
            <span>ХТО ЩО ВЕДЕ</span>
            <h2>Навантаження по людях</h2>
          </div>
        </header>
        <p className="owner-section-note">Поля «відповідальний» немає в реєстрі закупівель — воно є тільки тут. Бюджет плановий, а не законтрактований.</p>
        <div className="projects-owners">
          {s.owners.map((person) => (
            <button
              type="button"
              key={person.name}
              className={owner === person.name ? "active" : ""}
              onClick={() => { setTab("pipeline"); setOwner(owner === person.name ? "all" : person.name); }}
            >
              <b>{person.name}</b>
              <em>{person.active} у роботі<span> із {person.total}</span></em>
              <small>{money(person.budget)}</small>
            </button>
          ))}
        </div>
      </section>

      <section className="owner-market-toolbar owner-market-controls">
        <div className="owner-visibility-tabs">
          <button type="button" className={tab === "pipeline" ? "active" : ""} onClick={() => setTab("pipeline")}>Воронка проєктів <b>{s.pipelineCount}</b></button>
          <button type="button" className={tab === "delivery" ? "active" : ""} onClick={() => setTab("delivery")}>Реалізація 2026 <b>{s.deliveryCount}</b></button>
        </div>
        <div className="owner-filter-actions">
          <label className="owner-search">
            <Search size={17} />
            <input aria-label="Пошук проєкту" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Обʼєкт, людина, стадія" />
            {query ? <button type="button" aria-label="Очистити" onClick={() => setQuery("")}><X size={15} /></button> : null}
          </label>
          {tab === "pipeline" ? (
            <label className="owner-sort">
              <span>Сортування</span>
              <select value={sort} onChange={(event) => setSort(event.target.value as Sort)}>
                {(Object.keys(sortLabels) as Sort[]).map((item) => <option key={item} value={item}>{sortLabels[item]}</option>)}
              </select>
              <ChevronDown size={14} />
            </label>
          ) : null}
        </div>
      </section>

      {tab === "pipeline" ? (
        <section className="owner-market-toolbar">
          <div className="owner-visibility-tabs">
            <button type="button" className={phase === "active" ? "active" : ""} onClick={() => setPhase("active")}>У роботі <b>{s.pipelineActive}</b></button>
            {s.phases.map((entry) => (
              <button type="button" key={entry.phase} className={phase === entry.phase ? "active" : ""} onClick={() => setPhase(entry.phase)}>{entry.label} <b>{entry.count}</b></button>
            ))}
            <button type="button" className={phase === "all" ? "active" : ""} onClick={() => setPhase("all")}>Усі <b>{s.pipelineCount}</b></button>
          </div>
          {owner !== "all" ? (
            <button type="button" className="projects-clear" onClick={() => setOwner("all")}>{owner} <X size={13} /></button>
          ) : null}
        </section>
      ) : null}

      <details className="owner-legend">
        <summary>Звідки ці дані і чого в них навмисно немає</summary>
        <dl>
          <div><dt>Джерело</dt><dd>Два файли з теки CRM_Dev у SharePoint, читання через Microsoft Graph. Застосунок нічого туди не пише.</dd></div>
          <div><dt>Стадії</dt><dd>Беруться з довідника всередині самого файлу — того випадаючого списку, з якого команда обирає значення. Тому «1.4 Очікуємо тендер» і «2.9 Не перемога» не змішуються в одну купу.</dd></div>
          <div><dt>Бюджет</dt><dd>Планова вартість обʼєкта, а не сума підписаного договору. Це оцінка можливості, і складати її з фактичними надходженнями не можна.</dd></div>
          <div><dt>Чому немає прибутку й рентабельності</dt><dd>У файлі реалізації ці колонки є, але колонка «Орієнтовна собівартість» порожня в усіх без винятку рядках. Через це прибуток там дорівнює сумі договору, а рентабельність — рівно 100 % скрізь. Це артефакт формули, а не факт, тому ми його не показуємо. Щойно собівартість почнуть заповнювати, цифри зʼявляться.</dd></div>
          <div><dt>Статуси реалізації</dt><dd>Вільний текст без довідника — {integer(s.deliveryStatuses.length)} різних формулювань на {integer(s.deliveryCount)} рядків. Показані як є: вигадувати для них категорії означало б підмінити дані здогадкою.</dd></div>
          <div><dt>Звʼязок із Prozorro</dt><dd>{integer(s.deliveryLinked)} із {integer(s.deliveryCount)} рядків реалізації мають посилання на закупівлю — по них можна перейти в першоджерело.</dd></div>
        </dl>
      </details>

      {tab === "pipeline" ? (
        <section className="rivals-table projects-table">
          <header><span>Обʼєкт</span><span>Відповідальний</span><span>Стадія</span><span>Бюджет</span></header>
          {shown.length ? (shown as ProjectsSnapshot["pipeline"]).map((project) => (
            <div key={`${project.row}`} className={project.active ? "rivals-row projects-row" : "rivals-row projects-row muted"}>
              <span className="rivals-name">
                <span>
                  <b>{project.workingName || project.registryName}</b>
                  {/* Реєстрова назва вже починається з коду обʼєкта, тому код
                      окремо не дублюємо. Рядки без реєстрової назви показують
                      лише мітку — це проєкти, яким код ще не присвоїли. */}
                  <small>{[project.registryName !== project.workingName ? project.registryName : "", project.tag].filter(Boolean).join(" · ") || "коду обʼєкта ще немає"}</small>
                </span>
              </span>
              <span className="projects-person">{project.responsible || <i>не призначено</i>}{project.foreman ? <small>виконроб {project.foreman}</small> : null}</span>
              <span className="projects-stage">
                <em className={phaseTone[project.phase] ?? "mixed"}>{project.stageCode}</em>
                <span>{project.stage}<small>{project.phaseLabel}</small></span>
              </span>
              <span className="rivals-number strong">
                {budgetLabel(project.budget)}
                {project.tenderUrl ? <a href={project.tenderUrl} target="_blank" rel="noreferrer">закупівля <ExternalLink size={11} /></a> : null}
              </span>
            </div>
          )) : <div className="owner-empty"><b>Нічого не знайдено</b><span>Змініть фазу, відповідального або пошук.</span></div>}
        </section>
      ) : (
        <section className="rivals-table projects-table delivery">
          <header><span>Обʼєкт</span><span>Статус у файлі</span><span>Виконавець</span><span>Сума договору</span></header>
          {shown.length ? (shown as ProjectsSnapshot["delivery"]).map((project) => (
            <div key={`${project.row}`} className="rivals-row projects-row">
              <span className="rivals-name">
                <span>
                  <b>{project.title}</b>
                  <small>{[project.manager ? `менеджер ${project.manager}` : "", project.budget ? `бюджет закупівлі ${money(project.budget)}` : ""].filter(Boolean).join(" · ") || "додаткових даних немає"}</small>
                </span>
              </span>
              <span className="projects-freetext">{project.status || <i>без статусу</i>}</span>
              <span className="projects-person">{project.entity || <i>не вказано</i>}</span>
              <span className="rivals-number strong">
                {project.contractValue == null ? <i>сума не вказана</i> : money(project.contractValue)}
                {project.tenderUrl ? <a href={project.tenderUrl} target="_blank" rel="noreferrer">закупівля <ExternalLink size={11} /></a> : null}
              </span>
            </div>
          )) : <div className="owner-empty"><b>Нічого не знайдено</b><span>Змініть пошуковий запит.</span></div>}
        </section>
      )}

      {rows.length > shown.length ? (
        <button type="button" className="owner-legend-trigger projects-more" onClick={() => setLimit((value) => value + 60)}>
          Показати ще · {integer(shown.length)} із {integer(rows.length)}
        </button>
      ) : rows.length ? (
        <p className="owner-section-note projects-total">Показано всі {integer(rows.length)} записів.</p>
      ) : null}
    </div>
  );
}
