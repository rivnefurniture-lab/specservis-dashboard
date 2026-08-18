import "server-only";

import { getAnalyticsSql } from "@/lib/analytics-v2-db";
import type { AnalyticsDateLens, AnalyticsV2Filters, AnalyticsV2Input } from "@/lib/analytics-v2-engine";

type ProcurementRow = {
  id: string;
  tender_id: string;
  prozorro_url: string;
  title: string;
  description: string | null;
  published_at: string | null;
  buyer_id: string | null;
  buyer_name: string | null;
  procurement_method: string | null;
  procurement_method_type: string | null;
  main_category: string | null;
  status: string | null;
  department: string | null;
  cpv_code: string | null;
  expected_amount: number | string | null;
  expected_currency: string | null;
  region: string | null;
  delivery_address: string | null;
  our_status: string | null;
};
type DatasetRow = { id: string; generated_at: string | Date; source_name: string };
type LotRow = { id: string; procurement_id: string; title: string | null; expected_amount: number | string | null; expected_currency: string | null };
type BidRow = { id: string; lot_id: string; supplier_id: string; supplier_name: string; status: string | null; value_at: string | null; latest_amount: number | string | null; currency: string | null };
type AwardRow = { id: string; lot_id: string; bid_id: string | null; supplier_id: string; supplier_name: string; status: string; decision_at: string | null; amount: number | string | null; currency: string | null; reason_title: string | null; reason_description: string | null };
type ContractRow = {
  id: string;
  procurement_id: string;
  lot_id: string | null;
  supplier_id: string;
  supplier_name: string;
  buyer_id: string | null;
  buyer_name: string | null;
  status: string;
  contract_number: string | null;
  has_changes: boolean;
  signed_at: string | null;
  source_modified_at: string | null;
  completion_class: string | null;
  initial_amount: number | string | null;
  current_amount: number | string | null;
  amount_paid: number | string | null;
  currency: string | null;
};

const stringDate = (value: string | Date | null) => value instanceof Date ? value.toISOString() : value;
const requiredDate = (value: string | Date) => value instanceof Date ? value.toISOString() : new Date(value).toISOString();
const amount = (value: string | number | null) => value == null || !Number.isFinite(Number(value)) ? null : Number(value);

async function procurementRows(lens: AnalyticsDateLens, filters: AnalyticsV2Filters, datasetId: string) {
  const sql = getAnalyticsSql();
  if (!sql) return null;
  const from = filters.from || null;
  const to = filters.to || null;
  const directions = filters.directions?.length ? filters.directions : null;
  if (lens === "award") {
    return await sql`
      select distinct p.id, p.tender_id, p.prozorro_url, p.title, p.description, p.published_at,
        p.buyer_id, buyer.legal_name as buyer_name, p.procurement_method, p.procurement_method_type,
        p.main_category, p.status, p.department, p.cpv_code, p.expected_amount, p.expected_currency,
        (select max(i.delivery_region) from analytics_items i where i.procurement_id = p.id) as region,
        (select string_agg(distinct i.delivery_text, ' | ') from analytics_items i where i.procurement_id = p.id) as delivery_address,
        own.status as our_status
      from analytics_procurements p
      join analytics_dataset_procurements dp on dp.procurement_id = p.id and dp.dataset_id = ${datasetId}
      join analytics_lots l on l.procurement_id = p.id
      join analytics_awards a on a.lot_id = l.id
      left join analytics_organizations buyer on buyer.id = p.buyer_id
      left join analytics_our_status own on own.procurement_id = p.id
      where (${from}::date is null or a.decision_at >= ${from}::date)
        and (${to}::date is null or a.decision_at < ${to}::date + interval '1 day')
        and (${directions}::text[] is null or p.department = any(${directions}::text[]))
    ` as ProcurementRow[];
  }
  if (lens === "contract") {
    return await sql`
      select distinct p.id, p.tender_id, p.prozorro_url, p.title, p.description, p.published_at,
        p.buyer_id, buyer.legal_name as buyer_name, p.procurement_method, p.procurement_method_type,
        p.main_category, p.status, p.department, p.cpv_code, p.expected_amount, p.expected_currency,
        (select max(i.delivery_region) from analytics_items i where i.procurement_id = p.id) as region,
        (select string_agg(distinct i.delivery_text, ' | ') from analytics_items i where i.procurement_id = p.id) as delivery_address,
        own.status as our_status
      from analytics_procurements p
      join analytics_dataset_procurements dp on dp.procurement_id = p.id and dp.dataset_id = ${datasetId}
      join analytics_contracts c on c.procurement_id = p.id
      left join analytics_organizations buyer on buyer.id = p.buyer_id
      left join analytics_our_status own on own.procurement_id = p.id
      where (${from}::date is null or c.signed_at >= ${from}::date)
        and (${to}::date is null or c.signed_at < ${to}::date + interval '1 day')
        and (${directions}::text[] is null or p.department = any(${directions}::text[]))
    ` as ProcurementRow[];
  }
  return await sql`
    select p.id, p.tender_id, p.prozorro_url, p.title, p.description, p.published_at,
      p.buyer_id, buyer.legal_name as buyer_name, p.procurement_method, p.procurement_method_type,
      p.main_category, p.status, p.department, p.cpv_code, p.expected_amount, p.expected_currency,
      (select max(i.delivery_region) from analytics_items i where i.procurement_id = p.id) as region,
      (select string_agg(distinct i.delivery_text, ' | ') from analytics_items i where i.procurement_id = p.id) as delivery_address,
      own.status as our_status
    from analytics_procurements p
    join analytics_dataset_procurements dp on dp.procurement_id = p.id and dp.dataset_id = ${datasetId}
    left join analytics_organizations buyer on buyer.id = p.buyer_id
    left join analytics_our_status own on own.procurement_id = p.id
    where (${from}::date is null or p.published_at >= ${from}::date)
      and (${to}::date is null or p.published_at < ${to}::date + interval '1 day')
      and (${directions}::text[] is null or p.department = any(${directions}::text[]))
  ` as ProcurementRow[];
}

export async function loadAnalyticsV2Input(filters: AnalyticsV2Filters): Promise<{
  input: AnalyticsV2Input;
  generatedAt: string;
  sourceName: string;
} | null> {
  const sql = getAnalyticsSql();
  if (!sql) return null;
  const datasetRows = filters.datasetId
    ? await sql`
        select id, generated_at, source_name from analytics_datasets
        where id = ${filters.datasetId} and scope_mode = ${filters.scope ?? "monitoring"} and status = 'ready'
        limit 1
      ` as unknown as DatasetRow[]
    : await sql`
        select id, generated_at, source_name from analytics_datasets
        where scope_mode = ${filters.scope ?? "monitoring"} and status = 'ready'
        order by generated_at desc limit 1
      ` as unknown as DatasetRow[];
  const dataset = datasetRows[0];
  if (!dataset) return null;
  const rows = await procurementRows(filters.dateLens ?? "publication", filters, dataset.id);
  const empty: AnalyticsV2Input = { tenders: [], lots: [], bids: [], awards: [], contracts: [] };
  if (!rows?.length) return { input: empty, generatedAt: requiredDate(dataset.generated_at), sourceName: dataset.source_name };
  const procurementIds = rows.map((row) => row.id);
  const [lotRecords, bidRecords, awardRecords, contractRecords] = await Promise.all([
    sql`select id, procurement_id, title, expected_amount, expected_currency from analytics_lots where procurement_id = any(${procurementIds}::text[])`,
    sql`select b.id, b.lot_id, b.supplier_id, supplier.legal_name as supplier_name, b.status, b.value_at, b.latest_amount, b.currency
        from analytics_bids b join analytics_organizations supplier on supplier.id = b.supplier_id
        join analytics_lots l on l.id = b.lot_id where l.procurement_id = any(${procurementIds}::text[]) and b.is_published = true`,
    sql`select a.id, a.lot_id, a.bid_id, a.supplier_id, supplier.legal_name as supplier_name, a.status,
        a.decision_at, a.amount, a.currency, a.reason_title, a.reason_description
        from analytics_awards a join analytics_organizations supplier on supplier.id = a.supplier_id
        where a.procurement_id = any(${procurementIds}::text[])`,
    sql`select c.id, c.procurement_id, c.lot_id, c.supplier_id, supplier.legal_name as supplier_name,
        c.buyer_id, buyer.legal_name as buyer_name, c.status, c.contract_number, c.signed_at, c.source_modified_at,
        exists(select 1 from analytics_contract_changes ch where ch.contract_id = c.id) as has_changes,
        c.completion_class, c.initial_amount, c.current_amount, c.amount_paid, c.currency
        from analytics_contracts c join analytics_organizations supplier on supplier.id = c.supplier_id
        left join analytics_organizations buyer on buyer.id = c.buyer_id
        where c.procurement_id = any(${procurementIds}::text[])`,
  ]);
  const lotRows = lotRecords as unknown as LotRow[];
  const bidRows = bidRecords as unknown as BidRow[];
  const awardRows = awardRecords as unknown as AwardRow[];
  const contractRows = contractRecords as unknown as ContractRow[];
  const input: AnalyticsV2Input = {
    tenders: rows.map((row) => ({
      id: row.id,
      externalTenderId: row.tender_id,
      prozorroUrl: row.prozorro_url,
      title: row.title,
      description: row.description,
      publishedAt: stringDate(row.published_at),
      buyerId: row.buyer_id ?? `buyer:${row.id}`,
      buyerName: row.buyer_name ?? "Замовника не вказано",
      procedureType: row.procurement_method_type ?? row.procurement_method ?? "unknown",
      status: row.status,
      category: row.main_category,
      region: row.region,
      deliveryAddress: row.delivery_address,
      expectedAmount: amount(row.expected_amount),
      expectedCurrency: row.expected_currency,
      ourStatus: row.our_status,
      awardDataComplete: true,
      direct: /reporting|negotiation/i.test(`${row.procurement_method_type ?? ""} ${row.procurement_method ?? ""}`),
      direction: row.department,
      cpv: row.cpv_code,
    })),
    lots: lotRows.map((row) => ({
      id: row.id,
      tenderId: row.procurement_id,
      title: row.title,
      expectedAmount: amount(row.expected_amount),
      expectedCurrency: row.expected_currency,
    })),
    bids: bidRows.map((row) => ({
      id: row.id,
      lotId: row.lot_id,
      supplierId: row.supplier_id,
      supplierName: row.supplier_name,
      status: row.status,
      publishedAt: stringDate(row.value_at),
      amount: amount(row.latest_amount),
      currency: row.currency ?? "UNKNOWN",
    })),
    awards: awardRows.map((row) => ({
      id: row.id,
      lotId: row.lot_id,
      supplierId: row.supplier_id,
      supplierName: row.supplier_name,
      bidId: row.bid_id,
      rejectionReason: [row.reason_title, row.reason_description].filter(Boolean).join(": ") || null,
      status: row.status,
      date: stringDate(row.decision_at),
      amount: amount(row.amount),
      currency: row.currency ?? "UNKNOWN",
    })),
    contracts: contractRows.map((row) => ({
      id: row.id,
      tenderId: row.procurement_id,
      lotId: row.lot_id,
      supplierId: row.supplier_id,
      supplierName: row.supplier_name,
      buyerId: row.buyer_id,
      buyerName: row.buyer_name,
      status: row.status,
      contractNumber: row.contract_number,
      hasChanges: row.has_changes,
      signedAt: stringDate(row.signed_at),
      updatedAt: stringDate(row.source_modified_at),
      terminationType: row.completion_class === "completed" ? "completed" : row.completion_class === "terminated_with_reason" ? "terminated" : null,
      originalAmount: amount(row.initial_amount),
      currentAmount: amount(row.current_amount),
      paidAmount: amount(row.amount_paid),
      currency: row.currency ?? "UNKNOWN",
    })),
  };
  return { input, generatedAt: requiredDate(dataset.generated_at), sourceName: dataset.source_name };
}
