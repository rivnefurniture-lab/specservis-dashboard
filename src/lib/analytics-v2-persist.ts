import "server-only";

import { getAnalyticsSql } from "@/lib/analytics-v2-db";
import type { CanonicalParty, Money, ProzorroAnalyticsDataset, SourcedValue } from "@/lib/analytics-v2-schema";

export type PersistAnalyticsV2Options = {
  datasetId: string;
  scope: "monitoring" | "expanded";
  sourceName: string;
  filters?: Record<string, unknown>;
  directions?: Record<string, string | null>;
  /** Replace the complete dataset membership. Incremental synchronizers must set this to false. */
  replaceMembership?: boolean;
};

type DatasetStatusRow = { status: "building" | "ready" | "failed" };
type CoverageRow = { procurements: number | string };

const value = <T>(field: SourcedValue<T>) => field.sourceState === "value" || field.sourceState === "derived" ? field.value : null;
const money = (field: SourcedValue<Money>) => value(field);
const json = (input: unknown) => JSON.stringify(input ?? null);

function partyId(party: CanonicalParty) {
  const identifier = party.identifier.id?.trim();
  const scheme = party.identifier.scheme?.trim().toUpperCase();
  return identifier ? `${scheme || "ID"}:${identifier}` : party.id;
}

function partyName(party: CanonicalParty) {
  return party.identifier.legalName?.trim() || party.name.trim() || party.identifier.id || party.id;
}

function completion(status: string | null, details: string | null) {
  if (status === "active") return "active";
  if (status !== "terminated") return status === "cancelled" ? "cancelled" : "unknown";
  if (!details) return "unknown";
  return /виконан|completed|performed/i.test(details) ? "completed" : "terminated_with_reason";
}

export async function persistAnalyticsV2(dataset: ProzorroAnalyticsDataset, options: PersistAnalyticsV2Options) {
  const sql = getAnalyticsSql();
  if (!sql) throw new Error("DATABASE_URL is required");
  const now = new Date().toISOString();
  const existingRows = await sql`select status from analytics_datasets where id = ${options.datasetId}` as unknown as DatasetStatusRow[];
  const hadReadyDataset = existingRows[0]?.status === "ready";
  await sql`
    insert into analytics_datasets (id, scope_mode, filter_definition, generated_at, source_updated_at, source_name, status, coverage, updated_at)
    values (${options.datasetId}, ${options.scope}, ${json(options.filters ?? {})}::jsonb, ${dataset.importedAt}, ${dataset.importedAt},
      ${options.sourceName}, 'building', ${json({ procurements: dataset.procurements.length, warnings: dataset.warnings.length })}::jsonb, ${now})
    on conflict (id) do update set scope_mode = excluded.scope_mode, filter_definition = excluded.filter_definition,
      source_name = excluded.source_name,
      status = case when analytics_datasets.status = 'ready' then 'ready' else 'building' end,
      updated_at = excluded.updated_at
  `;

  try {
    const parties = new Map<string, CanonicalParty>();
    for (const procurement of dataset.procurements) {
      const buyer = value(procurement.buyer);
      if (buyer) parties.set(partyId(buyer), buyer);
    }
    for (const bid of dataset.bids) for (const party of bid.tenderers) parties.set(partyId(party), party);
    for (const award of dataset.awards) for (const party of award.suppliers) parties.set(partyId(party), party);
    for (const contract of dataset.contracts) for (const party of contract.suppliers) parties.set(partyId(party), party);
    for (const [id, party] of parties) {
      await sql`
        insert into analytics_organizations (id, scheme, identifier, legal_name, normalized_name, source)
        values (${id}, ${party.identifier.scheme}, ${party.identifier.id}, ${partyName(party)}, ${partyName(party).toLocaleUpperCase("uk-UA")}, ${json(party)}::jsonb)
        on conflict (id) do update set scheme = excluded.scheme, identifier = excluded.identifier,
          legal_name = excluded.legal_name, normalized_name = excluded.normalized_name, source = excluded.source
      `;
    }

    for (const procurement of dataset.procurements) {
      const buyer = value(procurement.buyer);
      if (!buyer) continue;
      const expected = money(procurement.value);
      const guarantee = money(procurement.guarantee);
      const tenderPeriod = value(procurement.tenderPeriod);
      const auctionPeriod = value(procurement.auctionPeriod);
      const firstItem = dataset.items.find((item) => item.procurementId === procurement.id);
      const cpv = firstItem ? value(firstItem.classification)?.id ?? null : null;
      await sql`
        insert into analytics_procurements (id, tender_id, title, description, buyer_id, procurement_method,
          procurement_method_type, main_category, status, cpv_code, department, relevance, published_at,
          expected_amount, expected_currency, expected_vat_included, submission_start_at, submission_end_at,
          auction_start_at, auction_end_at, guarantee_amount, guarantee_currency, payment_terms,
          prozorro_url, source_modified_at, source)
        values (${procurement.id}, ${procurement.tenderId}, ${value(procurement.title) ?? procurement.tenderId}, ${value(procurement.description)},
          ${partyId(buyer)}, ${value(procurement.procurementMethod)}, ${value(procurement.procurementMethodType)},
          ${value(procurement.mainProcurementCategory)}, ${value(procurement.status)}, ${cpv}, ${options.directions?.[procurement.id] ?? null},
          ${json({ scope: options.scope })}::jsonb, ${value(procurement.datePublished)}, ${expected?.amount ?? null}, ${expected?.currency ?? null},
          ${expected?.valueAddedTaxIncluded ?? null}, ${tenderPeriod?.startDate ?? null}, ${tenderPeriod?.endDate ?? null},
          ${auctionPeriod?.startDate ?? null}, ${auctionPeriod?.endDate ?? null}, ${guarantee?.amount ?? null}, ${guarantee?.currency ?? null},
          ${json(value(procurement.paymentTerms) ?? [])}::jsonb, ${`https://prozorro.gov.ua/tender/${encodeURIComponent(procurement.tenderId)}`},
          ${value(procurement.dateModified)}, ${json(procurement.provenance)}::jsonb)
        on conflict (id) do update set tender_id = excluded.tender_id, title = excluded.title, description = excluded.description,
          buyer_id = excluded.buyer_id, procurement_method = excluded.procurement_method,
          procurement_method_type = excluded.procurement_method_type, main_category = excluded.main_category,
          status = excluded.status, cpv_code = excluded.cpv_code, department = coalesce(excluded.department, analytics_procurements.department),
          published_at = excluded.published_at, expected_amount = excluded.expected_amount, expected_currency = excluded.expected_currency,
          expected_vat_included = excluded.expected_vat_included, submission_start_at = excluded.submission_start_at,
          submission_end_at = excluded.submission_end_at, auction_start_at = excluded.auction_start_at,
          auction_end_at = excluded.auction_end_at, guarantee_amount = excluded.guarantee_amount,
          guarantee_currency = excluded.guarantee_currency, payment_terms = excluded.payment_terms,
          prozorro_url = excluded.prozorro_url,
          source_modified_at = excluded.source_modified_at, source = excluded.source
      `;
      await sql`insert into analytics_dataset_procurements (dataset_id, procurement_id) values (${options.datasetId}, ${procurement.id}) on conflict do nothing`;
    }

    for (const lot of dataset.lots) {
      const expected = money(lot.value);
      await sql`
        insert into analytics_lots (id, procurement_id, source_lot_id, title, description, status, expected_amount,
          expected_currency, expected_vat_included, is_synthetic_root, source)
        values (${lot.id}, ${lot.procurementId}, ${lot.sourceLotId}, ${value(lot.title)}, ${value(lot.description)}, ${value(lot.status)},
          ${expected?.amount ?? null}, ${expected?.currency ?? null}, ${expected?.valueAddedTaxIncluded ?? null}, ${lot.kind === "root-lot"}, ${json(lot.provenance)}::jsonb)
        on conflict (id) do update set title = excluded.title, description = excluded.description, status = excluded.status,
          expected_amount = excluded.expected_amount, expected_currency = excluded.expected_currency,
          expected_vat_included = excluded.expected_vat_included, source = excluded.source
      `;
    }

    for (const item of dataset.items) {
      const address = value(item.deliveryAddress);
      const deliveryDate = value(item.deliveryDate);
      const classification = value(item.classification);
      const deliveryText = address ? [address.postalCode, address.region, address.locality, address.streetAddress].filter(Boolean).join(", ") : null;
      await sql`
        insert into analytics_items (id, procurement_id, lot_id, description, cpv_code, quantity, unit_code,
          delivery_start_at, delivery_end_at, delivery_address, delivery_region, delivery_locality, delivery_text, source)
        values (${item.id}, ${item.procurementId}, ${item.lotId}, ${value(item.description)}, ${classification?.id ?? null},
          ${value(item.quantity)}, ${value(item.unitCode)}, ${deliveryDate?.startDate ?? null}, ${deliveryDate?.endDate ?? null},
          ${json(address)}::jsonb, ${address?.region ?? null},
          ${address?.locality ?? null}, ${deliveryText}, ${json(item.provenance)}::jsonb)
        on conflict (id) do update set lot_id = excluded.lot_id, description = excluded.description, cpv_code = excluded.cpv_code,
          quantity = excluded.quantity, unit_code = excluded.unit_code, delivery_start_at = excluded.delivery_start_at,
          delivery_end_at = excluded.delivery_end_at, delivery_address = excluded.delivery_address,
          delivery_region = excluded.delivery_region, delivery_locality = excluded.delivery_locality,
          delivery_text = excluded.delivery_text, source = excluded.source
      `;
    }

    const bidIds = new Map<string, string>();
    for (const bid of dataset.bids) {
      const lotIds = bid.lotIds.length ? bid.lotIds : dataset.lots.filter((lot) => lot.procurementId === bid.procurementId && lot.kind === "root-lot").map((lot) => lot.id);
      for (const party of bid.tenderers) for (const lotId of lotIds) {
        const id = `${bid.id}:${partyId(party)}:${lotId}`;
        bidIds.set(`${bid.id}\u0000${partyId(party)}\u0000${lotId}`, id);
        const bidMoney = money(bid.lotValues.find((entry) => entry.lotId === lotId)?.value ?? bid.value);
        await sql`
          insert into analytics_bids (id, procurement_id, lot_id, source_bid_id, supplier_id, status, value_at,
            latest_amount, currency, vat_included, is_published, source)
          values (${id}, ${bid.procurementId}, ${lotId}, ${bid.sourceBidId}, ${partyId(party)}, ${value(bid.status)}, ${value(bid.date)},
            ${bidMoney?.amount ?? null}, ${bidMoney?.currency ?? null}, ${bidMoney?.valueAddedTaxIncluded ?? null}, true, ${json(bid.provenance)}::jsonb)
          on conflict (id) do update set status = excluded.status, value_at = excluded.value_at,
            latest_amount = excluded.latest_amount, currency = excluded.currency, vat_included = excluded.vat_included, source = excluded.source
        `;
      }
    }

    const persistedAwardIds = new Set<string>();
    for (const award of dataset.awards) {
      const supplier = award.suppliers[0];
      if (!supplier || !award.lotId) continue;
      const awardMoney = money(award.value);
      const bidId = award.bidId ? bidIds.get(`${award.bidId}\u0000${partyId(supplier)}\u0000${award.lotId}`) ?? null : null;
      await sql`
        insert into analytics_awards (id, procurement_id, lot_id, source_award_id, bid_id, supplier_id, status,
          decision_at, amount, currency, vat_included, qualified, eligible, reason_description, source)
        values (${award.id}, ${award.procurementId}, ${award.lotId}, ${award.sourceAwardId}, ${bidId}, ${partyId(supplier)},
          ${value(award.status) ?? "unknown"}, ${value(award.date)}, ${awardMoney?.amount ?? null}, ${awardMoney?.currency ?? null},
          ${awardMoney?.valueAddedTaxIncluded ?? null}, ${value(award.qualified)}, ${value(award.eligible)},
          ${value(award.disqualificationReason)}, ${json(award.provenance)}::jsonb)
        on conflict (id) do update set bid_id = excluded.bid_id, supplier_id = excluded.supplier_id, status = excluded.status,
          decision_at = excluded.decision_at, amount = excluded.amount, currency = excluded.currency,
          qualified = excluded.qualified, eligible = excluded.eligible, reason_description = excluded.reason_description, source = excluded.source
      `;
      persistedAwardIds.add(award.id);
    }

    for (const contract of dataset.contracts) {
      const supplier = contract.suppliers[0];
      const procurement = dataset.procurements.find((item) => item.id === contract.procurementId);
      const buyer = procurement ? value(procurement.buyer) : null;
      if (!supplier || !buyer) continue;
      const current = money(contract.value);
      const paid = money(contract.amountPaid);
      const status = value(contract.status) ?? "unknown";
      const details = value(contract.terminationDetails);
      await sql`
        insert into analytics_contracts (id, procurement_id, lot_id, award_id, source_contract_id, contract_number,
          supplier_id, buyer_id, status, signed_at, initial_amount, current_amount, amount_paid, currency,
          vat_included, termination_details, completion_class, source_modified_at, source)
        values (${contract.id}, ${contract.procurementId}, ${contract.lotId}, ${contract.awardId && persistedAwardIds.has(contract.awardId) ? contract.awardId : null}, ${contract.sourceContractId},
          ${value(contract.contractNumber)}, ${partyId(supplier)}, ${partyId(buyer)}, ${status}, ${value(contract.dateSigned)},
          ${contract.changeIds.length === 0 ? current?.amount ?? null : null}, ${current?.amount ?? null}, ${paid?.amount ?? null}, ${current?.currency ?? paid?.currency ?? null},
          ${current?.valueAddedTaxIncluded ?? null}, ${details}, ${completion(status, details)}, ${dataset.importedAt}, ${json(contract.provenance)}::jsonb)
        on conflict (id) do update set lot_id = excluded.lot_id, award_id = excluded.award_id,
          contract_number = excluded.contract_number, supplier_id = excluded.supplier_id, buyer_id = excluded.buyer_id,
          status = excluded.status, signed_at = excluded.signed_at,
          initial_amount = coalesce(analytics_contracts.initial_amount, excluded.initial_amount), current_amount = excluded.current_amount,
          amount_paid = excluded.amount_paid, currency = excluded.currency, vat_included = excluded.vat_included,
          termination_details = excluded.termination_details, completion_class = excluded.completion_class,
          source_modified_at = excluded.source_modified_at, source = excluded.source
      `;
    }

    for (const change of dataset.changes) {
      await sql`
        insert into analytics_contract_changes (id, contract_id, source_change_id, changed_at, signed_at, rationale, rationale_types, status, source)
        values (${change.id}, ${change.contractId}, ${change.sourceChangeId}, ${value(change.date)}, ${value(change.dateSigned)},
          ${value(change.rationale)}, ${change.rationaleTypes}::text[], ${value(change.status)}, ${json(change.provenance)}::jsonb)
        on conflict (id) do update set changed_at = excluded.changed_at, signed_at = excluded.signed_at,
          rationale = excluded.rationale, rationale_types = excluded.rationale_types, status = excluded.status, source = excluded.source
      `;
    }

    if (options.replaceMembership !== false) {
      const procurementIds = dataset.procurements.map((procurement) => procurement.id);
      if (procurementIds.length) {
        await sql`
          delete from analytics_dataset_procurements
          where dataset_id = ${options.datasetId} and not (procurement_id = any(${procurementIds}::text[]))
        `;
      } else {
        await sql`delete from analytics_dataset_procurements where dataset_id = ${options.datasetId}`;
      }
    }
    const coverageRows = await sql`
      select count(*)::integer as procurements from analytics_dataset_procurements where dataset_id = ${options.datasetId}
    ` as unknown as CoverageRow[];
    const totalProcurements = Number(coverageRows[0]?.procurements ?? 0);
    await sql`
      update analytics_datasets set status = 'ready', failure_count = 0, generated_at = ${dataset.importedAt},
        source_updated_at = ${dataset.importedAt}, coverage = ${json({ procurements: totalProcurements, warnings: dataset.warnings.length })}::jsonb,
        updated_at = ${new Date().toISOString()} where id = ${options.datasetId}
    `;
    return { procurements: dataset.procurements.length, totalProcurements, warnings: dataset.warnings.length };
  } catch (error) {
    await sql`
      update analytics_datasets set status = ${hadReadyDataset ? "ready" : "failed"}, failure_count = failure_count + 1,
        updated_at = ${new Date().toISOString()} where id = ${options.datasetId}
    `;
    throw error;
  }
}
