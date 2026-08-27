export type MonitoringConfidence = "high" | "medium" | "review";
export type MonitoringReviewStatus = "relevant" | "not_relevant" | "needs_review" | "missed";

export type MonitoringV2Filters = {
  q?: string;
  from?: string;
  to?: string;
  deadlineFrom?: string;
  deadlineTo?: string;
  buyer?: string;
  directions?: string[];
  categories?: string[];
  procedures?: string[];
  statuses?: string[];
  cpv?: string;
  cpvCodes?: string[];
  cpvIncludeDescendants?: boolean;
  cpvExclusions?: string[];
  keyword?: string;
  confidence?: MonitoringConfidence[];
  geography?: string[];
  amountMin?: number | null;
  amountMax?: number | null;
  participantsMin?: number | null;
  participantsMax?: number | null;
  reviewStatuses?: MonitoringReviewStatus[];
  sort?: "newest" | "deadline" | "amount-desc" | "amount-asc";
  page?: number;
  pageSize?: number;
};

export type MonitoringReason = {
  kind?: string;
  value?: string;
  label?: string;
  field?: string;
  basis?: string;
};

export type MonitoringV2Row = {
  id: string;
  procurementId: string;
  tenderId: string;
  lotId: string;
  title: string;
  description: string | null;
  buyerId: string | null;
  buyerName: string;
  buyerCode: string | null;
  publishedAt: string | null;
  deadlineAt: string | null;
  category: string | null;
  procedure: string | null;
  status: string | null;
  cpvCodes: string[];
  cpvNames: string[];
  expectedAmount: number | null;
  currency: string | null;
  participantCount: number;
  directions: Array<{ id: string; slug: string; label: string; primary: boolean }>;
  confidence: MonitoringConfidence;
  reasons: MonitoringReason[];
  matchedFields: string[];
  matchedTerms: string[];
  geography: string;
  geographyBasis: string | null;
  needsGeographyReview: boolean;
  deliveryAddress: string | null;
  reviewStatus: MonitoringReviewStatus | null;
  reviewComment: string | null;
  ruleVersion: string | null;
  prozorroUrl: string;
};

export type MonitoringFacet = { value: string; label: string; count?: number };
export type MonitoringCpvNode = MonitoringFacet & { code: string; parentCode: string | null; depth: number };

export type MonitoringRuleEntry = {
  id: string;
  directionId: string;
  directionLabel: string;
  kind: "cpv_include" | "cpv_exclude" | "term" | "brand" | "exclusion";
  value: string;
  includeDescendants: boolean;
  fields: string[];
  active: boolean;
  priority: number;
};

export type MonitoringRuleSuggestion = {
  directionId: string;
  kind: MonitoringRuleEntry["kind"];
  value: string;
  occurrences: number;
  latestComment: string | null;
  latestAt: string;
};

export type MonitoringSyncStream = {
  key: string;
  lastSuccessAt: string | null;
  lastError: string | null;
  failureCount: number;
  cursor: string | null;
  running: boolean;
  expectedEveryMinutes: number;
  lagMinutes: number | null;
  overdue: boolean;
};

export type MonitoringV2Payload = {
  generatedAt: string | null;
  ruleVersion: string | null;
  total: number;
  page: number;
  pageSize: number;
  rows: MonitoringV2Row[];
  facets: {
    directions: MonitoringFacet[];
    categories: MonitoringFacet[];
    procedures: MonitoringFacet[];
    statuses: MonitoringFacet[];
    geography: MonitoringFacet[];
    cpv: MonitoringCpvNode[];
  };
  rules: MonitoringRuleEntry[];
  ruleSuggestions: MonitoringRuleSuggestion[];
  sync: {
    lastSuccessfulAt: string | null;
    maximumLagMinutes: number | null;
    incomplete: boolean;
    queued: number;
    streams: MonitoringSyncStream[];
  };
};
