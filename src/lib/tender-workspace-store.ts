import "server-only";

import { randomUUID } from "node:crypto";
import type { DashboardAccount } from "@/lib/accounts";
import { tenderWorkspaceMembers } from "@/lib/accounts";
import { getAnalyticsSql } from "@/lib/analytics-v2-db";
import { ensureAnalyticsV2Schema } from "@/lib/analytics-v2-migrate";
import { persistAnalyticsV2 } from "@/lib/analytics-v2-persist";
import { importProzorroAnalytics } from "@/lib/prozorro-analytics";
import type {
  TenderParticipationDecision,
  TenderWorkflowStatus,
  TenderWorkPriority,
  TenderWorkspaceItem,
  TenderWorkspacePatch,
  TenderWorkspacePayload,
  TenderWorkbookFields,
} from "@/lib/tender-workspace";

const ENABLED_DIRECTIONS = ["Кондиціонування"] as const;
const SYSTEM_ACTOR = "system:analytics-sync";

type WorkRow = {
  id: string;
  procurement_id: string;
  tender_id: string;
  prozorro_url: string;
  title: string;
  description: string | null;
  buyer_name: string | null;
  buyer_edrpou: string | null;
  procurement_method_type: string | null;
  source_status: string | null;
  main_category: string | null;
  cpv_codes: string[] | null;
  published_at: string | Date | null;
  submission_deadline: string | Date | null;
  auction_at: string | Date | null;
  delivery_deadline: string | Date | null;
  expected_amount: number | string | null;
  expected_currency: string | null;
  guarantee_amount: number | string | null;
  payment_terms: Array<Record<string, unknown>> | null;
  region: string | null;
  locality: string | null;
  delivery_address: string | null;
  quantity: number | string | null;
  unit_code: string | null;
  lowest_bid_amount: number | string | null;
  lowest_bidder: string | null;
  winner_name: string | null;
  winner_amount: number | string | null;
  award_date: string | Date | null;
  contract_status: string | null;
  contract_amount: number | string | null;
  contract_id: string | null;
  workbook_tracked: boolean;
  workbook_snapshot: TenderWorkbookFields | null;
  participation_decision: TenderParticipationDecision;
  workflow_status: TenderWorkflowStatus;
  priority: TenderWorkPriority;
  assigned_account_id: string | null;
  decision_reason: string | null;
  action_note: string | null;
  manager_note: string | null;
  next_action_at: string | Date | null;
  first_seen_at: string | Date;
  source_updated_at: string | Date | null;
  updated_at: string | Date;
  updated_by: string | null;
  version: number;
};

type MutableRow = Pick<WorkRow,
  | "id"
  | "participation_decision"
  | "workflow_status"
  | "priority"
  | "assigned_account_id"
  | "decision_reason"
  | "action_note"
  | "manager_note"
  | "next_action_at"
  | "version"
>;

const decisions = new Set<TenderParticipationDecision>(["undecided", "participate", "skip", "partner"]);
const workflowStatuses = new Set<TenderWorkflowStatus>(["new", "review", "preparing", "submitted", "qualification", "won", "lost", "contract", "closed"]);
const priorities = new Set<TenderWorkPriority>(["low", "normal", "high", "critical"]);

export type TenderWorkbookImportRow = {
  tenderId: string;
  fields: TenderWorkbookFields;
  decision: TenderParticipationDecision;
  status: TenderWorkflowStatus;
  decisionReason: string | null;
  actionNote: string | null;
};

const iso = (value: string | Date | null) => value instanceof Date ? value.toISOString() : value;
const numeric = (value: string | number | null) => value == null || !Number.isFinite(Number(value)) ? null : Number(value);
const cleanText = (value: unknown, maximum = 4_000) => typeof value === "string" ? value.trim().slice(0, maximum) || null : null;

async function fetchOfficialTender(tenderId: string, fields: TenderWorkbookFields) {
  const fetchById = async (id: string) => {
    const response = await fetch(`https://public-api.prozorro.gov.ua/api/2.5/tenders/${encodeURIComponent(id)}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) return null;
    return response.json() as Promise<unknown>;
  };

  const direct = await fetchById(tenderId);
  if (direct) return direct;

  // Some SmartTender exports contain the public UA number while the official
  // API detail endpoint accepts only Prozorro's internal UUID. Resolve that
  // UUID through the workbook's public SmartTender reference, then read all
  // canonical facts from the official Prozorro API.
  const smartTenderId = fields.smartTenderUrl?.match(/prozorro\/(\d+)(?:\/|$)/i)?.[1]
    ?? fields.smartTenderId?.match(/^\d+$/)?.[0];
  if (!smartTenderId) return null;
  const announcement = await fetch(`https://smarttender.biz/PurchaseDetail/GetAnnouncement?tenderId=${encodeURIComponent(smartTenderId)}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  if (!announcement.ok) return null;
  const payload = await announcement.json() as { EntityCdbLink?: unknown };
  const cdbLink = typeof payload.EntityCdbLink === "string" ? payload.EntityCdbLink : "";
  const cdbId = cdbLink.match(/\/tenders\/([a-f0-9]{32})(?:[/?#]|$)/i)?.[1];
  return cdbId ? fetchById(cdbId) : null;
}

function itemFromRow(row: WorkRow): TenderWorkspaceItem {
  const expectedAmount = numeric(row.expected_amount);
  const quantity = numeric(row.quantity);
  return {
    id: row.id,
    procurementId: row.procurement_id,
    tenderId: row.tender_id,
    prozorroUrl: row.prozorro_url,
    title: row.title,
    description: row.description,
    buyerName: row.buyer_name ?? "Замовника не вказано",
    buyerEdrpou: row.buyer_edrpou,
    procedureType: row.procurement_method_type,
    sourceStatus: row.source_status,
    category: row.main_category,
    cpvCodes: row.cpv_codes ?? [],
    publishedAt: iso(row.published_at),
    submissionDeadline: iso(row.submission_deadline),
    auctionAt: iso(row.auction_at),
    deliveryDeadline: iso(row.delivery_deadline),
    expectedAmount,
    currency: row.expected_currency,
    guaranteeAmount: numeric(row.guarantee_amount),
    paymentTerms: Array.isArray(row.payment_terms) ? row.payment_terms : [],
    region: row.region,
    locality: row.locality,
    deliveryAddress: row.delivery_address,
    quantity,
    unitCode: row.unit_code,
    unitPrice: expectedAmount != null && quantity && quantity > 0 ? expectedAmount / quantity : null,
    lowestBidAmount: numeric(row.lowest_bid_amount),
    lowestBidder: row.lowest_bidder,
    winnerName: row.winner_name,
    winnerAmount: numeric(row.winner_amount),
    awardDate: iso(row.award_date),
    contractUrl: row.contract_id ? `https://prozorro.gov.ua/uk/contract/${encodeURIComponent(row.contract_id)}` : null,
    contractStatus: row.contract_status,
    contractAmount: numeric(row.contract_amount),
    workbookTracked: row.workbook_tracked,
    workbookFields: row.workbook_snapshot && typeof row.workbook_snapshot === "object" ? row.workbook_snapshot : {},
    participationDecision: row.participation_decision,
    workflowStatus: row.workflow_status,
    priority: row.priority,
    assignedAccountId: row.assigned_account_id,
    decisionReason: row.decision_reason,
    actionNote: row.action_note,
    managerNote: row.manager_note,
    nextActionAt: iso(row.next_action_at),
    firstSeenAt: iso(row.first_seen_at)!,
    sourceUpdatedAt: iso(row.source_updated_at),
    updatedAt: iso(row.updated_at)!,
    updatedBy: row.updated_by,
    version: row.version,
  };
}

function workspaceAccess(account: DashboardAccount) {
  return account.direction === "Кондиціонування" ? account.tenderWorkspaceAccess : null;
}

export async function syncTenderWorkspace() {
  await ensureAnalyticsV2Schema();
  const sql = getAnalyticsSql();
  if (!sql) throw new Error("DATABASE_URL is required");
  const inserted = await sql`
    insert into tender_work_items (id, procurement_id, direction, source_updated_at)
    select 'work:' || p.id, p.id, p.department, p.source_modified_at
    from analytics_procurements p
    where p.department = any(${[...ENABLED_DIRECTIONS]}::text[])
      and p.submission_end_at > now()
      and p.status in ('active.enquiries', 'active.tendering')
      and exists (
        select 1 from analytics_dataset_procurements dp
        where dp.procurement_id = p.id and dp.dataset_id = 'analytics-v2-monitoring'
      )
    on conflict (procurement_id) do nothing
    returning id
  ` as unknown as Array<{ id: string }>;
  const refreshed = await sql`
    update tender_work_items w
    set last_seen_at = now(), source_updated_at = p.source_modified_at
    from analytics_procurements p
    where w.procurement_id = p.id
      and w.direction = any(${[...ENABLED_DIRECTIONS]}::text[])
      and w.source_updated_at is distinct from p.source_modified_at
    returning w.id
  ` as unknown as Array<{ id: string }>;
  for (const row of inserted) {
    await sql`
      insert into tender_work_events (id, work_item_id, actor_account_id, event_type, changed_fields, next_state)
      values (${randomUUID()}, ${row.id}, ${SYSTEM_ACTOR}, 'created', ${["source"]}::text[], '{"source":"prozorro"}'::jsonb)
    `;
  }
  for (const row of refreshed) {
    await sql`
      insert into tender_work_events (id, work_item_id, actor_account_id, event_type, changed_fields, next_state)
      values (${randomUUID()}, ${row.id}, ${SYSTEM_ACTOR}, 'source-refresh', ${["source"]}::text[], '{"source":"prozorro"}'::jsonb)
    `;
  }
  const now = new Date().toISOString();
  await sql`
    insert into analytics_sync_state (stream_key, last_started_at, last_finished_at, last_success_at, processed_count, imported_count, metadata, updated_at)
    values ('tender-workspace:Кондиціонування', ${now}, ${now}, ${now}, ${inserted.length + refreshed.length}, ${inserted.length},
      ${JSON.stringify({ inserted: inserted.length, refreshed: refreshed.length })}::jsonb, ${now})
    on conflict (stream_key) do update set last_started_at = excluded.last_started_at,
      last_finished_at = excluded.last_finished_at, last_success_at = excluded.last_success_at,
      processed_count = analytics_sync_state.processed_count + excluded.processed_count,
      imported_count = analytics_sync_state.imported_count + excluded.imported_count,
      failure_count = 0, last_error = null, metadata = excluded.metadata, updated_at = excluded.updated_at
  `;
  return { inserted: inserted.length, refreshed: refreshed.length, finishedAt: now };
}

export async function importTenderWorkbookRows(input: TenderWorkbookImportRow[]) {
  if (!Array.isArray(input) || input.length > 200) throw new Error("Workbook import must contain at most 200 rows");
  await ensureAnalyticsV2Schema();
  const sql = getAnalyticsSql();
  if (!sql) throw new Error("DATABASE_URL is required");
  let imported = 0;
  const missing: string[] = [];
  for (const raw of input) {
    const tenderId = cleanText(raw.tenderId, 64);
    if (!tenderId || !/^UA-\d{4}-\d{2}-\d{2}-\d{6}-[a-z]$/i.test(tenderId)) continue;
    const fields = Object.fromEntries(Object.entries(raw.fields ?? {})
      .filter(([, value]) => typeof value === "string")
      .map(([key, value]) => [key, String(value).slice(0, 20_000)])) as TenderWorkbookFields;
    const decision = decisions.has(raw.decision) ? raw.decision : "undecided";
    const status = workflowStatuses.has(raw.status) ? raw.status : "new";
    let procurements = await sql`
      select id from analytics_procurements where tender_id = ${tenderId} limit 1
    ` as unknown as Array<{ id: string }>;
    if (!procurements[0]) {
      try {
        const tenderDetail = await fetchOfficialTender(tenderId, fields);
        if (!tenderDetail) throw new Error("Tender was not found in the official Prozorro API");
        const importedAt = new Date().toISOString();
        const dataset = importProzorroAnalytics(tenderDetail, [], { importedAt, tenderFetchedAt: importedAt });
        await persistAnalyticsV2(dataset, {
          datasetId: "analytics-v2-monitoring",
          scope: "monitoring",
          sourceName: "Official Prozorro API · workbook-authoritative import",
          filters: { source: "conditioning-workbook" },
          directions: Object.fromEntries(dataset.procurements.map((procurement) => [procurement.id, "Кондиціонування"])),
          replaceMembership: false,
        });
        procurements = await sql`
          select id from analytics_procurements where tender_id = ${tenderId} limit 1
        ` as unknown as Array<{ id: string }>;
      } catch {
        // Report the exact ID as missing; a later import can retry safely.
      }
    }
    const procurement = procurements[0];
    if (!procurement) { missing.push(tenderId); continue; }
    const rows = await sql`
      insert into tender_work_items (
        id, procurement_id, direction, workbook_tracked, workbook_snapshot,
        participation_decision, workflow_status, decision_reason, action_note
      ) values (
        ${`work:${procurement.id}`}, ${procurement.id}, 'Кондиціонування', true, ${JSON.stringify(fields)}::jsonb,
        ${decision}, ${status}, ${cleanText(raw.decisionReason)}, ${cleanText(raw.actionNote, 12_000)}
      )
      on conflict (procurement_id) do update set
        workbook_tracked = true,
        workbook_snapshot = excluded.workbook_snapshot,
        participation_decision = case when tender_work_items.version = 1 and tender_work_items.updated_by is null then excluded.participation_decision else tender_work_items.participation_decision end,
        workflow_status = case when tender_work_items.version = 1 and tender_work_items.updated_by is null then excluded.workflow_status else tender_work_items.workflow_status end,
        decision_reason = case when tender_work_items.version = 1 and tender_work_items.updated_by is null then excluded.decision_reason else tender_work_items.decision_reason end,
        action_note = case when tender_work_items.version = 1 and tender_work_items.updated_by is null then excluded.action_note else tender_work_items.action_note end,
        last_seen_at = now()
      returning id
    ` as unknown as Array<{ id: string }>;
    await sql`
      insert into tender_work_events (id, work_item_id, actor_account_id, event_type, changed_fields, next_state)
      values (${randomUUID()}, ${rows[0].id}, 'system:workbook-import', 'source-refresh', ${["workbookSnapshot"]}::text[], ${JSON.stringify({ tenderId })}::jsonb)
    `;
    imported += 1;
  }
  return { imported, missingCount: missing.length, missing };
}

export async function loadTenderWorkspace(account: DashboardAccount): Promise<TenderWorkspacePayload | null> {
  const access = workspaceAccess(account);
  if (!access) return null;
  await ensureAnalyticsV2Schema();
  const sql = getAnalyticsSql();
  if (!sql) throw new Error("DATABASE_URL is required");
  const rows = await sql`
    select w.id, w.procurement_id, p.tender_id, p.prozorro_url, p.title, p.description,
      buyer.legal_name as buyer_name, buyer.identifier as buyer_edrpou,
      p.procurement_method_type, p.status as source_status, p.main_category,
      p.published_at, p.submission_end_at as submission_deadline, p.auction_start_at as auction_at,
      p.expected_amount, p.expected_currency, p.guarantee_amount, p.payment_terms,
      facts.cpv_codes, facts.delivery_deadline, facts.region, facts.locality, facts.delivery_address,
      facts.quantity, facts.unit_code,
      low_bid.lowest_bid_amount, low_bid.lowest_bidder,
      winner.winner_name, winner.winner_amount, winner.award_date,
      latest_contract.contract_id, latest_contract.contract_status, latest_contract.contract_amount,
      w.workbook_tracked, w.workbook_snapshot,
      w.participation_decision, w.workflow_status, w.priority, w.assigned_account_id,
      w.decision_reason, w.action_note, w.manager_note, w.next_action_at, w.first_seen_at,
      w.source_updated_at, w.updated_at, w.updated_by, w.version
    from tender_work_items w
    join analytics_procurements p on p.id = w.procurement_id
    left join analytics_organizations buyer on buyer.id = p.buyer_id
    left join lateral (
      select array_remove(array_agg(distinct i.cpv_code), null) as cpv_codes,
        max(i.delivery_end_at) as delivery_deadline,
        max(i.delivery_region) as region, max(i.delivery_locality) as locality,
        string_agg(distinct nullif(i.delivery_text, ''), ' | ') as delivery_address,
        case when count(distinct i.unit_code) <= 1 then sum(i.quantity) else null end as quantity,
        case when count(distinct i.unit_code) <= 1 then max(i.unit_code) else null end as unit_code
      from analytics_items i where i.procurement_id = p.id
    ) facts on true
    left join lateral (
      select b.latest_amount as lowest_bid_amount, supplier.legal_name as lowest_bidder
      from analytics_bids b join analytics_organizations supplier on supplier.id = b.supplier_id
      where b.procurement_id = p.id and b.latest_amount is not null
      order by b.latest_amount asc, b.value_at desc nulls last limit 1
    ) low_bid on true
    left join lateral (
      select supplier.legal_name as winner_name, a.amount as winner_amount, a.decision_at as award_date
      from analytics_awards a join analytics_organizations supplier on supplier.id = a.supplier_id
      where a.procurement_id = p.id and a.status = 'active'
      order by a.decision_at desc nulls last limit 1
    ) winner on true
    left join lateral (
      select c.id as contract_id, c.status as contract_status, c.current_amount as contract_amount
      from analytics_contracts c where c.procurement_id = p.id
      order by c.signed_at desc nulls last, c.source_modified_at desc nulls last limit 1
    ) latest_contract on true
    where w.direction = 'Кондиціонування'
      and (
        (p.submission_end_at > now()
          and p.status in ('active.enquiries', 'active.tendering')
          and w.participation_decision <> 'skip'
          and w.workflow_status <> 'closed')
        or w.participation_decision in ('participate', 'partner')
        or w.workflow_status in ('review', 'preparing', 'submitted', 'qualification', 'won', 'contract')
        or w.assigned_account_id is not null
        or w.action_note is not null
        or w.manager_note is not null
      )
    order by p.submission_end_at asc nulls last, p.published_at desc nulls last
    limit 1500
  ` as unknown as WorkRow[];
  const syncRows = await sql`
    select last_success_at from analytics_sync_state where stream_key = 'tender-workspace:Кондиціонування'
  ` as unknown as Array<{ last_success_at: string | Date | null }>;
  return {
    direction: "Кондиціонування",
    access,
    generatedAt: new Date().toISOString(),
    lastSyncAt: iso(syncRows[0]?.last_success_at ?? null),
    members: tenderWorkspaceMembers("Кондиціонування"),
    items: rows.map(itemFromRow),
  };
}

function patchState(row: MutableRow) {
  return {
    participationDecision: row.participation_decision,
    workflowStatus: row.workflow_status,
    priority: row.priority,
    assignedAccountId: row.assigned_account_id,
    decisionReason: row.decision_reason,
    actionNote: row.action_note,
    managerNote: row.manager_note,
    nextActionAt: iso(row.next_action_at),
  };
}

export async function updateTenderWorkItem(account: DashboardAccount, patch: TenderWorkspacePatch) {
  const access = workspaceAccess(account);
  if (!access) return { kind: "forbidden" as const };
  await ensureAnalyticsV2Schema();
  const sql = getAnalyticsSql();
  if (!sql) throw new Error("DATABASE_URL is required");
  const rows = await sql`
    select id, participation_decision, workflow_status, priority, assigned_account_id,
      decision_reason, action_note, manager_note, next_action_at, version
    from tender_work_items where id = ${patch.id} and direction = 'Кондиціонування' limit 1
  ` as unknown as MutableRow[];
  const current = rows[0];
  if (!current) return { kind: "missing" as const };
  if (current.version !== patch.version) return { kind: "conflict" as const };
  const isManager = access === "manager";
  const members = tenderWorkspaceMembers("Кондиціонування");
  const memberIds = new Set(members.map((member) => member.id));
  const requestedAssignee = patch.assignedAccountId === undefined ? current.assigned_account_id : cleanText(patch.assignedAccountId, 100);
  if (requestedAssignee && !memberIds.has(requestedAssignee)) return { kind: "invalid" as const };
  if (!isManager && patch.priority !== undefined) return { kind: "forbidden" as const };
  if (!isManager && patch.managerNote !== undefined) return { kind: "forbidden" as const };
  if (!isManager && patch.assignedAccountId !== undefined) {
    const mayClaim = (!current.assigned_account_id && requestedAssignee === account.id)
      || (current.assigned_account_id === account.id && (requestedAssignee === account.id || requestedAssignee === null));
    if (!mayClaim) return { kind: "forbidden" as const };
  }
  if (!isManager && current.assigned_account_id !== account.id) {
    const claimingForSelf = !current.assigned_account_id && requestedAssignee === account.id;
    if (!claimingForSelf) return { kind: "forbidden" as const };
  }
  const participationDecision = patch.participationDecision !== undefined && decisions.has(patch.participationDecision)
    ? patch.participationDecision : current.participation_decision;
  const workflowStatus = patch.workflowStatus !== undefined && workflowStatuses.has(patch.workflowStatus)
    ? patch.workflowStatus : current.workflow_status;
  const priority = patch.priority !== undefined && priorities.has(patch.priority) ? patch.priority : current.priority;
  const nextActionAt = patch.nextActionAt === undefined
    ? iso(current.next_action_at)
    : patch.nextActionAt && !Number.isNaN(Date.parse(patch.nextActionAt)) ? new Date(patch.nextActionAt).toISOString() : null;
  const next = {
    participationDecision,
    workflowStatus,
    priority,
    assignedAccountId: requestedAssignee,
    decisionReason: patch.decisionReason === undefined ? current.decision_reason : cleanText(patch.decisionReason),
    actionNote: patch.actionNote === undefined ? current.action_note : cleanText(patch.actionNote, 12_000),
    managerNote: patch.managerNote === undefined ? current.manager_note : cleanText(patch.managerNote, 12_000),
    nextActionAt,
  };
  const previous = patchState(current);
  const changedFields = Object.keys(next).filter((key) => next[key as keyof typeof next] !== previous[key as keyof typeof previous]);
  if (!changedFields.length) return { kind: "updated" as const, version: current.version };
  const updated = await sql`
    update tender_work_items set participation_decision = ${next.participationDecision}, workflow_status = ${next.workflowStatus},
      priority = ${next.priority}, assigned_account_id = ${next.assignedAccountId}, decision_reason = ${next.decisionReason},
      action_note = ${next.actionNote}, manager_note = ${next.managerNote}, next_action_at = ${next.nextActionAt},
      updated_at = now(), updated_by = ${account.id}, version = version + 1
    where id = ${current.id} and version = ${current.version}
    returning version
  ` as unknown as Array<{ version: number }>;
  if (!updated[0]) return { kind: "conflict" as const };
  await sql`
    insert into tender_work_events (id, work_item_id, actor_account_id, event_type, changed_fields, previous_state, next_state)
    values (${randomUUID()}, ${current.id}, ${account.id}, 'updated', ${changedFields}::text[],
      ${JSON.stringify(previous)}::jsonb, ${JSON.stringify(next)}::jsonb)
  `;
  return { kind: "updated" as const, version: updated[0].version };
}
