export type TenderWorkspaceAccess = "manager" | "employee";
export type TenderParticipationDecision = "undecided" | "participate" | "skip" | "partner";
export type TenderWorkflowStatus = "new" | "review" | "preparing" | "submitted" | "qualification" | "won" | "lost" | "contract" | "closed";
export type TenderWorkPriority = "low" | "normal" | "high" | "critical";

export type TenderWorkspaceMember = {
  id: string;
  label: string;
  role: "manager" | "employee";
};

/** Original Excel values kept only for the one-time transition into the web workflow. */
export type TenderWorkbookFields = Partial<{
  smartTenderId: string;
  smartTenderUrl: string;
  prozorroId: string;
  prozorroUrl: string;
  organizer: string;
  parentOrganization: string;
  buyerEdrpou: string;
  region: string;
  city: string;
  subject: string;
  procedure: string;
  classification: string;
  description: string;
  deliveryPlace: string;
  deliveryDeadline: string;
  expectedAmount: string;
  guarantee: string;
  submissionDeadline: string;
  auctionAt: string;
  tenderAction: string;
  unit: string;
  quantity: string;
  unitPrice: string;
  paymentPeriod: string;
  republished: string;
  previousProcurement: string;
  participation: string;
  urgencyNotice: string;
  changes: string;
  questionsComplaints: string;
  monitoringStatus: string;
  lowestBid: string;
  qualificationDay: string;
  winner: string;
  contract: string;
  manager: string;
}>;

export type TenderWorkspaceItem = {
  id: string;
  procurementId: string;
  tenderId: string;
  prozorroUrl: string;
  title: string;
  description: string | null;
  buyerName: string;
  buyerEdrpou: string | null;
  procedureType: string | null;
  sourceStatus: string | null;
  category: string | null;
  cpvCodes: string[];
  publishedAt: string | null;
  submissionDeadline: string | null;
  auctionAt: string | null;
  deliveryDeadline: string | null;
  expectedAmount: number | null;
  currency: string | null;
  guaranteeAmount: number | null;
  paymentTerms: Array<Record<string, unknown>>;
  region: string | null;
  locality: string | null;
  deliveryAddress: string | null;
  quantity: number | null;
  unitCode: string | null;
  unitPrice: number | null;
  lowestBidAmount: number | null;
  lowestBidder: string | null;
  winnerName: string | null;
  winnerAmount: number | null;
  awardDate: string | null;
  contractUrl: string | null;
  contractStatus: string | null;
  contractAmount: number | null;
  workbookTracked: boolean;
  workbookFields: TenderWorkbookFields;
  participationDecision: TenderParticipationDecision;
  workflowStatus: TenderWorkflowStatus;
  priority: TenderWorkPriority;
  assignedAccountId: string | null;
  decisionReason: string | null;
  actionNote: string | null;
  managerNote: string | null;
  nextActionAt: string | null;
  firstSeenAt: string;
  sourceUpdatedAt: string | null;
  updatedAt: string;
  updatedBy: string | null;
  version: number;
};

export type TenderWorkspaceEvent = {
  id: string;
  actorAccountId: string;
  eventType: "created" | "updated" | "source-refresh";
  changedFields: string[];
  createdAt: string;
};

export type TenderWorkspacePayload = {
  direction: "Кондиціонування";
  access: TenderWorkspaceAccess;
  generatedAt: string;
  lastSyncAt: string | null;
  members: TenderWorkspaceMember[];
  items: TenderWorkspaceItem[];
};

export type TenderWorkspacePatch = Partial<Pick<TenderWorkspaceItem,
  | "participationDecision"
  | "workflowStatus"
  | "priority"
  | "assignedAccountId"
  | "decisionReason"
  | "actionNote"
  | "managerNote"
  | "nextActionAt"
>> & { id: string; version: number };
