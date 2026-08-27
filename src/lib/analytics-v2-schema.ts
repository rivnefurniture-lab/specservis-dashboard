/**
 * Canonical, source-preserving schema for the second-generation analytics layer.
 *
 * The model is intentionally normalized. Source objects are never flattened into
 * a single "tender row": procurement, lots, items, bids, awards, contracts,
 * changes, and reported payments retain their own identities and links.
 */

const ANALYTICS_V2_SCHEMA_VERSION = "analytics-v2" as const;

export type AnalyticsV2SchemaVersion = typeof ANALYTICS_V2_SCHEMA_VERSION;
export type ProvenanceSource = "prozorro-tender" | "prozorro-contracting" | "derived";
export type SourceState = "value" | "source-null" | "source-missing" | "derived";
export type ConfidenceLevel = "source" | "derived-high" | "derived-medium" | "unknown";

export type Confidence = {
  level: ConfidenceLevel;
  score: number;
  basis: string;
};

export type Provenance = {
  source: ProvenanceSource;
  sourceId: string | null;
  sourcePath: string;
  fetchedAt: string | null;
};

/**
 * `source-null` means the upstream JSON explicitly contained `null`.
 * `source-missing` means the property was absent. Consumers must not collapse
 * these states into zero, false, an empty string, or one another.
 */
export type SourcedValue<T> = {
  value: T | null;
  sourceState: SourceState;
  provenance: Provenance;
  confidence: Confidence;
};

export type Money = {
  amount: number;
  amountNet: number | null;
  currency: string | null;
  valueAddedTaxIncluded: boolean | null;
};

export type DatePeriod = {
  startDate: string | null;
  endDate: string | null;
};

export type CanonicalParty = {
  id: string;
  name: string;
  identifier: {
    scheme: string | null;
    id: string | null;
    legalName: string | null;
  };
  address: {
    countryName: string | null;
    region: string | null;
    locality: string | null;
    streetAddress: string | null;
    postalCode: string | null;
  } | null;
};

export type CanonicalEntityBase = {
  id: string;
  provenance: Provenance[];
  confidence: Confidence;
};

export type CanonicalProcurement = CanonicalEntityBase & {
  tenderId: string;
  status: SourcedValue<string>;
  procurementMethod: SourcedValue<string>;
  procurementMethodType: SourcedValue<string>;
  mainProcurementCategory: SourcedValue<string>;
  title: SourcedValue<string>;
  description: SourcedValue<string>;
  value: SourcedValue<Money>;
  tenderPeriod: SourcedValue<DatePeriod>;
  auctionPeriod: SourcedValue<DatePeriod>;
  guarantee: SourcedValue<Money>;
  paymentTerms: SourcedValue<Record<string, unknown>[]>;
  datePublished: SourcedValue<string>;
  dateModified: SourcedValue<string>;
  buyer: SourcedValue<CanonicalParty>;
  lotIds: string[];
  itemIds: string[];
  bidIds: string[];
  awardIds: string[];
  contractIds: string[];
};

export type CanonicalLot = CanonicalEntityBase & {
  procurementId: string;
  sourceLotId: string | null;
  kind: "source-lot" | "root-lot";
  title: SourcedValue<string>;
  description: SourcedValue<string>;
  status: SourcedValue<string>;
  value: SourcedValue<Money>;
  itemIds: string[];
  bidIds: string[];
  awardIds: string[];
};

export type CanonicalItem = CanonicalEntityBase & {
  procurementId: string;
  lotId: string | null;
  sourceItemId: string;
  description: SourcedValue<string>;
  classification: SourcedValue<{ scheme: string | null; id: string | null; description: string | null }>;
  quantity: SourcedValue<number>;
  unitCode: SourcedValue<string>;
  deliveryDate: SourcedValue<DatePeriod>;
  deliveryAddress: SourcedValue<{
    countryName: string | null;
    region: string | null;
    locality: string | null;
    streetAddress: string | null;
    postalCode: string | null;
  }>;
};

export type CanonicalBidLotValue = {
  lotId: string;
  value: SourcedValue<Money>;
};

export type CanonicalBid = CanonicalEntityBase & {
  procurementId: string;
  sourceBidId: string;
  status: SourcedValue<string>;
  date: SourcedValue<string>;
  tenderers: CanonicalParty[];
  lotIds: string[];
  lotValues: CanonicalBidLotValue[];
  value: SourcedValue<Money>;
  awardIds: string[];
};

export type CanonicalAward = CanonicalEntityBase & {
  procurementId: string;
  sourceAwardId: string;
  lotId: string | null;
  bidId: string | null;
  status: SourcedValue<string>;
  date: SourcedValue<string>;
  value: SourcedValue<Money>;
  suppliers: CanonicalParty[];
  qualified: SourcedValue<boolean>;
  eligible: SourcedValue<boolean>;
  disqualificationReason: SourcedValue<string>;
  contractIds: string[];
};

export type CanonicalContract = CanonicalEntityBase & {
  procurementId: string;
  sourceContractId: string;
  contractNumber: SourcedValue<string>;
  awardId: string | null;
  lotId: string | null;
  status: SourcedValue<string>;
  dateSigned: SourcedValue<string>;
  period: SourcedValue<DatePeriod>;
  value: SourcedValue<Money>;
  amountPaid: SourcedValue<Money>;
  terminationDetails: SourcedValue<string>;
  suppliers: CanonicalParty[];
  changeIds: string[];
  paymentIds: string[];
};

export type CanonicalChange = CanonicalEntityBase & {
  procurementId: string;
  contractId: string;
  sourceChangeId: string;
  status: SourcedValue<string>;
  date: SourcedValue<string>;
  dateSigned: SourcedValue<string>;
  rationale: SourcedValue<string>;
  rationaleTypes: string[];
  contractNumber: SourcedValue<string>;
  modifications: SourcedValue<Record<string, unknown>>;
};

/** `reported-total` is a cumulative Contracting API value, not a bank transaction. */
export type CanonicalPayment = CanonicalEntityBase & {
  procurementId: string;
  contractId: string;
  kind: "reported-total";
  amount: SourcedValue<Money>;
  reportedAt: SourcedValue<string>;
};

export type AnalyticsImportWarning = {
  code:
    | "missing-procurement-id"
    | "unknown-lot-reference"
    | "unknown-bid-reference"
    | "unknown-award-reference"
    | "contracting-contract-unmatched";
  message: string;
  sourcePath: string;
};

export type ProzorroAnalyticsDataset = {
  schemaVersion: AnalyticsV2SchemaVersion;
  importedAt: string;
  procurements: CanonicalProcurement[];
  lots: CanonicalLot[];
  items: CanonicalItem[];
  bids: CanonicalBid[];
  awards: CanonicalAward[];
  contracts: CanonicalContract[];
  changes: CanonicalChange[];
  payments: CanonicalPayment[];
  warnings: AnalyticsImportWarning[];
};

export type ProzorroAnalyticsImportOptions = {
  importedAt?: string;
  tenderFetchedAt?: string | null;
  contractingFetchedAt?: string | null;
};
