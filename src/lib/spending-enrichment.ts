import "server-only";

import { getAnalyticsSql } from "@/lib/analytics-v2-db";
import type { CanonicalParty, ProzorroAnalyticsDataset, SourcedValue } from "@/lib/analytics-v2-schema";
import { fetchSpendingTransactions, matchSpendingTransaction, summarizeConfirmedPayments } from "@/lib/spending-payments";

const sourced = <T>(field: SourcedValue<T>) => field.sourceState === "value" || field.sourceState === "derived" ? field.value : null;
const canonicalIdentifier = (party: CanonicalParty) => party.identifier.id?.trim() ?? "";

/** Only confirmed matches affect `amount_paid`; probable matches are audit-only. */
export async function enrichSpendingPayments(dataset: ProzorroAnalyticsDataset) {
  const sql = getAnalyticsSql();
  if (!sql) throw new Error("DATABASE_URL is required");
  let confirmed = 0;
  let probable = 0;
  const failures: string[] = [];
  const today = new Date().toISOString().slice(0, 10);

  for (const contract of dataset.contracts) {
    const procurement = dataset.procurements.find((item) => item.id === contract.procurementId);
    const buyer = procurement ? sourced(procurement.buyer) : null;
    const supplier = contract.suppliers[0];
    const signedAt = sourced(contract.dateSigned);
    const buyerIdentifier = buyer ? canonicalIdentifier(buyer) : "";
    const supplierIdentifier = supplier ? canonicalIdentifier(supplier) : "";
    if (!procurement || !buyerIdentifier || !supplierIdentifier || !signedAt) continue;
    try {
      const transactions = await fetchSpendingTransactions(buyerIdentifier, supplierIdentifier, signedAt.slice(0, 10), today);
      const matches = transactions.map((transaction) => matchSpendingTransaction(transaction, {
        tenderId: procurement.tenderId,
        contractNumber: sourced(contract.contractNumber),
        signedAt,
        buyerIdentifier,
        supplierIdentifier,
      })).filter((payment) => payment.matchConfidence !== "unmatched");
      for (const payment of matches) {
        if (payment.matchConfidence === "confirmed") confirmed += 1;
        else probable += 1;
        await sql`
          insert into analytics_payments (id, contract_id, source_name, source_payment_id, paid_at, amount, currency,
            payer_identifier, recipient_identifier, purpose, match_confidence, match_evidence, source)
          values (${`spending:${payment.sourcePaymentId}`}, ${contract.id}, 'spending.gov.ua', ${payment.sourcePaymentId},
            ${payment.paidAt}, ${payment.amount}, ${payment.currency}, ${buyerIdentifier}, ${supplierIdentifier},
            ${payment.purpose}, ${payment.matchConfidence}, ${JSON.stringify(payment.evidence)}::jsonb, ${JSON.stringify(payment.raw)}::jsonb)
          on conflict (source_name, source_payment_id) do update set contract_id = excluded.contract_id,
            paid_at = excluded.paid_at, amount = excluded.amount, currency = excluded.currency,
            match_confidence = excluded.match_confidence, match_evidence = excluded.match_evidence, source = excluded.source
        `;
      }
      const total = summarizeConfirmedPayments(matches);
      if (matches.some((payment) => payment.matchConfidence === "confirmed")) {
        await sql`update analytics_contracts set amount_paid = coalesce(amount_paid, ${total}) where id = ${contract.id}`;
      }
    } catch (error) {
      failures.push(`${contract.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { confirmed, probable, failures };
}
