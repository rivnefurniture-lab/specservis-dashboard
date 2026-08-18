export type AnalyticsDateLens = "publication" | "award" | "contract";

export type AnalyticsMoney = {
  amount: number | null;
  currency: string;
};

export type AnalyticsTenderInput = {
  id: string;
  externalTenderId?: string | null;
  prozorroUrl?: string | null;
  title: string;
  description?: string | null;
  publishedAt: string | null;
  buyerId: string;
  buyerName: string;
  procedureType: string;
  status?: string | null;
  category?: string | null;
  region?: string | null;
  deliveryAddress?: string | null;
  expectedAmount?: number | null;
  expectedCurrency?: string | null;
  ourStatus?: string | null;
  awardDataComplete?: boolean;
  direct: boolean;
  direction?: string | null;
  cpv?: string | null;
};

export type AnalyticsLotInput = {
  id: string;
  tenderId: string;
  title?: string | null;
  expectedAmount?: number | null;
  expectedCurrency?: string | null;
};

export type AnalyticsBidInput = {
  id: string;
  lotId: string;
  supplierId: string;
  supplierName: string;
  status?: string | null;
  publishedAt: string | null;
  amount: number | null;
  currency: string;
};

export type AnalyticsAwardInput = {
  id: string;
  lotId: string;
  supplierId: string;
  supplierName: string;
  bidId?: string | null;
  rejectionReason?: string | null;
  status: string;
  date: string | null;
  amount: number | null;
  currency: string;
};

export type AnalyticsContractInput = {
  id: string;
  tenderId: string;
  lotId: string | null;
  supplierId: string;
  supplierName: string;
  buyerId?: string | null;
  buyerName?: string | null;
  status: string;
  contractNumber?: string | null;
  hasChanges?: boolean | null;
  signedAt: string | null;
  updatedAt?: string | null;
  terminationType?: "completed" | "terminated" | null;
  originalAmount: number | null;
  currentAmount: number | null;
  paidAmount: number | null;
  currency: string;
  originalCurrency?: string | null;
  currentCurrency?: string | null;
  paidCurrency?: string | null;
};

export type AnalyticsV2Input = {
  tenders: AnalyticsTenderInput[];
  lots: AnalyticsLotInput[];
  bids: AnalyticsBidInput[];
  awards: AnalyticsAwardInput[];
  contracts: AnalyticsContractInput[];
};

export type AnalyticsV2Filters = {
  /** Internal exact dataset selection; never accepted directly from a public query parameter. */
  datasetId?: string;
  scope?: "monitoring" | "expanded";
  from?: string | null;
  to?: string | null;
  dateLens?: AnalyticsDateLens;
  buyerIds?: string[];
  supplierIds?: string[];
  currencies?: string[];
  procedureTypes?: string[];
  directions?: string[];
  cpvPrefixes?: string[];
  subjectQuery?: string | null;
  categories?: string[];
  statuses?: string[];
  regions?: string[];
  addressQuery?: string | null;
  expectedAmountMin?: number | null;
  expectedAmountMax?: number | null;
  minParticipants?: number | null;
  maxParticipants?: number | null;
  lowestRejected?: boolean | null;
  winnerSupplierIds?: string[];
  contractPresence?: boolean | null;
  paidPresence?: boolean | null;
  changesPresence?: boolean | null;
  ourStatuses?: string[];
};

export type CurrencyAggregate = {
  currency: string;
  value: number | null;
  known: number;
  total: number;
};

export type AnalyticsV2Metrics = {
  participations: number;
  disqualifiedParticipations: number;
  wins: number;
  signedContracts: number;
  competitiveContracts: number;
  activeContracts: number;
  terminatedContracts: number;
  completedContracts: number;
  earlyTerminatedContracts: number;
  unknownTerminations: number;
  bidAmount: CurrencyAggregate[];
  awardAmount: CurrencyAggregate[];
  originalAmount: CurrencyAggregate[];
  currentAmount: CurrencyAggregate[];
  paidAmount: CurrencyAggregate[];
  winRate: number | null;
  contractConversion: number | null;
  avgOtherBidders: number | null;
};

export type AnalyticsV2PartyRow = AnalyticsV2Metrics & {
  id: string;
  name: string;
};

export type AnalyticsV2MatrixRow = AnalyticsV2Metrics & {
  supplierId: string;
  supplierName: string;
  buyerId: string;
  buyerName: string;
  tenders: number;
  lots: number;
};

export type AnalyticsV2DrilldownRow = {
  key: string;
  tenderId: string;
  externalTenderId: string | null;
  prozorroUrl: string | null;
  tenderTitle: string;
  publishedAt: string | null;
  awardDate: string | null;
  contractDate: string | null;
  lotId: string | null;
  lotTitle: string | null;
  buyerId: string;
  buyerName: string;
  supplierId: string;
  supplierName: string;
  direct: boolean;
  participation: boolean;
  participantCount: number | null;
  lotParticipants: Array<{
    supplierId: string;
    supplierName: string;
    bid: AnalyticsMoney;
    won: boolean;
  }>;
  lowestRejected: boolean | null;
  rejectionReason: string | null;
  won: boolean;
  bid: AnalyticsMoney | null;
  award: AnalyticsMoney | null;
  contractIds: string[];
  contractStatuses: string[];
  originalAmount: CurrencyAggregate[];
  currentAmount: CurrencyAggregate[];
  paidAmount: CurrencyAggregate[];
};

export type AnalyticsV2Result = {
  summary: AnalyticsV2Metrics & { tenders: number; lots: number };
  suppliers: AnalyticsV2PartyRow[];
  buyers: AnalyticsV2PartyRow[];
  mainBuyersByCount: AnalyticsV2PartyRow[];
  mainBuyersBySum: Array<{ currency: string; buyers: AnalyticsV2PartyRow[] }>;
  matrix: AnalyticsV2MatrixRow[];
  drilldown: AnalyticsV2DrilldownRow[];
};

type Participation = AnalyticsBidInput & {
  tender: AnalyticsTenderInput;
  lot: AnalyticsLotInput;
  otherBidders: number;
};

type Win = AnalyticsAwardInput & {
  tender: AnalyticsTenderInput;
  lot: AnalyticsLotInput;
};

type Contract = AnalyticsContractInput & {
  tender: AnalyticsTenderInput;
  competitive: boolean;
};

type MetricSource = {
  participations: Participation[];
  wins: Win[];
  contracts: Contract[];
};

const ACTIVE_AWARD = "active";
const SIGNED_CONTRACT_STATUSES = new Set(["active", "terminated"]);
const key = (...parts: Array<string | null>) => parts.join("\u0000");
const normalizeCurrency = (currency: string) => currency.trim().toUpperCase() || "UNKNOWN";
const ratio = (numerator: number, denominator: number) => denominator === 0 ? null : numerator / denominator;

function validDate(value: string | null | undefined) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function inRange(value: string | null | undefined, from?: string | null, to?: string | null) {
  if (!from && !to) return true;
  const date = validDate(value);
  if (date == null) return false;
  const start = from ? validDate(from) : null;
  const rawEnd = to ? validDate(to) : null;
  const end = rawEnd == null ? null : /^\d{4}-\d{2}-\d{2}$/.test(to ?? "") ? rawEnd + 86_399_999 : rawEnd;
  return (start == null || date >= start) && (end == null || date <= end);
}

function selected(value: string | null | undefined, values?: string[]) {
  return !values?.length || (value != null && values.includes(value));
}

function includesText(value: string | null | undefined, query?: string | null) {
  if (!query?.trim()) return true;
  return (value ?? "").toLocaleLowerCase("uk-UA").includes(query.trim().toLocaleLowerCase("uk-UA"));
}

function selectedParty(id: string, name: string, values?: string[]) {
  if (!values?.length) return true;
  const normalizedName = name.toLocaleLowerCase("uk-UA");
  return values.some((value) => value === id || normalizedName.includes(value.toLocaleLowerCase("uk-UA")));
}

function amountInRange(value: number | null | undefined, minimum?: number | null, maximum?: number | null) {
  if (minimum == null && maximum == null) return true;
  if (value == null || !Number.isFinite(value)) return false;
  return (minimum == null || value >= minimum) && (maximum == null || value <= maximum);
}

function moneyTotals(rows: Array<{ amount: number | null; currency: string }>): CurrencyAggregate[] {
  const groups = new Map<string, { value: number; known: number; total: number }>();
  for (const row of rows) {
    const currency = normalizeCurrency(row.currency);
    const group = groups.get(currency) ?? { value: 0, known: 0, total: 0 };
    group.total += 1;
    if (row.amount != null && Number.isFinite(row.amount)) {
      group.value += row.amount;
      group.known += 1;
    }
    groups.set(currency, group);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, group]) => ({
      currency,
      value: group.known ? group.value : null,
      known: group.known,
      total: group.total,
    }));
}

function latestBy<T>(rows: T[], identity: (row: T) => string, timestamp: (row: T) => string | null | undefined) {
  const latest = new Map<string, { row: T; time: number; index: number }>();
  rows.forEach((row, index) => {
    const time = validDate(timestamp(row)) ?? Number.NEGATIVE_INFINITY;
    const current = latest.get(identity(row));
    if (!current || time > current.time || (time === current.time && index > current.index)) {
      latest.set(identity(row), { row, time, index });
    }
  });
  return [...latest.values()].map(({ row }) => row);
}

function metrics(source: MetricSource): AnalyticsV2Metrics {
  const terminated = source.contracts.filter((contract) => contract.status === "terminated");
  const competitiveContracts = source.contracts.filter((contract) => contract.competitive);
  return {
    participations: source.participations.length,
    disqualifiedParticipations: source.participations.filter((item) => item.status === "unsuccessful").length,
    wins: source.wins.length,
    signedContracts: source.contracts.length,
    competitiveContracts: competitiveContracts.length,
    activeContracts: source.contracts.filter((contract) => contract.status === "active").length,
    terminatedContracts: terminated.length,
    completedContracts: terminated.filter((contract) => contract.terminationType === "completed").length,
    earlyTerminatedContracts: terminated.filter((contract) => contract.terminationType === "terminated").length,
    unknownTerminations: terminated.filter((contract) => contract.terminationType == null).length,
    bidAmount: moneyTotals(source.participations.map((item) => ({ amount: item.amount, currency: item.currency }))),
    awardAmount: moneyTotals(source.wins.map((item) => ({ amount: item.amount, currency: item.currency }))),
    originalAmount: moneyTotals(source.contracts.map((item) => ({ amount: item.originalAmount, currency: item.originalCurrency ?? item.currency }))),
    currentAmount: moneyTotals(source.contracts.map((item) => ({ amount: item.currentAmount, currency: item.currentCurrency ?? item.currency }))),
    paidAmount: moneyTotals(source.contracts.map((item) => ({ amount: item.paidAmount, currency: item.paidCurrency ?? item.currency }))),
    winRate: ratio(source.wins.length, source.participations.length),
    contractConversion: ratio(competitiveContracts.length, source.wins.length),
    avgOtherBidders: source.participations.length
      ? source.participations.reduce((sum, item) => sum + item.otherBidders, 0) / source.participations.length
      : null,
  };
}

function partyRows(source: MetricSource, party: "supplier" | "buyer") {
  const identities = new Map<string, string>();
  for (const item of [...source.participations, ...source.wins]) {
    identities.set(
      party === "supplier" ? item.supplierId : item.tender.buyerId,
      party === "supplier" ? item.supplierName : item.tender.buyerName,
    );
  }
  for (const item of source.contracts) {
    identities.set(
      party === "supplier" ? item.supplierId : item.buyerId ?? item.tender.buyerId,
      party === "supplier" ? item.supplierName : item.buyerName ?? item.tender.buyerName,
    );
  }
  return [...identities.entries()].map(([id, name]) => {
    const matches = (item: Participation | Win | Contract) => party === "supplier"
      ? item.supplierId === id
      : ("tender" in item && ("buyerId" in item ? item.buyerId ?? item.tender.buyerId : item.tender.buyerId)) === id;
    return {
      id,
      name,
      ...metrics({
        participations: source.participations.filter(matches),
        wins: source.wins.filter(matches),
        contracts: source.contracts.filter(matches),
      }),
    };
  }).sort((left, right) => right.signedContracts - left.signedContracts
    || right.wins - left.wins
    || right.participations - left.participations
    || left.name.localeCompare(right.name));
}

function totalForCurrency(rows: CurrencyAggregate[], currency: string) {
  return rows.find((row) => row.currency === currency)?.value ?? null;
}

function sourced<T>(value: SourcedValue<T>) {
  return value.sourceState === "value" ? value.value : null;
}

function partyIdentity(party: CanonicalParty) {
  const identifier = party.identifier.id?.trim();
  const scheme = party.identifier.scheme?.trim().toUpperCase();
  return {
    id: identifier ? `${scheme || "ID"}:${identifier}` : party.id,
    name: party.identifier.legalName?.trim() || party.name.trim() || identifier || party.id,
  };
}

function moneyValue(value: SourcedValue<Money>) {
  const item = sourced(value);
  return { amount: item?.amount ?? null, currency: item?.currency ?? "UNKNOWN" };
}

function canonicalInput(dataset: ProzorroAnalyticsDataset): AnalyticsV2Input {
  const procurementById = new Map(dataset.procurements.map((procurement) => [procurement.id, procurement]));
  const rootLotByProcurement = new Map(dataset.lots.filter((lot) => lot.kind === "root-lot").map((lot) => [lot.procurementId, lot.id]));
  const latestChangeByContract = new Map<string, string>();
  for (const change of dataset.changes) {
    const candidate = sourced(change.date) ?? sourced(change.dateSigned);
    const current = latestChangeByContract.get(change.contractId);
    if (candidate && (!current || (validDate(candidate) ?? 0) > (validDate(current) ?? 0))) latestChangeByContract.set(change.contractId, candidate);
  }
  const itemCpvByProcurement = new Map<string, string>();
  const itemAddressByProcurement = new Map<string, { region: string | null; text: string | null }>();
  for (const item of dataset.items) {
    const cpv = sourced(item.classification)?.id;
    if (cpv && !itemCpvByProcurement.has(item.procurementId)) itemCpvByProcurement.set(item.procurementId, cpv);
    const address = sourced(item.deliveryAddress);
    if (address && !itemAddressByProcurement.has(item.procurementId)) {
      itemAddressByProcurement.set(item.procurementId, {
        region: address.region,
        text: [address.postalCode, address.region, address.locality, address.streetAddress].filter(Boolean).join(", ") || null,
      });
    }
  }

  const tenders: AnalyticsTenderInput[] = dataset.procurements.flatMap((procurement) => {
    const buyer = sourced(procurement.buyer);
    if (!buyer) return [];
    const identity = partyIdentity(buyer);
    const method = sourced(procurement.procurementMethod) ?? "";
    const methodType = sourced(procurement.procurementMethodType) ?? "";
    const expected = moneyValue(procurement.value);
    const address = itemAddressByProcurement.get(procurement.id);
    return [{
      id: procurement.id,
      externalTenderId: procurement.tenderId,
      prozorroUrl: `https://prozorro.gov.ua/tender/${encodeURIComponent(procurement.tenderId)}`,
      title: sourced(procurement.title) ?? procurement.tenderId,
      description: sourced(procurement.description),
      publishedAt: sourced(procurement.datePublished),
      buyerId: identity.id,
      buyerName: identity.name,
      procedureType: methodType || method,
      status: sourced(procurement.status),
      category: sourced(procurement.mainProcurementCategory),
      region: address?.region ?? null,
      deliveryAddress: address?.text ?? null,
      expectedAmount: expected.amount,
      expectedCurrency: expected.currency,
      awardDataComplete: true,
      direct: method === "limited" || /(?:^|\.)reporting(?:\.|$)|negotiation/i.test(methodType),
      cpv: itemCpvByProcurement.get(procurement.id) ?? null,
    }];
  });

  const lots: AnalyticsLotInput[] = dataset.lots.map((lot) => ({
    id: lot.id,
    tenderId: lot.procurementId,
    title: sourced(lot.title),
    expectedAmount: moneyValue(lot.value).amount,
    expectedCurrency: moneyValue(lot.value).currency,
  }));

  const bids: AnalyticsBidInput[] = dataset.bids.flatMap((bid) => {
    const lotIds = bid.lotIds.length ? bid.lotIds : [rootLotByProcurement.get(bid.procurementId)].filter((id): id is string => Boolean(id));
    return bid.tenderers.flatMap((party) => lotIds.map((lotId) => {
      const identity = partyIdentity(party);
      const lotMoney = bid.lotValues.find((value) => value.lotId === lotId)?.value ?? bid.value;
      const amount = moneyValue(lotMoney);
      return {
        id: `${bid.id}:${identity.id}:${lotId}`,
        lotId,
        supplierId: identity.id,
        supplierName: identity.name,
        status: sourced(bid.status),
        publishedAt: sourced(bid.date),
        ...amount,
      };
    }));
  });

  const awards: AnalyticsAwardInput[] = dataset.awards.flatMap((award) => {
    const lotId = award.lotId ?? rootLotByProcurement.get(award.procurementId);
    if (!lotId) return [];
    const amount = moneyValue(award.value);
    return award.suppliers.map((party) => {
      const identity = partyIdentity(party);
      return {
        id: `${award.id}:${identity.id}`,
        lotId,
        supplierId: identity.id,
        supplierName: identity.name,
        bidId: award.bidId,
        rejectionReason: sourced(award.disqualificationReason),
        status: sourced(award.status) ?? "unknown",
        date: sourced(award.date),
        ...amount,
      };
    });
  });

  const contracts: AnalyticsContractInput[] = dataset.contracts.flatMap((contract) => {
    const procurement = procurementById.get(contract.procurementId);
    const buyer = procurement ? sourced(procurement.buyer) : null;
    const buyerIdentity = buyer ? partyIdentity(buyer) : null;
    const current = moneyValue(contract.value);
    const paid = moneyValue(contract.amountPaid);
    // An award amount is not the original contract amount. Historical
    // Contracting API objects often expose only the current value, so the
    // original remains unknown unless our store captured it at first sight.
    const original = { amount: null, currency: current.currency };
    const details = sourced(contract.terminationDetails);
    const status = sourced(contract.status) ?? "unknown";
    const terminationType = status !== "terminated" ? null
      : details == null ? null
      : /виконан|completed|performed/i.test(details) ? "completed" as const
      : "terminated" as const;
    return contract.suppliers.map((party) => {
      const identity = partyIdentity(party);
      return {
        id: contract.id,
        tenderId: contract.procurementId,
        lotId: contract.lotId,
        supplierId: identity.id,
        supplierName: identity.name,
        buyerId: buyerIdentity?.id ?? null,
        buyerName: buyerIdentity?.name ?? null,
        status,
        contractNumber: sourced(contract.contractNumber),
        hasChanges: contract.changeIds.length > 0,
        signedAt: sourced(contract.dateSigned),
        updatedAt: latestChangeByContract.get(contract.id) ?? null,
        terminationType,
        originalAmount: original.amount,
        currentAmount: current.amount,
        paidAmount: paid.amount,
        currency: current.currency !== "UNKNOWN" ? current.currency
          : original.currency !== "UNKNOWN" ? original.currency : paid.currency,
        originalCurrency: original.currency,
        currentCurrency: current.currency,
        paidCurrency: paid.currency,
      };
    });
  });
  return { tenders, lots, bids, awards, contracts };
}

export function buildAnalyticsV2(input: AnalyticsV2Input | ProzorroAnalyticsDataset, filters: AnalyticsV2Filters = {}): AnalyticsV2Result {
  const normalized = "schemaVersion" in input ? canonicalInput(input) : input;
  input = normalized;
  const lens = filters.dateLens ?? "publication";
  const lotsById = new Map(input.lots.map((lot) => [lot.id, lot]));
  const tendersById = new Map(input.tenders.map((tender) => [tender.id, tender]));
  const latestBidCandidates = latestBy(
    input.bids,
    (bid) => key(bid.supplierId, bid.lotId),
    (bid) => bid.publishedAt,
  );
  const biddersByLot = new Map<string, AnalyticsBidInput[]>();
  for (const bid of latestBidCandidates) {
    const rows = biddersByLot.get(bid.lotId) ?? [];
    rows.push(bid);
    biddersByLot.set(bid.lotId, rows);
  }
  const activeAwardsByLot = new Map<string, AnalyticsAwardInput[]>();
  for (const award of input.awards.filter((item) => item.status === ACTIVE_AWARD)) {
    const rows = activeAwardsByLot.get(award.lotId) ?? [];
    rows.push(award);
    activeAwardsByLot.set(award.lotId, rows);
  }
  const rejectedLowestLots = new Set<string>();
  for (const [lotId, bids] of biddersByLot) {
    const known = bids.filter((bid) => bid.amount != null && Number.isFinite(bid.amount));
    if (!known.length) continue;
    const lowest = Math.min(...known.map((bid) => bid.amount as number));
    const lowestSuppliers = new Set(known.filter((bid) => bid.amount === lowest).map((bid) => bid.supplierId));
    const rejected = input.awards.some((award) => award.lotId === lotId
      && lowestSuppliers.has(award.supplierId)
      && award.status !== ACTIVE_AWARD
      && Boolean(award.rejectionReason));
    if (rejected) rejectedLowestLots.add(lotId);
  }
  const contractsByTender = new Map<string, AnalyticsContractInput[]>();
  const signedContractCandidates = latestBy(
    input.contracts,
    (contract) => contract.id,
    (contract) => contract.updatedAt ?? contract.signedAt,
  ).filter((contract) => SIGNED_CONTRACT_STATUSES.has(contract.status));
  for (const contract of signedContractCandidates) {
    const rows = contractsByTender.get(contract.tenderId) ?? [];
    rows.push(contract);
    contractsByTender.set(contract.tenderId, rows);
  }
  const baseTenders = input.tenders.filter((tender) =>
    selectedParty(tender.buyerId, tender.buyerName, filters.buyerIds)
    && selected(tender.procedureType, filters.procedureTypes)
    && selected(tender.direction, filters.directions)
    && selected(tender.category, filters.categories)
    && selected(tender.status, filters.statuses)
    && selected(tender.region, filters.regions)
    && selected(tender.ourStatus, filters.ourStatuses)
    && includesText(`${tender.title} ${tender.description ?? ""}`, filters.subjectQuery)
    && includesText(tender.deliveryAddress, filters.addressQuery)
    && (!filters.cpvPrefixes?.length || filters.cpvPrefixes.some((prefix) => tender.cpv?.startsWith(prefix)))
    && (() => {
      const contracts = contractsByTender.get(tender.id) ?? [];
      if (filters.contractPresence != null && (contracts.length > 0) !== filters.contractPresence) return false;
      if (filters.paidPresence != null) {
        const hasPayment = contracts.some((contract) => contract.paidAmount != null && contract.paidAmount > 0);
        const knownNoPayment = contracts.length === 0 || contracts.every((contract) => contract.paidAmount != null && contract.paidAmount <= 0);
        if (filters.paidPresence ? !hasPayment : !knownNoPayment) return false;
      }
      if (filters.changesPresence != null) {
        const hasChanges = contracts.some((contract) => contract.hasChanges === true);
        const knownNoChanges = contracts.length === 0 || contracts.every((contract) => contract.hasChanges === false);
        if (filters.changesPresence ? !hasChanges : !knownNoChanges) return false;
      }
      return true;
    })()
  );
  const candidateTenderIds = new Set(baseTenders.map((tender) => tender.id));
  const baseLots = input.lots.filter((lot) => {
    if (!candidateTenderIds.has(lot.tenderId)) return false;
    const tender = tendersById.get(lot.tenderId);
    const participantCount = biddersByLot.get(lot.id)?.length ?? 0;
    if (filters.minParticipants != null && participantCount < filters.minParticipants) return false;
    if (filters.maxParticipants != null && participantCount > filters.maxParticipants) return false;
    if (!amountInRange(lot.expectedAmount ?? tender?.expectedAmount, filters.expectedAmountMin, filters.expectedAmountMax)) return false;
    if (filters.lowestRejected != null) {
      if (!tender?.awardDataComplete) return false;
      if (rejectedLowestLots.has(lot.id) !== filters.lowestRejected) return false;
    }
    if (filters.winnerSupplierIds?.length
      && !(activeAwardsByLot.get(lot.id) ?? []).some((award) => selectedParty(award.supplierId, award.supplierName, filters.winnerSupplierIds))) return false;
    return true;
  });
  const allLotTenderIds = new Set(input.lots.map((lot) => lot.tenderId));
  const baseTenderIds = new Set(baseLots.map((lot) => lot.tenderId));
  for (const tender of baseTenders) {
    if (!allLotTenderIds.has(tender.id) && (contractsByTender.get(tender.id)?.length ?? 0) > 0) baseTenderIds.add(tender.id);
  }
  const baseLotIds = new Set(baseLots.map((lot) => lot.id));
  const currencyAllowed = (currency: string) => selected(normalizeCurrency(currency), filters.currencies?.map(normalizeCurrency));

  const lensAwards = latestBy(
    input.awards.filter((award) => baseLotIds.has(award.lotId)
      && inRange(award.date, filters.from, filters.to)),
    (award) => key(award.supplierId, award.lotId),
    (award) => award.date,
  ).filter((award) => award.status === ACTIVE_AWARD);
  const lensContracts = latestBy(
    input.contracts.filter((contract) => baseTenderIds.has(contract.tenderId)
      && inRange(contract.signedAt, filters.from, filters.to)),
    (contract) => contract.id,
    (contract) => contract.updatedAt ?? contract.signedAt,
  ).filter((contract) => SIGNED_CONTRACT_STATUSES.has(contract.status));
  const lensTenderIds = new Set<string>();
  const lensLotIds = new Set<string>();
  if (lens === "publication") {
    baseTenders.filter((tender) => baseTenderIds.has(tender.id) && inRange(tender.publishedAt, filters.from, filters.to)).forEach((tender) => lensTenderIds.add(tender.id));
  } else if (lens === "award") {
    lensAwards.forEach((award) => {
      lensLotIds.add(award.lotId);
      const lot = lotsById.get(award.lotId);
      if (lot) lensTenderIds.add(lot.tenderId);
    });
  } else {
    lensContracts.forEach((contract) => {
      lensTenderIds.add(contract.tenderId);
      if (contract.lotId) lensLotIds.add(contract.lotId);
    });
  }
  if (lens === "publication") {
    baseLots.filter((lot) => lensTenderIds.has(lot.tenderId)).forEach((lot) => lensLotIds.add(lot.id));
  }

  const scopedTender = (tenderId: string) => lensTenderIds.has(tenderId);
  const scopedLot = (lotId: string) => lensLotIds.has(lotId);
  const supplierAllowed = (supplierId: string, supplierName: string) => selectedParty(supplierId, supplierName, filters.supplierIds);
  const allLatestBids = latestBy(
    input.bids.filter((bid) => scopedLot(bid.lotId)),
    (bid) => key(bid.supplierId, bid.lotId),
    (bid) => bid.publishedAt,
  );
  const bidderSets = new Map<string, Set<string>>();
  allLatestBids.forEach((bid) => {
    const set = bidderSets.get(bid.lotId) ?? new Set<string>();
    set.add(bid.supplierId);
    bidderSets.set(bid.lotId, set);
  });
  const participations: Participation[] = allLatestBids
    .filter((bid) => supplierAllowed(bid.supplierId, bid.supplierName) && currencyAllowed(bid.currency))
    .flatMap((bid) => {
    const lot = lotsById.get(bid.lotId);
    const tender = lot ? tendersById.get(lot.tenderId) : null;
    if (!lot || !tender || tender.direct) return [];
    return [{ ...bid, lot, tender, otherBidders: Math.max(0, (bidderSets.get(bid.lotId)?.size ?? 1) - 1) }];
  });
  const latestAwards = latestBy(
    input.awards.filter((award) => scopedLot(award.lotId)
      && (lens !== "award" || inRange(award.date, filters.from, filters.to))),
    (award) => key(award.supplierId, award.lotId),
    (award) => award.date,
  );
  const wins: Win[] = latestAwards
    .filter((award) => award.status === ACTIVE_AWARD
      && supplierAllowed(award.supplierId, award.supplierName)
      && currencyAllowed(award.currency))
    .flatMap((award) => {
      const lot = lotsById.get(award.lotId);
      const tender = lot ? tendersById.get(lot.tenderId) : null;
      if (!lot || !tender || tender.direct) return [];
      return [{ ...award, lot, tender }];
    });
  const winKeys = new Set(wins.map((win) => key(win.supplierId, win.lotId)));

  const latestContracts = latestBy(
    input.contracts.filter((contract) => scopedTender(contract.tenderId)
      && (lens !== "contract" || inRange(contract.signedAt, filters.from, filters.to))),
    (contract) => contract.id,
    (contract) => contract.updatedAt ?? contract.signedAt,
  );
  const contracts: Contract[] = latestContracts
    .filter((contract) => supplierAllowed(contract.supplierId, contract.supplierName)
      && currencyAllowed(contract.currency)
      && SIGNED_CONTRACT_STATUSES.has(contract.status))
    .flatMap((contract) => {
      const tender = tendersById.get(contract.tenderId);
      if (!tender) return [];
      const competitive = !tender.direct && contract.lotId != null && winKeys.has(key(contract.supplierId, contract.lotId));
      return [{ ...contract, tender, competitive }];
    });
  const source = { participations, wins, contracts };
  const suppliers = partyRows(source, "supplier");
  const buyers = partyRows(source, "buyer");

  const pairKeys = new Set<string>();
  participations.forEach((item) => pairKeys.add(key(item.supplierId, item.tender.buyerId)));
  wins.forEach((item) => pairKeys.add(key(item.supplierId, item.tender.buyerId)));
  contracts.forEach((item) => pairKeys.add(key(item.supplierId, item.buyerId ?? item.tender.buyerId)));
  const matrix = [...pairKeys].map((pair): AnalyticsV2MatrixRow => {
    const [supplierId, buyerId] = pair.split("\u0000");
    const pairSource = {
      participations: participations.filter((item) => item.supplierId === supplierId && item.tender.buyerId === buyerId),
      wins: wins.filter((item) => item.supplierId === supplierId && item.tender.buyerId === buyerId),
      contracts: contracts.filter((item) => item.supplierId === supplierId && (item.buyerId ?? item.tender.buyerId) === buyerId),
    };
    return {
      supplierId,
      supplierName: suppliers.find((item) => item.id === supplierId)?.name ?? supplierId,
      buyerId,
      buyerName: buyers.find((item) => item.id === buyerId)?.name ?? buyerId,
      tenders: new Set([
        ...pairSource.participations.map((item) => item.tender.id),
        ...pairSource.wins.map((item) => item.tender.id),
        ...pairSource.contracts.map((item) => item.tender.id),
      ]).size,
      lots: new Set([
        ...pairSource.participations.map((item) => item.lot.id),
        ...pairSource.wins.map((item) => item.lot.id),
        ...pairSource.contracts.flatMap((item) => item.lotId ? [item.lotId] : []),
      ]).size,
      ...metrics(pairSource),
    };
  }).sort((left, right) => right.signedContracts - left.signedContracts || right.wins - left.wins || left.supplierName.localeCompare(right.supplierName));

  const drillKeys = new Set<string>();
  participations.forEach((item) => drillKeys.add(key(item.supplierId, item.lotId)));
  wins.forEach((item) => drillKeys.add(key(item.supplierId, item.lotId)));
  contracts.forEach((item) => drillKeys.add(key(item.supplierId, item.lotId ?? `contract:${item.id}`)));
  const drilldown = [...drillKeys].map((rowKey): AnalyticsV2DrilldownRow => {
    const [supplierId, lotIdentity] = rowKey.split("\u0000");
    const participation = participations.find((item) => item.supplierId === supplierId && item.lotId === lotIdentity);
    const win = wins.find((item) => item.supplierId === supplierId && item.lotId === lotIdentity);
    const rowContracts = contracts.filter((item) => item.supplierId === supplierId
      && (item.lotId === lotIdentity || `contract:${item.id}` === lotIdentity));
    const tender = participation?.tender ?? win?.tender ?? rowContracts[0].tender;
    const lot = lotsById.get(lotIdentity);
    const supplierName = participation?.supplierName ?? win?.supplierName ?? rowContracts[0].supplierName;
    const rejectedAward = latestAwards.find((award) => award.lotId === lotIdentity
      && award.supplierId === supplierId
      && award.status !== ACTIVE_AWARD
      && Boolean(award.rejectionReason));
    const lotBids = allLatestBids.filter((bid) => bid.lotId === lotIdentity);
    return {
      key: rowKey,
      tenderId: tender.id,
      externalTenderId: tender.externalTenderId ?? null,
      prozorroUrl: tender.prozorroUrl ?? null,
      tenderTitle: tender.title,
      publishedAt: tender.publishedAt,
      awardDate: win?.date ?? null,
      contractDate: rowContracts[0]?.signedAt ?? null,
      lotId: lot?.id ?? rowContracts[0].lotId,
      lotTitle: lot?.title ?? null,
      buyerId: rowContracts[0]?.buyerId ?? tender.buyerId,
      buyerName: rowContracts[0]?.buyerName ?? tender.buyerName,
      supplierId,
      supplierName,
      direct: tender.direct,
      participation: Boolean(participation),
      participantCount: lot ? (bidderSets.get(lot.id)?.size ?? 0) : null,
      lotParticipants: lotBids.map((bid) => ({
        supplierId: bid.supplierId,
        supplierName: bid.supplierName,
        bid: { amount: bid.amount, currency: normalizeCurrency(bid.currency) },
        won: latestAwards.some((award) => award.lotId === lotIdentity
          && award.supplierId === bid.supplierId
          && award.status === ACTIVE_AWARD),
      })).sort((left, right) => (left.bid.amount ?? Number.POSITIVE_INFINITY) - (right.bid.amount ?? Number.POSITIVE_INFINITY)
        || left.supplierName.localeCompare(right.supplierName)),
      lowestRejected: rejectedAward ? true : tender.awardDataComplete ? false : null,
      rejectionReason: rejectedAward?.rejectionReason ?? null,
      won: Boolean(win),
      bid: participation ? { amount: participation.amount, currency: normalizeCurrency(participation.currency) } : null,
      award: win ? { amount: win.amount, currency: normalizeCurrency(win.currency) } : null,
      contractIds: rowContracts.map((contract) => contract.id),
      contractStatuses: rowContracts.map((contract) => contract.status),
      originalAmount: moneyTotals(rowContracts.map((contract) => ({ amount: contract.originalAmount, currency: contract.originalCurrency ?? contract.currency }))),
      currentAmount: moneyTotals(rowContracts.map((contract) => ({ amount: contract.currentAmount, currency: contract.currentCurrency ?? contract.currency }))),
      paidAmount: moneyTotals(rowContracts.map((contract) => ({ amount: contract.paidAmount, currency: contract.paidCurrency ?? contract.currency }))),
    };
  }).sort((left, right) => left.tenderId.localeCompare(right.tenderId) || left.supplierName.localeCompare(right.supplierName));

  const currentCurrencies = [...new Set(buyers.flatMap((buyer) => buyer.currentAmount.map((amount) => amount.currency)))].sort();
  return {
    summary: {
      tenders: lensTenderIds.size,
      lots: lensLotIds.size,
      ...metrics(source),
    },
    suppliers,
    buyers,
    mainBuyersByCount: [...buyers].sort((left, right) => right.signedContracts - left.signedContracts
      || right.wins - left.wins || right.participations - left.participations || left.name.localeCompare(right.name)),
    mainBuyersBySum: currentCurrencies.map((currency) => ({
      currency,
      buyers: buyers.filter((buyer) => totalForCurrency(buyer.currentAmount, currency) != null)
        .sort((left, right) => (totalForCurrency(right.currentAmount, currency) ?? 0)
          - (totalForCurrency(left.currentAmount, currency) ?? 0) || left.name.localeCompare(right.name)),
    })),
    matrix,
    drilldown,
  };
}
import type {
  CanonicalParty,
  Money,
  ProzorroAnalyticsDataset,
  SourcedValue,
} from "./analytics-v2-schema";
