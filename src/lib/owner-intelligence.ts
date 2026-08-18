import "server-only";

import { resolveStatus } from "@/lib/workbook-dictionary.mjs";
import type {
  CompetitorRadar,
  CompetitorRadarItem,
  Direction,
  InternalSnapshot,
  InternalTender,
  OwnerControl,
  OwnerDecision,
  OwnerWorkItem,
  WorkRisk,
} from "@/lib/types";

const DAY = 24 * 60 * 60 * 1000;

function kyivDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function daysBetween(from: string, to: string | null) {
  if (!to) return Number.POSITIVE_INFINITY;
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);
}

const isComplaint = (tender: InternalTender) => resolveStatus(tender.status).stage === "complaint";
const isUnset = (tender: InternalTender) => tender.statusCode === "none";
const isPreparing = (tender: InternalTender) => tender.statusCode === "preparing";

function riskFor(days: number, tender: InternalTender): WorkRisk {
  if (days <= 0 || isComplaint(tender)) return "Критично";
  if (days <= 3 || isUnset(tender)) return "Високий";
  return "Контроль";
}

function readiness(tender: InternalTender) {
  const fields = [
    tender.qualification,
    tender.estimateNotes,
    tender.decision,
    isUnset(tender) ? "" : tender.status,
    tender.ourOffer,
  ];
  return Math.round((fields.filter(Boolean).length / fields.length) * 100);
}

function nextAction(tender: InternalTender, days: number) {
  if (isComplaint(tender)) return "Зафіксувати юридичну позицію та рішення щодо оскарження";
  if (isUnset(tender)) return days <= 3
    ? "Негайно призначити відповідального і дати рішення go / no-go"
    : "Призначити відповідального та завершити первинну оцінку";
  if (isPreparing(tender) && days <= 0) return "Підтвердити комплектність і подати пропозицію сьогодні";
  if (!tender.qualification) return "Завершити кваліфікаційну перевірку";
  if (!tender.estimateNotes) return "Завершити кошторис і перевірку маржі";
  return "Фіналізувати пакет документів та ціну участі";
}

function toWorkItem(today: string, tender: InternalTender): OwnerWorkItem {
  const days = daysBetween(today, tender.deadline);
  return {
    id: tender.id,
    title: tender.title,
    buyer: tender.buyer,
    direction: tender.direction,
    deadline: tender.deadline,
    value: tender.value,
    stage: tender.status,
    responsible: "Не вказано у закупівлі.xlsx",
    nextAction: nextAction(tender, days),
    readiness: readiness(tender),
    risk: riskFor(days, tender),
  };
}

function toDecision(today: string, tender: InternalTender): OwnerDecision {
  const days = daysBetween(today, tender.deadline);
  const complaint = isComplaint(tender);
  const unclassified = isUnset(tender);
  return {
    id: tender.id,
    title: tender.title,
    value: tender.value,
    deadline: tender.deadline,
    decision: complaint
      ? "Погодити стратегію оскарження"
      : unclassified
        ? "Go / no-go та відповідальний"
        : "Підтвердити готовність подачі",
    reason: complaint
      ? "Дедлайн сьогодні, у джерелі зафіксована скарга на умови"
      : unclassified
        ? "Тендер майбутній, але статус і відповідальний за задачу відсутні"
        : "Пропозиція готується, а дедлайн уже сьогодні",
    urgency: riskFor(days, tender),
  };
}

export function buildOwnerControl(snapshot: InternalSnapshot): OwnerControl {
  const now = new Date();
  const today = kyivDate(now);
  const future = snapshot.tenders.filter((tender) => tender.deadline && tender.deadline >= today);
  // Незакрита процедура або рядок без статусу, який ще треба розібрати.
  const active = future.filter((tender) => tender.statusGroup === "in-progress" || isUnset(tender));
  const preparing = active.filter(isPreparing);
  const complaints = active.filter(isComplaint);
  const unclassified = active.filter(isUnset);
  const dueToday = active.filter((tender) => tender.deadline === today);
  const due72h = active.filter((tender) => daysBetween(today, tender.deadline) <= 3);
  const sum = (items: InternalTender[]) => items.reduce((total, item) => total + item.value, 0);
  const ordered = [...active].sort((a, b) => {
    const byDeadline = (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999");
    return byDeadline || b.value - a.value;
  });
  const decisionCandidates = active.filter((tender) => {
    const days = daysBetween(today, tender.deadline);
    return isComplaint(tender) || (isUnset(tender) && days <= 3) || (isPreparing(tender) && days <= 0);
  });
  const recordsWithParticipants = snapshot.tenders.filter((tender) => tender.participants.length > 0).length;

  return {
    generatedAt: now.toISOString(),
    today,
    active: { count: active.length, value: sum(active) },
    dueToday: { count: dueToday.length, value: sum(dueToday) },
    due72h: { count: due72h.length, value: sum(due72h) },
    preparing: { count: preparing.length, value: sum(preparing) },
    complaints: { count: complaints.length, value: sum(complaints) },
    unclassified: { count: unclassified.length, value: sum(unclassified) },
    workNow: ordered.slice(0, 14).map((tender) => toWorkItem(today, tender)),
    decisions: decisionCandidates.slice(0, 10).map((tender) => toDecision(today, tender)),
    crm: {
      observedAt: now.toISOString(),
      mode: "snapshot",
      note: "CRM-джерело вимкнене. Робочий стан береться лише із закупівлі.xlsx у SharePoint.",
      pipelines: [],
    },
    dataQuality: {
      sourceUpdatedAt: snapshot.exportedAt,
      recordsWithoutStatus: unclassified.length,
      recordsWithParticipants,
      participantCoverage: Math.round((recordsWithParticipants / snapshot.tenders.length) * 1000) / 10,
      hasAssigneeField: false,
      hasUpdatedAtField: false,
    },
  };
}

const strategic = new Map([
  ["ПРОМІЛЕКС", { revenue2025: 125_330_700, growth: 47.01, tenderSales2025: 134_059_000 }],
  ["ПРОБІЛДГРУП", { revenue2025: 82_547_000, growth: 730, tenderSales2025: 104_778_000 }],
  ["МЕГА-БУД ДЕВЕЛОПМЕНТ", { revenue2025: 23_886_800, growth: 28.1, tenderSales2025: 17_231_000 }],
]);

function cleanedName(value: string) {
  return value.replace(/\s+/g, " ").replace(/^[,;\s]+|[,;\s]+$/g, "").trim();
}

function normalizedName(value: string) {
  return cleanedName(value)
    .toUpperCase()
    .replace(/[«»“”"'`]/g, "")
    .replace(/\b(ТОВ|ПП|ПРИВАТНЕ ПІДПРИЄМСТВО|ФОП|БК|ПРАТ|АТ)\b/g, "")
    .replace(/[^А-ЯІЇЄҐA-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalName(value: string) {
  const normalized = normalizedName(value);
  if (/^(ТЕП КЕПІТАЛ|ПРОМІЛЕКС)$/.test(normalized)) return "ПРОМІЛЕКС";
  if (/ПРОБІЛДГРУП|ПРО БІЛД ГРУП/.test(normalized)) return "ПРОБІЛДГРУП";
  if (/МЕГА БУД ДЕВЕЛОПМЕНТ/.test(normalized)) return "МЕГА-БУД ДЕВЕЛОПМЕНТ";
  return cleanedName(value);
}

function isCompanyName(value: string) {
  const candidate = cleanedName(value);
  if (candidate.length < 3 || candidate.length > 110) return false;
  return !/(закупівл|тендер не|не відбул|відсутн|участ|пропозиц|дискваліф|перемож|відхилен|подали|немає|причин)/i.test(candidate);
}

type MutableRadar = Omit<CompetitorRadarItem, "directions" | "sources"> & {
  directions: Set<Direction>;
  sources: Set<string>;
};

export function buildCompetitorRadar(snapshot: InternalSnapshot): CompetitorRadar {
  const radar = new Map<string, MutableRadar>();
  const internalNames = new Set<string>();

  const upsert = (name: string, direction: Direction, encounters: number, exposure: number, lastSeen: string | null, source: string, internal: boolean) => {
    if (!isCompanyName(name)) return;
    const canonical = canonicalName(name);
    const key = normalizedName(canonical);
    if (!key || key === "СПЕЦСЕРВІС") return;
    const existing = radar.get(key);
    if (existing) {
      existing.encounters += encounters;
      existing.exposure += exposure;
      existing.directions.add(direction);
      existing.sources.add(source);
      if (lastSeen && (!existing.lastSeen || lastSeen > existing.lastSeen)) existing.lastSeen = lastSeen;
      if (cleanedName(name) !== existing.name && !existing.aliases.includes(cleanedName(name))) existing.aliases.push(cleanedName(name));
    } else {
      const finance = strategic.get(canonical);
      radar.set(key, {
        name: canonical,
        aliases: canonical === "ПРОМІЛЕКС" ? ["ТЕП-КЕПІТАЛ"] : [],
        directions: new Set([direction]),
        encounters,
        exposure,
        lastSeen,
        sources: new Set([source]),
        confidence: internal ? "Середня" : "Discovery",
        revenue2025: finance?.revenue2025 ?? null,
        growth: finance?.growth ?? null,
        tenderSales2025: finance?.tenderSales2025 ?? null,
      });
    }
    if (internal) internalNames.add(key);
  };

  // Єдине джерело цього блоку — колонки «Учасник 1–4» самого файлу. Реальні
  // конкуренти з ринку живуть окремо, у зрізі ставок Prozorro (/api/competitors),
  // і не змішуються з тим, що команда встигла записати вручну.
  snapshot.tenders.forEach((tender) => {
    tender.participants.forEach((participant) => {
      upsert(participant, tender.direction, 1, tender.value, tender.deadline, "закупівлі.xlsx", true);
    });
  });

  const items = [...radar.values()]
    .map((item): CompetitorRadarItem => ({
      ...item,
      directions: [...item.directions],
      sources: [...item.sources],
      confidence: item.encounters >= 2 && item.sources.has("закупівлі.xlsx") ? "Висока" : item.confidence,
    }))
    .sort((a, b) => b.encounters - a.encounters || b.exposure - a.exposure || a.name.localeCompare(b.name, "uk"));
  const byDirection: Direction[] = ["Капбудівництво", "Сервіс", "Кондиціонування", "Інше"];
  const recordsWithParticipants = snapshot.tenders.filter((tender) => tender.participants.length > 0).length;

  return {
    total: items.length,
    fromInternal: internalNames.size,
    discoveries: 0,
    participantCoverage: Math.round((recordsWithParticipants / snapshot.tenders.length) * 1000) / 10,
    byDirection: byDirection.map((name) => ({ name, value: items.filter((item) => item.directions.includes(name)).length })),
    items,
  };
}
