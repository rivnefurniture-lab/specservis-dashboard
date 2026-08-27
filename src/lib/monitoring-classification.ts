import {
  classifyMonitoringCandidate,
  type MonitoringConfidence,
  type MonitoringRuleSet,
} from "@/lib/monitoring-rules";
import type { ProzorroAnalyticsDataset, SourcedValue } from "@/lib/analytics-v2-schema";

const value = <T>(field: SourcedValue<T>) => field.sourceState === "value" || field.sourceState === "derived" ? field.value : null;

export type PersistedMonitoringMatch = {
  procurementId: string;
  lotId: string;
  directionId: string;
  directionLabel: string;
  ruleSetId: string;
  ruleVersion: string;
  confidence: MonitoringConfidence;
  primary: boolean;
  reasons: Array<{ kind: string; value: string; field: string; confidence: MonitoringConfidence }>;
  matchedFields: string[];
  matchedCpvCodes: string[];
  matchedTerms: string[];
  geographyBasis: "delivery" | "buyer_fallback" | "nationwide" | "unspecified";
  needsGeographyReview: boolean;
  sourceModifiedAt: string | null;
};

export type MonitoringDatasetClassification = {
  ruleSetId: string;
  ruleVersion: string;
  primaryDirections: Record<string, string | null>;
  matches: PersistedMonitoringMatch[];
};

export function classifyMonitoringDataset(
  dataset: ProzorroAnalyticsDataset,
  ruleSet: MonitoringRuleSet,
): MonitoringDatasetClassification {
  const primaryDirections: Record<string, string | null> = {};
  const matches: PersistedMonitoringMatch[] = [];
  for (const procurement of dataset.procurements) {
    const buyer = value(procurement.buyer);
    const lots = dataset.lots.filter((lot) => lot.procurementId === procurement.id);
    const modifiedAt = value(procurement.dateModified);
    for (const lot of lots) {
      const items = dataset.items.filter((item) => item.procurementId === procurement.id && (
        item.lotId === lot.id || (lot.kind === "root-lot" && item.lotId === null)
      ));
      const result = classifyMonitoringCandidate({
        procurementTitle: value(procurement.title) ?? undefined,
        procurementDescription: value(procurement.description) ?? undefined,
        lotTitle: value(lot.title) ?? undefined,
        lotDescription: value(lot.description) ?? undefined,
        itemDescriptions: items.map((item) => value(item.description)).filter((item): item is string => Boolean(item)),
        cpvCodes: items.map((item) => value(item.classification)?.id).filter((item): item is string => Boolean(item)),
      }, ruleSet);
      const primary = result.matches.find((match) => match.primary);
      if (primary && !primaryDirections[procurement.id]) primaryDirections[procurement.id] = primary.directionLabel;
      for (const match of result.matches) {
        const direction = ruleSet.directions.find((item) => item.id === match.directionId);
        const deliveryLocations = items.map((item) => value(item.deliveryAddress)).filter(Boolean);
        const nationwide = direction ? !["construction", "design"].includes(direction.id) : false;
        const buyerFallback = !nationwide && deliveryLocations.length === 0 && Boolean(buyer?.address && (
          buyer.address.region || buyer.address.locality || buyer.address.streetAddress
        ));
        matches.push({
          procurementId: procurement.id,
          lotId: lot.id,
          directionId: match.directionId,
          directionLabel: match.directionLabel,
          ruleSetId: ruleSet.id,
          ruleVersion: result.ruleVersion,
          confidence: match.confidence,
          primary: match.primary,
          reasons: match.reasons,
          matchedFields: [...new Set(match.reasons.map((reason) => reason.field))],
          matchedCpvCodes: [...new Set(match.reasons.filter((reason) => reason.kind === "cpv").map((reason) => reason.value))],
          matchedTerms: [...new Set(match.reasons.filter((reason) => reason.kind !== "cpv").map((reason) => reason.value))],
          geographyBasis: nationwide
            ? "nationwide"
            : deliveryLocations.length
              ? "delivery"
              : buyerFallback ? "buyer_fallback" : "unspecified",
          needsGeographyReview: !nationwide && (buyerFallback || deliveryLocations.length === 0),
          sourceModifiedAt: modifiedAt,
        });
      }
    }
    if (!(procurement.id in primaryDirections)) primaryDirections[procurement.id] = null;
  }
  return { ruleSetId: ruleSet.id, ruleVersion: ruleSet.version, primaryDirections, matches };
}
