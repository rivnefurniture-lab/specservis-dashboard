import type {
  AnalyticsImportWarning,
  CanonicalAward,
  CanonicalBid,
  CanonicalChange,
  CanonicalContract,
  CanonicalItem,
  CanonicalLot,
  CanonicalParty,
  CanonicalPayment,
  Confidence,
  DatePeriod,
  Money,
  Provenance,
  ProvenanceSource,
  ProzorroAnalyticsDataset,
  ProzorroAnalyticsImportOptions,
  SourcedValue,
} from "@/lib/analytics-v2-schema";

const SCHEMA_VERSION = "analytics-v2" as const;

type JsonObject = Record<string, unknown>;
type InputSource = {
  raw: JsonObject;
  source: Exclude<ProvenanceSource, "derived">;
  path: string;
  fetchedAt: string | null;
};

const sourceConfidence: Confidence = { level: "source", score: 1, basis: "Direct value from an official Prozorro API object" };
const unknownConfidence: Confidence = { level: "unknown", score: 0, basis: "The upstream field is absent or unusable" };
const highDerivedConfidence: Confidence = { level: "derived-high", score: 0.98, basis: "Deterministic relationship derived from official source identifiers" };

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function objects(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.filter(isObject) : [];
}

function objectList(value: unknown): JsonObject[] | null {
  return Array.isArray(value) ? value.filter(isObject) : null;
}

function unwrapObject(value: unknown): JsonObject {
  if (!isObject(value)) return {};
  return isObject(value.data) ? value.data : value;
}

function own(object: JsonObject, key: string) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function text(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function numeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function boolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function provenance(source: InputSource, suffix = ""): Provenance {
  return {
    source: source.source,
    sourceId: text(source.raw.id) ?? text(source.raw.contractID),
    sourcePath: `${source.path}${suffix}`,
    fetchedAt: source.fetchedAt,
  };
}

function derivedProvenance(sourceId: string | null, sourcePath: string, fetchedAt: string | null): Provenance {
  return { source: "derived", sourceId, sourcePath, fetchedAt };
}

function sourced<T>(source: InputSource, key: string, convert: (value: unknown) => T | null): SourcedValue<T> {
  const fieldProvenance = provenance(source, `.${key}`);
  if (!own(source.raw, key)) {
    return { value: null, sourceState: "source-missing", provenance: fieldProvenance, confidence: unknownConfidence };
  }
  if (source.raw[key] === null) {
    return { value: null, sourceState: "source-null", provenance: fieldProvenance, confidence: sourceConfidence };
  }
  const value = convert(source.raw[key]);
  return {
    value,
    sourceState: "value",
    provenance: fieldProvenance,
    confidence: value === null ? unknownConfidence : sourceConfidence,
  };
}

function firstSourced<T>(sources: InputSource[], key: string, convert: (value: unknown) => T | null): SourcedValue<T> {
  const source = sources.find((candidate) => own(candidate.raw, key)) ?? sources[0];
  return source
    ? sourced(source, key, convert)
    : {
      value: null,
      sourceState: "source-missing",
      provenance: derivedProvenance(null, `unavailable.${key}`, null),
      confidence: unknownConfidence,
    };
}

function derived<T>(value: T, sourceId: string | null, path: string, fetchedAt: string | null, basis: string): SourcedValue<T> {
  return {
    value,
    sourceState: "derived",
    provenance: derivedProvenance(sourceId, path, fetchedAt),
    confidence: { ...highDerivedConfidence, basis },
  };
}

function money(value: unknown): Money | null {
  if (!isObject(value)) return null;
  const amount = numeric(value.amount);
  if (amount === null) return null;
  return {
    amount,
    amountNet: numeric(value.amountNet),
    currency: text(value.currency),
    valueAddedTaxIncluded: boolean(value.valueAddedTaxIncluded),
  };
}

function period(value: unknown): DatePeriod | null {
  if (!isObject(value)) return null;
  return { startDate: text(value.startDate), endDate: text(value.endDate) };
}

function classification(value: unknown) {
  if (!isObject(value)) return null;
  return { scheme: text(value.scheme), id: text(value.id), description: text(value.description) };
}

function address(value: unknown) {
  if (!isObject(value)) return null;
  return {
    countryName: text(value.countryName),
    region: text(value.region),
    locality: text(value.locality),
    streetAddress: text(value.streetAddress),
    postalCode: text(value.postalCode),
  };
}

function party(value: unknown, fallback: string): CanonicalParty | null {
  if (!isObject(value)) return null;
  const identifier = isObject(value.identifier) ? value.identifier : {};
  const identifierId = text(identifier.id);
  const name = text(value.name) ?? text(identifier.legalName) ?? "Unknown party";
  return {
    id: identifierId ?? text(value.id) ?? fallback,
    name,
    identifier: {
      scheme: text(identifier.scheme),
      id: identifierId,
      legalName: text(identifier.legalName),
    },
  };
}

function parties(value: unknown, prefix: string): CanonicalParty[] {
  return objects(value).flatMap((candidate, index) => {
    const parsed = party(candidate, `${prefix}:${index + 1}`);
    return parsed ? [parsed] : [];
  });
}

function canonicalId(procurementId: string, kind: string, sourceId: string) {
  return `${procurementId}:${kind}:${sourceId}`;
}

function sourceId(raw: JsonObject, fallback: string) {
  return text(raw.id) ?? text(raw.contractID) ?? fallback;
}

function reference(raw: JsonObject, ...keys: string[]) {
  for (const key of keys) {
    const value = text(raw[key]);
    if (value) return value;
  }
  return null;
}

function contractInputs(input: unknown, fetchedAt: string | null): InputSource[] {
  const entries = Array.isArray(input) ? input : input == null ? [] : [input];
  return entries.flatMap((entry, index) => {
    if (!isObject(entry)) return [];
    const value = entry.data;
    if (Array.isArray(value)) {
      return value.filter(isObject).map((raw, itemIndex) => ({
        raw,
        source: "prozorro-contracting" as const,
        path: `contracting[${index}].data[${itemIndex}]`,
        fetchedAt,
      }));
    }
    const raw = isObject(value) ? value : entry;
    return [{ raw, source: "prozorro-contracting" as const, path: `contracting[${index}].data`, fetchedAt }];
  });
}

function rootLotRequired(tender: JsonObject, bidCount: number) {
  const method = text(tender.procurementMethod)?.toLowerCase();
  const methodType = text(tender.procurementMethodType)?.toLowerCase() ?? "";
  const nonCompetitive = methodType === "reporting"
    || methodType.startsWith("negotiation")
    || method === "limited";
  return !nonCompetitive && (bidCount > 0 || method === "open" || method === "selective");
}

export function importProzorroAnalytics(
  tenderDetail: unknown,
  contracting: unknown = [],
  options: ProzorroAnalyticsImportOptions = {},
): ProzorroAnalyticsDataset {
  const importedAt = options.importedAt ?? new Date().toISOString();
  const tenderFetchedAt = options.tenderFetchedAt ?? importedAt;
  const contractingFetchedAt = options.contractingFetchedAt ?? importedAt;
  const tender = unwrapObject(tenderDetail);
  const warnings: AnalyticsImportWarning[] = [];
  const tenderSource: InputSource = { raw: tender, source: "prozorro-tender", path: "tender.data", fetchedAt: tenderFetchedAt };
  const procurementId = text(tender.id) ?? text(tender.tenderID) ?? "unknown-procurement";
  const tenderId = text(tender.tenderID) ?? procurementId;
  if (procurementId === "unknown-procurement") {
    warnings.push({ code: "missing-procurement-id", message: "Tender object has neither id nor tenderID", sourcePath: tenderSource.path });
  }

  const topLevelBids = objects(tender.bids).map((raw, index) => ({ raw, path: `tender.data.bids[${index}]`, implicitLot: null as string | null }));
  const sourceLots = objects(tender.lots);
  const nestedBids = sourceLots.flatMap((lot, lotIndex) => objects(lot.bids).map((raw, bidIndex) => ({
    raw,
    path: `tender.data.lots[${lotIndex}].bids[${bidIndex}]`,
    implicitLot: sourceId(lot, `lot-${lotIndex + 1}`),
  })));
  const bidSources = [...topLevelBids, ...nestedBids].filter((candidate, index, all) => {
    const id = text(candidate.raw.id);
    return !id || all.findIndex((other) => text(other.raw.id) === id) === index;
  });
  const rootLotId = !sourceLots.length && rootLotRequired(tender, bidSources.length)
    ? canonicalId(procurementId, "lot", "root")
    : null;

  const lotBySourceId = new Map<string, string>();
  const lots: CanonicalLot[] = sourceLots.map((raw, index) => {
    const rawId = sourceId(raw, `lot-${index + 1}`);
    const id = canonicalId(procurementId, "lot", rawId);
    lotBySourceId.set(rawId, id);
    const source: InputSource = { raw, source: "prozorro-tender", path: `tender.data.lots[${index}]`, fetchedAt: tenderFetchedAt };
    return {
      id,
      procurementId,
      sourceLotId: rawId,
      kind: "source-lot",
      title: sourced(source, "title", text),
      description: sourced(source, "description", text),
      status: sourced(source, "status", text),
      value: sourced(source, "value", money),
      itemIds: [],
      bidIds: [],
      awardIds: [],
      provenance: [provenance(source)],
      confidence: sourceConfidence,
    };
  });
  if (rootLotId) {
    lots.push({
      id: rootLotId,
      procurementId,
      sourceLotId: null,
      kind: "root-lot",
      title: derived("Whole procurement", procurementId, "derived.root-lot.title", tenderFetchedAt, "A no-lot competitive procurement has one canonical root lot"),
      description: derived("Canonical lot for a competitive procedure without source lots", procurementId, "derived.root-lot.description", tenderFetchedAt, "Preserves lot-level bid and award relationships without inventing source data"),
      status: derived(text(tender.status) ?? "unknown", procurementId, "derived.root-lot.status", tenderFetchedAt, "Root lot inherits procurement status"),
      value: derived(money(tender.value) ?? { amount: 0, amountNet: null, currency: null, valueAddedTaxIncluded: null }, procurementId, "derived.root-lot.value", tenderFetchedAt, "Root lot inherits the whole-procurement value"),
      itemIds: [],
      bidIds: [],
      awardIds: [],
      provenance: [derivedProvenance(procurementId, "derived.root-lot", tenderFetchedAt)],
      confidence: highDerivedConfidence,
    });
  }

  const items: CanonicalItem[] = objects(tender.items).map((raw, index) => {
    const rawId = sourceId(raw, `item-${index + 1}`);
    const id = canonicalId(procurementId, "item", rawId);
    const relatedLot = reference(raw, "relatedLot", "lotID", "lotId");
    const lotId = relatedLot ? lotBySourceId.get(relatedLot) ?? null : rootLotId;
    if (relatedLot && !lotId) warnings.push({
      code: "unknown-lot-reference",
      message: `Item ${rawId} references unknown lot ${relatedLot}`,
      sourcePath: `tender.data.items[${index}].relatedLot`,
    });
    const source: InputSource = { raw, source: "prozorro-tender", path: `tender.data.items[${index}]`, fetchedAt: tenderFetchedAt };
    return {
      id,
      procurementId,
      lotId,
      sourceItemId: rawId,
      description: sourced(source, "description", text),
      classification: sourced(source, "classification", classification),
      quantity: sourced(source, "quantity", numeric),
      unitCode: isObject(raw.unit)
        ? sourced({ ...source, raw: raw.unit, path: `${source.path}.unit` }, "code", text)
        : sourced(source, "unit", text),
      deliveryDate: sourced(source, "deliveryDate", period),
      deliveryAddress: sourced(source, "deliveryAddress", address),
      provenance: [provenance(source)],
      confidence: sourceConfidence,
    };
  });
  for (const item of items) {
    const lot = lots.find((candidate) => candidate.id === item.lotId);
    if (lot) lot.itemIds.push(item.id);
  }

  const bidBySourceId = new Map<string, string>();
  const bids: CanonicalBid[] = bidSources.map((entry, index) => {
    const rawId = sourceId(entry.raw, `bid-${index + 1}`);
    const id = canonicalId(procurementId, "bid", rawId);
    bidBySourceId.set(rawId, id);
    const source: InputSource = { raw: entry.raw, source: "prozorro-tender", path: entry.path, fetchedAt: tenderFetchedAt };
    const lotValues = objects(entry.raw.lotValues).flatMap((rawLotValue, lotValueIndex) => {
      const relatedLot = reference(rawLotValue, "relatedLot", "lotID", "lotId");
      const lotId = relatedLot ? lotBySourceId.get(relatedLot) : rootLotId;
      if (!lotId) {
        if (relatedLot) warnings.push({
          code: "unknown-lot-reference",
          message: `Bid ${rawId} references unknown lot ${relatedLot}`,
          sourcePath: `${entry.path}.lotValues[${lotValueIndex}]`,
        });
        return [];
      }
      const lotValueSource: InputSource = {
        raw: rawLotValue,
        source: "prozorro-tender",
        path: `${entry.path}.lotValues[${lotValueIndex}]`,
        fetchedAt: tenderFetchedAt,
      };
      return [{ lotId, value: sourced(lotValueSource, "value", money) }];
    });
    const implicitLotId = entry.implicitLot ? lotBySourceId.get(entry.implicitLot) ?? null : rootLotId;
    if (!lotValues.length && implicitLotId) lotValues.push({ lotId: implicitLotId, value: sourced(source, "value", money) });
    const lotIds = [...new Set(lotValues.map((entryValue) => entryValue.lotId))];
    return {
      id,
      procurementId,
      sourceBidId: rawId,
      status: sourced(source, "status", text),
      date: sourced(source, "date", text),
      tenderers: parties(entry.raw.tenderers, `${id}:tenderer`),
      lotIds,
      lotValues,
      value: sourced(source, "value", money),
      awardIds: [],
      provenance: [provenance(source)],
      confidence: sourceConfidence,
    };
  });
  for (const bid of bids) {
    for (const lotId of bid.lotIds) lots.find((candidate) => candidate.id === lotId)?.bidIds.push(bid.id);
  }

  const nestedAwards = bidSources.flatMap((bidEntry) => objects(bidEntry.raw.awards).map((raw, index) => ({
    raw,
    path: `${bidEntry.path}.awards[${index}]`,
    implicitBid: sourceId(bidEntry.raw, "unknown-bid"),
    implicitLot: bidEntry.implicitLot,
  })));
  const topAwards = objects(tender.awards).map((raw, index) => ({
    raw,
    path: `tender.data.awards[${index}]`,
    implicitBid: null as string | null,
    implicitLot: null as string | null,
  }));
  const awardSources = [...topAwards, ...nestedAwards].filter((candidate, index, all) => {
    const id = text(candidate.raw.id);
    return !id || all.findIndex((other) => text(other.raw.id) === id) === index;
  });
  const awardBySourceId = new Map<string, string>();
  const awards: CanonicalAward[] = awardSources.map((entry, index) => {
    const rawId = sourceId(entry.raw, `award-${index + 1}`);
    const id = canonicalId(procurementId, "award", rawId);
    awardBySourceId.set(rawId, id);
    const source: InputSource = { raw: entry.raw, source: "prozorro-tender", path: entry.path, fetchedAt: tenderFetchedAt };
    const rawBidId = reference(entry.raw, "bid_id", "bidID", "bidId") ?? entry.implicitBid;
    const bidId = rawBidId ? bidBySourceId.get(rawBidId) ?? null : null;
    if (rawBidId && !bidId) warnings.push({
      code: "unknown-bid-reference",
      message: `Award ${rawId} references unknown bid ${rawBidId}`,
      sourcePath: `${entry.path}.bid_id`,
    });
    const rawLotId = reference(entry.raw, "lotID", "relatedLot", "lotId") ?? entry.implicitLot;
    const lotId = rawLotId ? lotBySourceId.get(rawLotId) ?? null : rootLotId;
    if (rawLotId && !lotId) warnings.push({
      code: "unknown-lot-reference",
      message: `Award ${rawId} references unknown lot ${rawLotId}`,
      sourcePath: `${entry.path}.lotID`,
    });
    const reasonKey = ["description", "title", "terminationDetails"].find((key) => own(entry.raw, key)) ?? "description";
    return {
      id,
      procurementId,
      sourceAwardId: rawId,
      lotId,
      bidId,
      status: sourced(source, "status", text),
      date: sourced(source, "date", text),
      value: sourced(source, "value", money),
      suppliers: parties(entry.raw.suppliers, `${id}:supplier`),
      qualified: sourced(source, "qualified", boolean),
      eligible: sourced(source, "eligible", boolean),
      disqualificationReason: sourced(source, reasonKey, text),
      contractIds: [],
      provenance: [provenance(source)],
      confidence: sourceConfidence,
    };
  });
  for (const award of awards) {
    if (award.bidId) bids.find((candidate) => candidate.id === award.bidId)?.awardIds.push(award.id);
    if (award.lotId) lots.find((candidate) => candidate.id === award.lotId)?.awardIds.push(award.id);
  }

  const tenderContractSources = objects(tender.contracts).map((raw, index): InputSource => ({
    raw,
    source: "prozorro-tender",
    path: `tender.data.contracts[${index}]`,
    fetchedAt: tenderFetchedAt,
  }));
  const externalContractSources = contractInputs(contracting, contractingFetchedAt);
  const contractGroups = new Map<string, InputSource[]>();
  const groupKey = (source: InputSource, index: number) => reference(source.raw, "id", "contractID")
    ?? reference(source.raw, "awardID", "awardId")
    ?? `contract-${index + 1}`;
  for (const [index, source] of [...tenderContractSources, ...externalContractSources].entries()) {
    const key = groupKey(source, index);
    const existingKey = [...contractGroups.entries()].find(([, group]) => group.some((candidate) => {
      const ids = [reference(candidate.raw, "id", "contractID"), reference(candidate.raw, "awardID", "awardId")].filter(Boolean);
      return ids.includes(reference(source.raw, "id", "contractID")) || ids.includes(reference(source.raw, "awardID", "awardId"));
    }))?.[0] ?? key;
    const group = contractGroups.get(existingKey) ?? [];
    group.push(source);
    contractGroups.set(existingKey, group);
  }

  const changes: CanonicalChange[] = [];
  const payments: CanonicalPayment[] = [];
  const contracts: CanonicalContract[] = [...contractGroups.entries()].map(([fallbackId, unsortedSources], contractIndex) => {
    const sources = [...unsortedSources].sort((left) => left.source === "prozorro-contracting" ? -1 : 1);
    const rawId = sources.map((source) => reference(source.raw, "id", "contractID")).find(Boolean) ?? fallbackId;
    const id = canonicalId(procurementId, "contract", rawId);
    const rawAwardId = sources.map((source) => reference(source.raw, "awardID", "awardId")).find(Boolean) ?? null;
    const awardId = rawAwardId ? awardBySourceId.get(rawAwardId) ?? null : null;
    if (rawAwardId && !awardId) warnings.push({
      code: "unknown-award-reference",
      message: `Contract ${rawId} references unknown award ${rawAwardId}`,
      sourcePath: `${sources[0].path}.awardID`,
    });
    const award = awardId ? awards.find((candidate) => candidate.id === awardId) : null;
    const changeIds: string[] = [];
    const seenChanges = new Set<string>();
    for (const contractSource of sources) {
      for (const [changeIndex, rawChange] of objects(contractSource.raw.changes).entries()) {
        const rawChangeId = sourceId(rawChange, `change-${contractIndex + 1}-${changeIndex + 1}`);
        if (seenChanges.has(rawChangeId)) continue;
        seenChanges.add(rawChangeId);
        const changeId = canonicalId(id, "change", rawChangeId);
        const changeSource: InputSource = {
          raw: rawChange,
          source: contractSource.source,
          path: `${contractSource.path}.changes[${changeIndex}]`,
          fetchedAt: contractSource.fetchedAt,
        };
        const modificationsKey = own(rawChange, "modifications") ? "modifications" : "modification";
        changes.push({
          id: changeId,
          procurementId,
          contractId: id,
          sourceChangeId: rawChangeId,
          status: sourced(changeSource, "status", text),
          date: sourced(changeSource, "date", text),
          dateSigned: sourced(changeSource, "dateSigned", text),
          rationale: sourced(changeSource, "rationale", text),
          rationaleTypes: Array.isArray(rawChange.rationaleTypes) ? rawChange.rationaleTypes.map(text).filter((value): value is string => Boolean(value)) : [],
          contractNumber: sourced(changeSource, "contractNumber", text),
          modifications: sourced(changeSource, modificationsKey, (value) => isObject(value) ? value : null),
          provenance: [provenance(changeSource)],
          confidence: sourceConfidence,
        });
        changeIds.push(changeId);
      }
    }
    const amountPaid = firstSourced(sources, "amountPaid", money);
    const paymentIds: string[] = [];
    if (amountPaid.sourceState === "value" && amountPaid.value) {
      const paymentId = canonicalId(id, "payment", "reported-total");
      const dateSource = sources.find((source) => own(source.raw, "dateModified")) ?? sources[0];
      payments.push({
        id: paymentId,
        procurementId,
        contractId: id,
        kind: "reported-total",
        amount: amountPaid,
        reportedAt: dateSource ? sourced(dateSource, "dateModified", text) : firstSourced([], "dateModified", text),
        provenance: [amountPaid.provenance],
        confidence: sourceConfidence,
      });
      paymentIds.push(paymentId);
    }
    return {
      id,
      procurementId,
      sourceContractId: rawId,
      contractNumber: firstSourced(sources, "contractNumber", text),
      awardId,
      lotId: award?.lotId ?? rootLotId,
      status: firstSourced(sources, "status", text),
      dateSigned: firstSourced(sources, "dateSigned", text),
      period: firstSourced(sources, "period", period),
      value: firstSourced(sources, "value", money),
      amountPaid,
      terminationDetails: firstSourced(sources, "terminationDetails", text),
      suppliers: sources.map((source) => parties(source.raw.suppliers, `${id}:supplier`)).find((value) => value.length > 0) ?? award?.suppliers ?? [],
      changeIds,
      paymentIds,
      provenance: sources.map((source) => provenance(source)),
      confidence: sourceConfidence,
    };
  });
  for (const contract of contracts) {
    if (contract.awardId) awards.find((candidate) => candidate.id === contract.awardId)?.contractIds.push(contract.id);
  }

  const publicationDateKey = own(tender, "datePublished") ? "datePublished" : "date";
  const procurement = {
    id: procurementId,
    tenderId,
    status: sourced(tenderSource, "status", text),
    procurementMethod: sourced(tenderSource, "procurementMethod", text),
    procurementMethodType: sourced(tenderSource, "procurementMethodType", text),
    mainProcurementCategory: sourced(tenderSource, "mainProcurementCategory", text),
    title: sourced(tenderSource, "title", text),
    description: sourced(tenderSource, "description", text),
    value: sourced(tenderSource, "value", money),
    tenderPeriod: sourced(tenderSource, "tenderPeriod", period),
    auctionPeriod: sourced(tenderSource, "auctionPeriod", period),
    guarantee: sourced(tenderSource, "guarantee", money),
    paymentTerms: sourced(tenderSource, "milestones", objectList),
    datePublished: sourced(tenderSource, publicationDateKey, text),
    dateModified: sourced(tenderSource, "dateModified", text),
    buyer: sourced(tenderSource, "procuringEntity", (value) => party(value, `${procurementId}:buyer`)),
    lotIds: lots.map((lot) => lot.id),
    itemIds: items.map((item) => item.id),
    bidIds: bids.map((bid) => bid.id),
    awardIds: awards.map((award) => award.id),
    contractIds: contracts.map((contract) => contract.id),
    provenance: [provenance(tenderSource)],
    confidence: sourceConfidence,
  };

  return {
    schemaVersion: SCHEMA_VERSION,
    importedAt,
    procurements: [procurement],
    lots,
    items,
    bids,
    awards,
    contracts,
    changes,
    payments,
    warnings,
  };
}

export const prozorroAnalyticsSchemaVersion = SCHEMA_VERSION;
