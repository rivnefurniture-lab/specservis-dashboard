import "server-only";

const SPENDING_TRANSACTIONS_URL = "https://api.spending.gov.ua/api/v2/api/transactions/";

export type SpendingTransaction = {
  id: number;
  trans_date?: string | null;
  amount?: number | null;
  currency?: string | null;
  payer_edrpou?: string | null;
  recipt_edrpou?: string | null;
  payment_details?: string | null;
  contractId?: number | string | null;
  contractNumber?: string | null;
  doc_number?: string | null;
  doc_date?: string | null;
  source_name?: string | null;
};

export type PaymentContractIdentity = {
  tenderId: string;
  contractNumber: string | null;
  signedAt: string | null;
  buyerIdentifier: string;
  supplierIdentifier: string;
};

export type MatchedSpendingPayment = {
  sourcePaymentId: string;
  paidAt: string | null;
  amount: number;
  currency: string;
  purpose: string | null;
  matchConfidence: "confirmed" | "probable" | "unmatched";
  evidence: string[];
  raw: SpendingTransaction;
};

function identifier(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

function searchable(value: unknown) {
  return String(value ?? "")
    .replace(/[№#]/g, " ")
    .normalize("NFKC")
    .toLocaleLowerCase("uk-UA")
    .replace(/[^a-zа-яіїєґ0-9]+/giu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function dateOnly(value: string | null | undefined) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? "");
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

function dateTokens(value: string | null) {
  if (!value) return [];
  const [year, month, day] = value.split("-");
  return [`${day}.${month}.${year}`, `${day} ${month} ${year}`, value].map(searchable);
}

export function matchSpendingTransaction(transaction: SpendingTransaction, contract: PaymentContractIdentity): MatchedSpendingPayment {
  const evidence: string[] = [];
  const pairMatches = identifier(transaction.payer_edrpou) === identifier(contract.buyerIdentifier)
    && identifier(transaction.recipt_edrpou) === identifier(contract.supplierIdentifier);
  if (pairMatches) evidence.push("edrpou-pair");

  const structured = searchable(transaction.contractNumber);
  const tenderId = searchable(contract.tenderId);
  const structuredTenderMatch = Boolean(structured && tenderId && (structured === tenderId || structured.startsWith(`${tenderId} `)));
  if (structuredTenderMatch) evidence.push("structured-tender-id");

  const purpose = searchable(transaction.payment_details);
  const number = searchable(contract.contractNumber);
  const contractNumberMatch = Boolean(number && purpose && purpose.includes(number));
  if (contractNumberMatch) evidence.push("contract-number-in-purpose");

  const signedDate = dateOnly(contract.signedAt);
  const contractDateMatch = dateTokens(signedDate).some((token) => token && purpose.includes(token));
  if (contractDateMatch) evidence.push("contract-date-in-purpose");

  const amount = Number(transaction.amount);
  const validAmount = Number.isFinite(amount) && amount >= 0;
  const confidence = pairMatches && structuredTenderMatch
    ? "confirmed"
    : pairMatches && contractNumberMatch && contractDateMatch
      ? "probable"
      : "unmatched";

  return {
    sourcePaymentId: String(transaction.id),
    paidAt: dateOnly(transaction.trans_date),
    amount: validAmount ? amount : 0,
    currency: String(transaction.currency || "UAH"),
    purpose: transaction.payment_details?.trim() || null,
    matchConfidence: confidence,
    evidence,
    raw: transaction,
  };
}

export async function fetchSpendingTransactions(
  buyerIdentifier: string,
  supplierIdentifier: string,
  startDate: string,
  endDate: string,
) {
  const url = new URL(SPENDING_TRANSACTIONS_URL);
  url.searchParams.set("startdate", startDate);
  url.searchParams.set("enddate", endDate);
  url.searchParams.set("payers_edrpous", identifier(buyerIdentifier));
  url.searchParams.set("recipt_edrpous", identifier(supplierIdentifier));
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000), cache: "no-store" });
  if (!response.ok) throw new Error(`Spending API ${response.status}`);
  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) throw new Error("Spending API returned an invalid payload");
  return payload.filter((item): item is SpendingTransaction => Boolean(item && typeof item === "object" && Number.isFinite(Number((item as SpendingTransaction).id))));
}

export function summarizeConfirmedPayments(payments: MatchedSpendingPayment[]) {
  return payments.reduce((total, payment) => payment.matchConfidence === "confirmed" ? total + payment.amount : total, 0);
}
