import "server-only";

import { createHash, randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { getAnalyticsSql } from "@/lib/analytics-v2-db";

/**
 * Outbound integrations deliberately use a second Entra application. The
 * read-only client in graph.ts is never imported or granted write access.
 *
 * Mail uses the application `Mail.Send` permission. Excel workbook table APIs
 * do not support app-only access consistently, so a dedicated .xlsx drive item
 * is downloaded, its named table is rebuilt, and the file is uploaded through
 * `/drive/items/{id}/content`. Grant the writer `Sites.Selected` with `write`
 * only on the export site; the source CRM site can remain read-only.
 */
const GRAPH_ROOT = "https://graph.microsoft.com/v1.0";
const TOKEN_TIMEOUT_MS = 20_000;
const GRAPH_TIMEOUT_MS = 45_000;
const DEFAULT_LOOKBACK_HOURS = 24;
const DEFAULT_EVENT_LIMIT = 250;
const MAX_EVENT_LIMIT = 2_000;
const EMAIL_STREAM_PREFIX = "integration:tender-email:";
const EXCEL_STREAM_KEY = "integration:tender-excel";

type IntegrationCredentials = {
  tenantId: string;
  clientId: string;
  clientSecret: string;
};

type SubscriptionFilters = Record<string, unknown>;

export type TenderSubscription = {
  id: string;
  name: string;
  recipients: string[];
  presetId?: string;
  ownerAccountId?: string;
  filters: SubscriptionFilters;
};

type TenderEvent = {
  id: string;
  tenderId: string;
  title: string;
  buyerId: string | null;
  buyerName: string | null;
  department: string | null;
  cpvCode: string | null;
  procedureType: string | null;
  status: string | null;
  category: string | null;
  region: string | null;
  expectedAmount: number | null;
  currency: string | null;
  publishedAt: string | null;
  modifiedAt: string;
  submissionEndAt: string | null;
  prozorroUrl: string;
};

type StateRow = {
  cursor_value: string | null;
  last_success_at: string | Date | null;
  last_error: string | null;
  metadata: Record<string, unknown> | null;
};

type IntegrationState = {
  cursor: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  metadata: Record<string, unknown>;
};

type ExcelConfig = {
  siteId: string;
  driveId: string;
  itemId: string;
  worksheet: string;
  table: string;
};

export type TenderIntegrationStatus = {
  configured: boolean;
  database: boolean;
  email: {
    enabled: boolean;
    reason: string | null;
    subscriptions: number;
    lastSuccessAt: string | null;
    lastError: string | null;
  };
  excel: {
    enabled: boolean;
    reason: string | null;
    lastSuccessAt: string | null;
    lastError: string | null;
  };
  subscriptionItems: TenderSubscription[];
};

export type IntegrationRunResult = {
  ok: boolean;
  email: Array<{ id: string; status: "sent" | "empty" | "deduplicated" | "disabled"; events: number }>;
  excel: { status: "updated" | "unchanged" | "disabled"; rows: number };
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function trimmed(name: string) {
  return process.env[name]?.trim() ?? "";
}

function positiveInteger(name: string, fallback: number, maximum: number) {
  const value = Number(trimmed(name));
  return Number.isSafeInteger(value) && value > 0 ? Math.min(value, maximum) : fallback;
}

function credentials(): IntegrationCredentials | null {
  const tenantId = trimmed("TENDER_INTEGRATION_TENANT_ID");
  const clientId = trimmed("TENDER_INTEGRATION_CLIENT_ID");
  const clientSecret = trimmed("TENDER_INTEGRATION_CLIENT_SECRET");
  return tenantId && clientId && clientSecret ? { tenantId, clientId, clientSecret } : null;
}

function excelConfig(): ExcelConfig | null {
  const siteId = trimmed("TENDER_EXCEL_SITE_ID");
  const driveId = trimmed("TENDER_EXCEL_DRIVE_ID");
  const itemId = trimmed("TENDER_EXCEL_ITEM_ID");
  const worksheet = trimmed("TENDER_EXCEL_WORKSHEET") || "Тендери";
  const table = trimmed("TENDER_EXCEL_TABLE") || "TenderExport";
  if (!siteId || !driveId || !itemId || !/^[A-Za-z_][A-Za-z0-9_.]{0,254}$/.test(table)) return null;
  return { siteId, driveId, itemId, worksheet: worksheet.slice(0, 31), table };
}

function stringArray(value: unknown, maxItems = 100) {
  const input = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  return input.map((item) => String(item).trim()).filter(Boolean).slice(0, maxItems);
}

export function parseTenderSubscriptions(raw = trimmed("TENDER_NOTIFICATION_SUBSCRIPTIONS_JSON")): TenderSubscription[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const subscriptions: TenderSubscription[] = [];
  const ids = new Set<string>();
  for (const candidate of parsed.slice(0, 100)) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const item = candidate as Record<string, unknown>;
    const id = String(item.id ?? "").trim().slice(0, 80);
    const name = String(item.name ?? id).trim().slice(0, 120);
    const recipients = stringArray(item.recipients, 20).filter((value) => emailPattern.test(value));
    if (!id || ids.has(id) || !name || !recipients.length) continue;
    const filters = item.filters && typeof item.filters === "object" && !Array.isArray(item.filters)
      ? item.filters as SubscriptionFilters
      : {};
    const presetId = typeof item.presetId === "string" ? item.presetId.trim().slice(0, 100) : undefined;
    const ownerAccountId = typeof item.ownerAccountId === "string" ? item.ownerAccountId.trim().slice(0, 100) : undefined;
    if (presetId && !ownerAccountId) continue;
    subscriptions.push({ id, name, recipients, filters, presetId, ownerAccountId });
    ids.add(id);
  }
  return subscriptions;
}

async function loadTenderSubscriptions() {
  const fromEnvironment = parseTenderSubscriptions();
  const sql = getAnalyticsSql();
  if (!sql) return fromEnvironment;
  const rows = await sql`
    select id, name, recipients, filters, preset_id, owner_account_id
    from analytics_tender_subscriptions where active order by updated_at desc
  ` as unknown as Array<{
    id: string; name: string; recipients: string[]; filters: SubscriptionFilters;
    preset_id: string | null; owner_account_id: string | null;
  }>;
  const databaseItems = rows.map((row): TenderSubscription => ({
    id: row.id,
    name: row.name,
    recipients: row.recipients,
    filters: row.filters ?? {},
    presetId: row.preset_id ?? undefined,
    ownerAccountId: row.owner_account_id ?? undefined,
  }));
  return [...new Map([...fromEnvironment, ...databaseItems].map((item) => [item.id, item])).values()];
}

export async function saveTenderSubscription(input: {
  id?: string;
  name: string;
  recipients: string[];
  filters?: SubscriptionFilters;
  presetId?: string | null;
  ownerAccountId?: string | null;
}, actor: string) {
  const sql = getAnalyticsSql();
  if (!sql) return null;
  const name = input.name.trim().slice(0, 120);
  const recipients = input.recipients.map((item) => item.trim().toLowerCase()).filter((item, index, all) => emailPattern.test(item) && all.indexOf(item) === index).slice(0, 20);
  if (!name || !recipients.length) throw new Error("Назва підписки та принаймні один коректний email обов'язкові");
  const id = input.id?.trim().slice(0, 80) || `subscription-${randomUUID()}`;
  const filters = input.filters && typeof input.filters === "object" && !Array.isArray(input.filters) ? input.filters : {};
  const rows = await sql`
    insert into analytics_tender_subscriptions (id, name, recipients, filters, preset_id, owner_account_id, created_by)
    values (${id}, ${name}, ${recipients}::text[], ${JSON.stringify(filters)}::jsonb,
      ${input.presetId ?? null}, ${input.ownerAccountId ?? null}, ${actor})
    on conflict (id) do update set name = excluded.name, recipients = excluded.recipients,
      filters = excluded.filters, preset_id = excluded.preset_id, owner_account_id = excluded.owner_account_id,
      active = true, updated_at = now()
    returning id, name, recipients, filters, preset_id, owner_account_id
  ` as unknown as Array<{
    id: string; name: string; recipients: string[]; filters: SubscriptionFilters;
    preset_id: string | null; owner_account_id: string | null;
  }>;
  const item = rows[0];
  return item ? {
    id: item.id, name: item.name, recipients: item.recipients, filters: item.filters,
    presetId: item.preset_id ?? undefined, ownerAccountId: item.owner_account_id ?? undefined,
  } satisfies TenderSubscription : null;
}

export async function disableTenderSubscription(id: string) {
  const sql = getAnalyticsSql();
  if (!sql) return false;
  const rows = await sql`
    update analytics_tender_subscriptions set active = false, updated_at = now()
    where id = ${id.trim().slice(0, 80)} returning id
  ` as unknown[];
  return rows.length > 0;
}

function iso(value: string | Date | null) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.valueOf()) ? date.toISOString() : null;
}

function integrationHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

let tokenCache: { token: string; expiresAt: number } | null = null;

async function writeToken(config: IntegrationCredentials) {
  if (tokenCache && tokenCache.expiresAt > Date.now()) return tokenCache.token;
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "client_credentials",
    scope: "https://graph.microsoft.com/.default",
  });
  const response = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`,
    { method: "POST", body, cache: "no-store", signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS) },
  );
  if (!response.ok) throw new Error(`Microsoft write token request failed (${response.status})`);
  const payload = await response.json() as { access_token?: string; expires_in?: number };
  if (!payload.access_token) throw new Error("Microsoft write token response has no access token");
  tokenCache = {
    token: payload.access_token,
    expiresAt: Date.now() + Math.max(60, payload.expires_in ?? 3_600) * 1_000 - 60_000,
  };
  return tokenCache.token;
}

async function graphWrite(pathname: string, token: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${GRAPH_ROOT}${pathname}`, {
    ...init,
    headers,
    cache: "no-store",
    redirect: "follow",
    signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Microsoft Graph write request failed (${response.status})`);
  return response;
}

async function state(streamKey: string): Promise<IntegrationState> {
  const sql = getAnalyticsSql();
  if (!sql) return { cursor: null, lastSuccessAt: null, lastError: "Database is not configured", metadata: {} };
  const rows = await sql`
    select cursor_value, last_success_at, last_error, metadata
    from analytics_sync_state where stream_key = ${streamKey} limit 1
  ` as StateRow[];
  const row = rows[0];
  return {
    cursor: row?.cursor_value ?? null,
    lastSuccessAt: iso(row?.last_success_at ?? null),
    lastError: row?.last_error ?? null,
    metadata: row?.metadata && typeof row.metadata === "object" ? row.metadata : {},
  };
}

async function acquireLease(streamKey: string) {
  const sql = getAnalyticsSql();
  if (!sql) return null;
  const token = randomUUID();
  const rows = await sql`
    insert into analytics_sync_state (stream_key, lease_token, lease_expires_at, last_started_at)
    values (${streamKey}, ${token}, now() + interval '10 minutes', now())
    on conflict (stream_key) do update set
      lease_token = excluded.lease_token,
      lease_expires_at = excluded.lease_expires_at,
      last_started_at = excluded.last_started_at,
      updated_at = now()
    where analytics_sync_state.lease_expires_at is null or analytics_sync_state.lease_expires_at < now()
    returning stream_key
  ` as Array<{ stream_key: string }>;
  return rows[0] ? token : null;
}

async function updateState(
  streamKey: string,
  leaseToken: string,
  options: { cursor?: string | null; metadata?: Record<string, unknown>; error?: string | null; success?: boolean },
) {
  const sql = getAnalyticsSql();
  if (!sql) return;
  const metadata = options.metadata ? JSON.stringify(options.metadata) : null;
  await sql`
    update analytics_sync_state set
      cursor_value = coalesce(${options.cursor ?? null}, cursor_value),
      metadata = coalesce(${metadata}::jsonb, metadata),
      last_error = ${options.error ?? null},
      failure_count = case when ${options.error ?? null}::text is null then failure_count else failure_count + 1 end,
      last_finished_at = now(),
      last_success_at = case when ${options.success ?? false} then now() else last_success_at end,
      lease_token = null,
      lease_expires_at = null,
      updated_at = now()
    where stream_key = ${streamKey} and lease_token = ${leaseToken}
  `;
}

async function resolvedFilters(subscription: TenderSubscription) {
  if (!subscription.presetId || !subscription.ownerAccountId) return subscription.filters;
  const sql = getAnalyticsSql();
  if (!sql) return subscription.filters;
  const rows = await sql`
    select filters from analytics_filter_presets
    where id = ${subscription.presetId} and owner_account_id = ${subscription.ownerAccountId}
    limit 1
  ` as Array<{ filters: Record<string, unknown> }>;
  return rows[0]?.filters ?? subscription.filters;
}

function normalizedNeedles(filters: SubscriptionFilters, plural: string, singular: string) {
  return stringArray(filters[plural] ?? filters[singular]).map((value) => value.toLocaleLowerCase("uk-UA"));
}

export function tenderMatchesFilters(event: TenderEvent, filters: SubscriptionFilters) {
  const includes = (source: string | null, values: string[]) => !values.length
    || values.some((value) => (source ?? "").toLocaleLowerCase("uk-UA").includes(value));
  const exact = (source: string | null, values: string[]) => !values.length
    || values.includes((source ?? "").toLocaleLowerCase("uk-UA"));
  const directions = normalizedNeedles(filters, "directions", "department");
  const cpvs = normalizedNeedles(filters, "cpvPrefixes", "cpv").map((value) => value.replace(/[^0-9]/g, ""));
  const buyers = normalizedNeedles(filters, "buyerIds", "buyer");
  const procedures = normalizedNeedles(filters, "procedureTypes", "procedure");
  const statuses = normalizedNeedles(filters, "statuses", "status");
  const regions = normalizedNeedles(filters, "regions", "region");
  const categories = normalizedNeedles(filters, "categories", "category");
  const query = String(filters.subjectQuery ?? filters.subject ?? "").trim().toLocaleLowerCase("uk-UA");
  return exact(event.department, directions)
    && (!cpvs.length || cpvs.some((prefix) => (event.cpvCode ?? "").replace(/[^0-9]/g, "").startsWith(prefix)))
    && (!buyers.length || buyers.some((buyer) => [event.buyerId, event.buyerName].some((value) => includes(value, [buyer]))))
    && exact(event.procedureType, procedures)
    && exact(event.status, statuses)
    && includes(event.region, regions)
    && exact(event.category, categories)
    && (!query || `${event.tenderId} ${event.title} ${event.buyerName ?? ""} ${event.cpvCode ?? ""}`.toLocaleLowerCase("uk-UA").includes(query));
}

async function changedTenders(since: string, filters: SubscriptionFilters) {
  const sql = getAnalyticsSql();
  if (!sql) return [];
  const limit = positiveInteger("TENDER_INTEGRATION_EVENT_LIMIT", DEFAULT_EVENT_LIMIT, MAX_EVENT_LIMIT);
  const rows = await sql`
    select p.id, p.tender_id, p.title, p.buyer_id, buyer.legal_name as buyer_name,
      p.department, p.cpv_code, p.procurement_method_type, p.status, p.main_category,
      p.expected_amount, p.expected_currency, p.published_at, p.source_modified_at,
      p.submission_end_at, p.prozorro_url,
      (select max(i.delivery_region) from analytics_items i where i.procurement_id = p.id) as region
    from analytics_procurements p
    left join analytics_organizations buyer on buyer.id = p.buyer_id
    where greatest(coalesce(p.source_modified_at, p.published_at), p.published_at) > ${since}::timestamptz
    order by greatest(coalesce(p.source_modified_at, p.published_at), p.published_at) asc, p.id asc
    limit ${limit}
  ` as Array<{
    id: string; tender_id: string; title: string; buyer_id: string | null; buyer_name: string | null;
    department: string | null; cpv_code: string | null; procurement_method_type: string | null;
    status: string | null; main_category: string | null; expected_amount: string | number | null;
    expected_currency: string | null; published_at: string | Date | null; source_modified_at: string | Date | null;
    submission_end_at: string | Date | null; prozorro_url: string; region: string | null;
  }>;
  return rows.map((row): TenderEvent => ({
    id: row.id,
    tenderId: row.tender_id,
    title: row.title,
    buyerId: row.buyer_id,
    buyerName: row.buyer_name,
    department: row.department,
    cpvCode: row.cpv_code,
    procedureType: row.procurement_method_type,
    status: row.status,
    category: row.main_category,
    region: row.region,
    expectedAmount: row.expected_amount == null ? null : Number(row.expected_amount),
    currency: row.expected_currency,
    publishedAt: iso(row.published_at),
    modifiedAt: iso(row.source_modified_at ?? row.published_at) ?? new Date(0).toISOString(),
    submissionEndAt: iso(row.submission_end_at),
    prozorroUrl: row.prozorro_url,
  })).filter((event) => tenderMatchesFilters(event, filters));
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}

function money(value: number | null, currency: string | null) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 }).format(value)} ${currency ?? ""}`.trim();
}

export function buildTenderDigest(subscription: Pick<TenderSubscription, "name">, events: TenderEvent[]) {
  const lines = events.map((event) => `${event.tenderId} — ${event.title} — ${money(event.expectedAmount, event.currency)} — ${event.prozorroUrl}`);
  const text = [`Нові та змінені закупівлі: ${subscription.name}`, `Знайдено: ${events.length}`, "", ...lines].join("\n");
  const rows = events.map((event) => `<tr><td>${escapeHtml(event.tenderId)}</td><td><a href="${escapeHtml(event.prozorroUrl)}">${escapeHtml(event.title)}</a></td><td>${escapeHtml(event.buyerName ?? "—")}</td><td>${escapeHtml(money(event.expectedAmount, event.currency))}</td><td>${escapeHtml(event.submissionEndAt?.slice(0, 16).replace("T", " ") ?? "—")}</td></tr>`).join("");
  const html = `<h2>${escapeHtml(subscription.name)}</h2><p>Нових або змінених закупівель: <strong>${events.length}</strong></p><table style="border-collapse:collapse;width:100%"><thead><tr><th>ID</th><th>Предмет</th><th>Замовник</th><th>Очікувана вартість</th><th>Кінцевий строк</th></tr></thead><tbody>${rows}</tbody></table>`;
  return { text, html };
}

async function sendMail(token: string, sender: string, subscription: TenderSubscription, events: TenderEvent[]) {
  const digest = buildTenderDigest(subscription, events);
  await graphWrite(`/users/${encodeURIComponent(sender)}/sendMail`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        subject: `[Тендери] ${subscription.name}: ${events.length}`,
        body: { contentType: "HTML", content: digest.html },
        toRecipients: subscription.recipients.map((address) => ({ emailAddress: { address } })),
      },
      saveToSentItems: false,
    }),
  });
}

async function processSubscription(config: IntegrationCredentials, subscription: TenderSubscription) {
  const streamKey = `${EMAIL_STREAM_PREFIX}${subscription.id}`;
  const lease = await acquireLease(streamKey);
  if (!lease) return { id: subscription.id, status: "deduplicated" as const, events: 0 };
  const previous = await state(streamKey);
  const fallback = new Date(Date.now() - DEFAULT_LOOKBACK_HOURS * 3_600_000).toISOString();
  try {
    const filters = await resolvedFilters(subscription);
    const events = await changedTenders(previous.cursor ?? fallback, filters);
    if (!events.length) {
      await updateState(streamKey, lease, { cursor: new Date().toISOString(), metadata: previous.metadata, success: true });
      return { id: subscription.id, status: "empty" as const, events: 0 };
    }
    const batchHash = integrationHash(events.map((event) => [event.id, event.modifiedAt]));
    if (previous.metadata.lastBatchHash === batchHash || previous.metadata.pendingBatchHash === batchHash) {
      await updateState(streamKey, lease, {
        cursor: events.at(-1)?.modifiedAt,
        metadata: { ...previous.metadata, lastBatchHash: batchHash, pendingBatchHash: null },
        success: true,
      });
      return { id: subscription.id, status: "deduplicated" as const, events: events.length };
    }
    const sql = getAnalyticsSql();
    if (sql) {
      await sql`update analytics_sync_state set metadata = ${JSON.stringify({ ...previous.metadata, pendingBatchHash: batchHash })}::jsonb, updated_at = now() where stream_key = ${streamKey} and lease_token = ${lease}`;
    }
    const token = await writeToken(config);
    await sendMail(token, trimmed("TENDER_NOTIFICATION_SENDER"), subscription, events);
    await updateState(streamKey, lease, {
      cursor: events.at(-1)?.modifiedAt,
      metadata: { ...previous.metadata, lastBatchHash: batchHash, pendingBatchHash: null, lastEventCount: events.length },
      success: true,
    });
    return { id: subscription.id, status: "sent" as const, events: events.length };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Unknown integration error";
    await updateState(streamKey, lease, { metadata: previous.metadata, error: message });
    throw error;
  }
}

type ExcelTenderRow = {
  tender_id: string;
  title: string;
  buyer_name: string | null;
  department: string | null;
  cpv_code: string | null;
  procurement_method_type: string | null;
  status: string | null;
  region: string | null;
  expected_amount: string | number | null;
  expected_currency: string | null;
  published_at: string | Date | null;
  submission_end_at: string | Date | null;
  source_modified_at: string | Date | null;
  prozorro_url: string;
};

async function exportRows() {
  const sql = getAnalyticsSql();
  if (!sql) return [];
  return await sql`
    with current_dataset as (
      select id from analytics_datasets where scope_mode = 'monitoring' and status = 'ready'
      order by generated_at desc limit 1
    )
    select p.tender_id, p.title, buyer.legal_name as buyer_name, p.department, p.cpv_code,
      p.procurement_method_type, p.status, p.expected_amount, p.expected_currency,
      p.published_at, p.submission_end_at, p.source_modified_at, p.prozorro_url,
      (select max(i.delivery_region) from analytics_items i where i.procurement_id = p.id) as region
    from analytics_procurements p
    join analytics_dataset_procurements dp on dp.procurement_id = p.id
    join current_dataset ds on ds.id = dp.dataset_id
    left join analytics_organizations buyer on buyer.id = p.buyer_id
    order by coalesce(p.submission_end_at, p.published_at) desc, p.tender_id asc
    limit 20000
  ` as ExcelTenderRow[];
}

export async function buildTenderWorkbook(source: Buffer, config: Pick<ExcelConfig, "worksheet" | "table">, rows: ExcelTenderRow[]) {
  const workbook = new ExcelJS.Workbook();
  if (source.length) await workbook.xlsx.load(source as unknown as ExcelJS.Buffer);
  let worksheet = workbook.getWorksheet(config.worksheet);
  if (!worksheet) worksheet = workbook.addWorksheet(config.worksheet);
  const existing = worksheet.getTable(config.table);
  if (existing) worksheet.removeTable(config.table);
  worksheet.eachRow({ includeEmpty: true }, (row) => { row.values = []; });
  const headers = ["ID закупівлі", "Предмет", "Замовник", "Напрямок", "ДК", "Процедура", "Статус", "Регіон", "Очікувана вартість", "Валюта", "Опубліковано", "Кінцевий строк", "Оновлено", "Посилання"];
  const values = rows.map((row) => [
    row.tender_id, row.title, row.buyer_name ?? "", row.department ?? "", row.cpv_code ?? "",
    row.procurement_method_type ?? "", row.status ?? "", row.region ?? "",
    row.expected_amount == null ? "" : Number(row.expected_amount), row.expected_currency ?? "",
    iso(row.published_at)?.slice(0, 16).replace("T", " ") ?? "",
    iso(row.submission_end_at)?.slice(0, 16).replace("T", " ") ?? "",
    iso(row.source_modified_at)?.slice(0, 16).replace("T", " ") ?? "", row.prozorro_url,
  ]);
  worksheet.addTable({
    name: config.table,
    ref: "A1",
    headerRow: true,
    totalsRow: false,
    style: { theme: "TableStyleMedium2", showRowStripes: true },
    columns: headers.map((name) => ({ name, filterButton: true })),
    rows: values,
  });
  worksheet.views = [{ state: "frozen", ySplit: 1 }];
  const widths = [24, 60, 38, 22, 16, 24, 20, 22, 20, 12, 20, 20, 20, 56];
  widths.forEach((width, index) => { worksheet!.getColumn(index + 1).width = width; });
  const output = await workbook.xlsx.writeBuffer();
  return Buffer.from(output);
}

async function syncExcel(config: IntegrationCredentials, target: ExcelConfig) {
  const lease = await acquireLease(EXCEL_STREAM_KEY);
  if (!lease) return { status: "unchanged" as const, rows: 0 };
  const previous = await state(EXCEL_STREAM_KEY);
  try {
    const rows = await exportRows();
    const fingerprint = integrationHash(rows.map((row) => [row.tender_id, iso(row.source_modified_at), row.status, row.expected_amount]));
    if (previous.metadata.fingerprint === fingerprint) {
      await updateState(EXCEL_STREAM_KEY, lease, { metadata: previous.metadata, success: true });
      return { status: "unchanged" as const, rows: rows.length };
    }
    const token = await writeToken(config);
    const base = `/sites/${encodeURIComponent(target.siteId)}/drives/${encodeURIComponent(target.driveId)}/items/${encodeURIComponent(target.itemId)}`;
    const current = await graphWrite(`${base}/content`, token);
    const workbook = await buildTenderWorkbook(Buffer.from(await current.arrayBuffer()), target, rows);
    await graphWrite(`${base}/content`, token, {
      method: "PUT",
      headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
      body: workbook,
    });
    await updateState(EXCEL_STREAM_KEY, lease, {
      metadata: { fingerprint, rowCount: rows.length, updatedAt: new Date().toISOString() },
      success: true,
    });
    return { status: "updated" as const, rows: rows.length };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Unknown Excel integration error";
    await updateState(EXCEL_STREAM_KEY, lease, { metadata: previous.metadata, error: message });
    throw error;
  }
}

export async function tenderIntegrationStatus(): Promise<TenderIntegrationStatus> {
  const write = credentials();
  const subscriptions = await loadTenderSubscriptions();
  const sender = trimmed("TENDER_NOTIFICATION_SENDER");
  const excel = excelConfig();
  const database = Boolean(getAnalyticsSql());
  const [emailStates, excelState] = await Promise.all([
    Promise.all(subscriptions.map((item) => state(`${EMAIL_STREAM_PREFIX}${item.id}`))),
    state(EXCEL_STREAM_KEY),
  ]);
  const emailError = emailStates.find((item) => item.lastError)?.lastError ?? null;
  const emailSuccess = emailStates.map((item) => item.lastSuccessAt).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
  const credentialReason = write ? null : "Окремі Microsoft Graph write credentials не налаштовані";
  return {
    configured: Boolean(write && database && ((subscriptions.length && sender) || excel)),
    database,
    email: {
      enabled: Boolean(write && database && sender && subscriptions.length),
      reason: credentialReason ?? (!database ? "DATABASE_URL не налаштовано" : !sender ? "Не вказано адресу відправника" : !subscriptions.length ? "Немає підписок" : null),
      subscriptions: subscriptions.length,
      lastSuccessAt: emailSuccess,
      lastError: emailError,
    },
    excel: {
      enabled: Boolean(write && database && excel),
      reason: credentialReason ?? (!database ? "DATABASE_URL не налаштовано" : !excel ? "Не вказано окремий Excel-файл для експорту" : null),
      lastSuccessAt: excelState.lastSuccessAt,
      lastError: excelState.lastError,
    },
    subscriptionItems: subscriptions,
  };
}

export async function runTenderIntegrations(options: { email?: boolean; excel?: boolean } = {}): Promise<IntegrationRunResult> {
  const runEmail = options.email ?? true;
  const runExcel = options.excel ?? true;
  const write = credentials();
  const subscriptions = await loadTenderSubscriptions();
  const sender = trimmed("TENDER_NOTIFICATION_SENDER");
  const target = excelConfig();
  const email = !runEmail || !write || !sender || !getAnalyticsSql()
    ? subscriptions.map((item) => ({ id: item.id, status: "disabled" as const, events: 0 }))
    : await Promise.all(subscriptions.map((item) => processSubscription(write, item)));
  const excel = !runExcel || !write || !target || !getAnalyticsSql()
    ? { status: "disabled" as const, rows: 0 }
    : await syncExcel(write, target);
  return { ok: true, email, excel };
}

export async function sendTenderIntegrationTest() {
  const write = credentials();
  const sender = trimmed("TENDER_NOTIFICATION_SENDER");
  const subscription = (await loadTenderSubscriptions())[0];
  if (!write || !sender || !subscription) throw new Error("Email integration is not configured");
  const token = await writeToken(write);
  await graphWrite(`/users/${encodeURIComponent(sender)}/sendMail`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        subject: "[Тендери] Перевірка інтеграції",
        body: { contentType: "Text", content: "Сповіщення налаштовані коректно. Це тестовий лист без даних закупівель." },
        toRecipients: subscription.recipients.map((address) => ({ emailAddress: { address } })),
      },
      saveToSentItems: false,
    }),
  });
  return { ok: true, subscriptionId: subscription.id };
}
