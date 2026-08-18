export type Direction =
  | "Капбудівництво"
  | "Сервіс"
  | "Кондиціонування"
  | "Інше";

export type TerritoryStatus = "target" | "outside" | "unknown" | "nationwide";
export type TerritorySource = "delivery-address" | "delivery-description" | "title" | "organizer-fallback" | "profile" | "unknown";
export type CoverageStatus = "seen" | "missed" | "review" | "untracked";

/** Групи статусів довідника «База» робочого файлу закупівлі.xlsx. */
export type StatusGroup =
  | "in-progress"
  | "won"
  | "lost"
  | "declined"
  | "deadline-missed"
  | "cancelled"
  | "none"
  | "unrecognised";

export type InternalTender = {
  id: number;
  deadline: string | null;
  title: string;
  buyer: string;
  buyerEdrpou: string;
  value: number;
  qualification: string;
  estimateNotes: string;
  decision: string;
  comment: string;
  /** Точний текст статусу з файлу; для порожньої клітинки — «Без статусу». */
  status: string;
  statusCode: string;
  statusGroup: StatusGroup;
  ourOffer: number | null;
  auctionOffer: number | null;
  winnerValue: number | null;
  participants: string[];
  direction: Direction;
  /** Причина рішення з довідника «КОМЕНТАРІЙ ДЛЯ ДОПИСУ», а не здогад за текстом. */
  reason: string;
  reasonCode: string;
};

export type MonthlyPoint = {
  month: string;
  count: number;
  value: number;
};

export type SnapshotSummary = {
  totalCount: number;
  totalValue: number;
  /** Активні за визначенням директора: аналіз, підготовка, подано, кваліфікація, скарги від нас. */
  inWork: number;
  /** Дійшли щонайменше до подачі документів або мають записану нашу цінову пропозицію. */
  participated: number;
  /** «Обрані переможцем». */
  awarded: number;
  /** «Укладено договір». */
  contracted: number;
  /** Виграні щонайменше на етапі визначення переможця: awarded + contracted. */
  wins: number;
  /** «Інший переможець» і «Дискваліфіковано» — програні, а не виграні. */
  lost: number;
  /** «Відмова від участі» — свідоме рішення не брати участь. */
  declined: number;
  /** «Не встигли» — подачу пропущено. Не плутати з ринковим статусом missed. */
  deadlineMissed: number;
  /** Скасовано, не відбулась, переоголошено, всіх дискваліфіковано. */
  cancelled: number;
  withoutStatus: number;
  /** Статуси, яких немає в довіднику «База» — сигнал розбіжності файлу і коду. */
  unrecognisedStatus: number;
  medianValue: number;
  statusCounts: Array<{ name: string; value: number }>;
  reasonCounts: Array<{ name: string; value: number }>;
  directionCounts: Array<{ name: Direction; value: number }>;
  monthly: MonthlyPoint[];
};

export type InternalSnapshot = {
  exportedAt: string;
  source: string;
  /** Напрямок, реєстром якого є цей файл. Визначає походження, а не текст назв. */
  registry: {
    direction: Exclude<Direction, "Інше">;
    note: string;
  };
  summary: SnapshotSummary;
  tenders: InternalTender[];
};

/** Фази воронки з довідника «Аркуш2» файлу ПЕРЕЛІК-BITRIX. */
export type PipelinePhase = "preparation" | "tender" | "delivery" | "archive" | "mixed";

export type PipelineProject = {
  row: number;
  /** Внутрішній код об'єкта з реєстрової назви, напр. «26038». */
  code: string;
  registryName: string;
  workingName: string;
  /** Порожньо, якщо у файлі стоїть «?» або прочерк — це не призначений відповідальний. */
  responsible: string;
  foreman: string;
  stage: string;
  stageCode: string;
  phase: PipelinePhase;
  phaseLabel: string;
  active: boolean;
  /** false — код стадії відсутній у довіднику «Аркуш2»; сигнал розбіжності. */
  canonicalStage: boolean;
  tag: string;
  channel: string;
  budget: number | null;
  donePercent: number | null;
  plannedPercent: number | null;
  factRevenue: number | null;
  tenderUrl: string;
  smartTenderId: string | null;
};

export type DeliveryProject = {
  row: number;
  title: string;
  note: string;
  contractValue: number | null;
  /** Виконавець за договором: СС, ФОП тощо. */
  entity: string;
  budget: number | null;
  /** Вільний текст без довідника у файлі — не групується у вигадані категорії. */
  status: string;
  manager: string;
  tenderUrl: string;
  smartTenderId: string | null;
};

export type ProjectsSnapshot = {
  exportedAt: string;
  source: string;
  available: { pipeline: boolean; delivery: boolean };
  summary: {
    pipelineCount: number;
    pipelineActive: number;
    pipelineBudget: number;
    activeBudget: number;
    withResponsible: number;
    withoutResponsible: number;
    unrecognisedStages: number;
    phases: Array<{
      phase: PipelinePhase;
      label: string;
      count: number;
      budget: number;
      stages: Array<{ name: string; value: number }>;
    }>;
    owners: Array<{ name: string; total: number; active: number; budget: number }>;
    deliveryCount: number;
    deliveryContracted: number;
    deliveryContractValue: number;
    deliveryWithoutValue: number;
    deliveryLinked: number;
    deliveryStatuses: Array<{ name: string; value: number }>;
    deliveryEntities: Array<{ name: string; value: number }>;
    deliveryManagers: Array<{ name: string; value: number }>;
  };
  pipeline: PipelineProject[];
  delivery: DeliveryProject[];
};

export type SharePointSync = {
  state: "live" | "snapshot" | "error";
  configured: boolean;
  refreshedAt: string;
  fileModifiedAt: string;
  nextRefreshAt: string | null;
  intervalMinutes: 15;
  records: number;
  message: string;
};

export type LiveTender = {
  id: string;
  cdbNumber: string;
  title: string;
  publishedAt: string | null;
  modifiedAt: string | null;
  deadline: string | null;
  status: string;
  method: string;
  amount: number;
  currency: string;
  buyer: string;
  buyerEdrpou: string;
  cpv: string[];
  delivery: string;
  organizerRegion: string;
  deliveryRegions: string[];
  territoryStatus: TerritoryStatus;
  territoryLabel: string;
  territorySource: TerritorySource;
  direction: Direction;
  relevance: number;
  relevanceLabel: "Висока" | "Середня" | "Низька";
  prozorroUrl: string;
};

export type LivePulse = {
  fetchedAt: string;
  status: "online" | "degraded";
  message: string;
  scanned: number;
  relevant: number;
  highPriority: number;
  totalValue: number;
  tenders: LiveTender[];
};

export type WorkRisk = "Критично" | "Високий" | "Контроль";

export type OwnerWorkItem = {
  id: number;
  title: string;
  buyer: string;
  direction: Direction;
  deadline: string | null;
  value: number;
  stage: string;
  responsible: string;
  nextAction: string;
  readiness: number;
  risk: WorkRisk;
};

export type OwnerDecision = {
  id: number;
  title: string;
  value: number;
  deadline: string | null;
  decision: string;
  reason: string;
  urgency: WorkRisk;
};

export type CrmAction = {
  id: string;
  title: string;
  stage: string;
  responsible: string;
  projectOwner: string;
  deadline: string | null;
  value: number;
  note: string;
};

export type CrmPipeline = {
  id: "construction" | "conditioning" | "service";
  name: string;
  direction: Direction;
  observedAt: string;
  sourceUrl: string;
  stages: Array<{ name: string; count: number; value: number }>;
  actions: CrmAction[];
};

export type OwnerControl = {
  generatedAt: string;
  today: string;
  active: { count: number; value: number };
  dueToday: { count: number; value: number };
  due72h: { count: number; value: number };
  preparing: { count: number; value: number };
  complaints: { count: number; value: number };
  unclassified: { count: number; value: number };
  workNow: OwnerWorkItem[];
  decisions: OwnerDecision[];
  crm: {
    observedAt: string;
    mode: "snapshot";
    note: string;
    pipelines: CrmPipeline[];
  };
  dataQuality: {
    sourceUpdatedAt: string;
    recordsWithoutStatus: number;
    recordsWithParticipants: number;
    participantCoverage: number;
    hasAssigneeField: boolean;
    hasUpdatedAtField: boolean;
  };
};

export type CompetitorConfidence = "Висока" | "Середня" | "Discovery";

export type CompetitorRadarItem = {
  name: string;
  aliases: string[];
  directions: Direction[];
  encounters: number;
  exposure: number;
  lastSeen: string | null;
  sources: string[];
  confidence: CompetitorConfidence;
  revenue2025: number | null;
  growth: number | null;
  tenderSales2025: number | null;
};

export type CompetitorRadar = {
  total: number;
  fromInternal: number;
  discoveries: number;
  participantCoverage: number;
  byDirection: Array<{ name: Direction; value: number }>;
  items: CompetitorRadarItem[];
};

export type MarketCoverageTender = {
  id: string;
  cdbNumber: string;
  cpvCode: string;
  title: string;
  buyer: string;
  buyerEdrpou: string;
  publishedAt: string;
  deadline: string | null;
  amount: number;
  status: string;
  direction: Direction;
  relevanceReason: string;
  prozorroUrl: string;
  actionable: boolean;
  seenByTeam: boolean;
  teamSource: string | null;
  matchedInternalId: number | null;
  coverageStatus: CoverageStatus;
  coverageNote: string;
  organizerRegion: string;
  deliveryRegions: string[];
  territoryStatus: TerritoryStatus;
  territoryLabel: string;
  territorySource: TerritorySource;
};

/**
 * Те, що реально доїжджає до браузера. Службові поля (CPV, ЄДРПОУ замовника,
 * привід релевантності, джерело збігу) потрібні лише серверу, тому клієнтський
 * тип не має їх обіцяти — інакше однієї помилки достатньо, щоб читати undefined.
 */
export type MarketCoverageTenderView = Pick<
  MarketCoverageTender,
  | "id" | "cdbNumber" | "title" | "buyer" | "publishedAt" | "deadline" | "amount"
  | "direction" | "prozorroUrl" | "actionable" | "seenByTeam"
  | "coverageStatus" | "coverageNote" | "territoryStatus" | "territoryLabel"
>;

export type MarketCoverageSummary = {
  market: number;
  seen: number;
  missed: number;
  needsReview: number;
  untracked: number;
  unavailable: number;
  outsideScope: number;
  unknownTerritory: number;
  marketValue: number;
  seenValue: number;
  missedValue: number;
  needsReviewValue: number;
  untrackedValue: number;
  unavailableValue: number;
  outsideScopeValue: number;
  unknownTerritoryValue: number;
};

export type MarketCoveragePoint = MarketCoverageSummary & {
  date: string;
  byDirection: Record<Exclude<Direction, "Інше">, MarketCoverageSummary>;
};

export type MarketCoverageSnapshotView = Omit<MarketCoverageSnapshot, "tenders"> & {
  tenders: MarketCoverageTenderView[];
};

export type MarketCoverageSnapshot = {
  generatedAt: string;
  source: string;
  method: string;
  startDate: string;
  endDate: string;
  scanned: number;
  failures: Array<{ id: string; error: string }>;
  profileCoverage: {
    scope: string;
    limitation: string;
  };
  daily: MarketCoveragePoint[];
  /** Що саме залишено у зрізі, а що відкинуто — щоб обрізання не було мовчазним. */
  retention?: {
    openTotal: number;
    openRetained: number;
    closedTotal: number;
    closedRetained: number;
    closedDropped: number;
    note: string;
  };
  tenders: MarketCoverageTender[];
};
