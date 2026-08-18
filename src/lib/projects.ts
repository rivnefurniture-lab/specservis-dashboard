import "server-only";

import { unstable_cache } from "next/cache";
import snapshotJson from "@/data/projects-snapshot.json";
import { fetchItem, fetchItemContent, graphToken, isGraphConfigured } from "@/lib/graph";
import { parseProjectWorkbooks } from "@/lib/projects-parser.mjs";
import type { ProjectsSnapshot, SharePointSync } from "@/lib/types";

const CACHE_TAG = "sharepoint-projects";
const INTERVAL_MINUTES = 15 as const;
const DEFAULT_PIPELINE_FILE = "ПЕРЕЛІК-BITRIX копия.xlsx";
const DEFAULT_DELIVERY_FILE = "Реалізація проєктів 1111.xlsx";

/**
 * Ключ кешу — час зміни обох файлів разом. Досить правки в одному з них, щоб
 * ключ став іншим і обидва перечиталися. Див. пояснення в `sharepoint.ts`.
 */
let projectsCache: { stamp: string; snapshot: ProjectsSnapshot } | null = null;

const readWorkbooks = (stamp: string, exportedAt: string, pipelineId: string, deliveryId: string) => unstable_cache(
  async () => {
    const token = await graphToken();
    const [pipeline, delivery] = await Promise.all([
      fetchItemContent(token, pipelineId),
      fetchItemContent(token, deliveryId),
    ]);
    return await parseProjectWorkbooks(
      { pipeline, delivery },
      { exportedAt, source: "SharePoint · CRM_Dev/Tenders/Excels · Microsoft Graph read-only" },
    ) as ProjectsSnapshot;
  },
  ["specservis-projects-workbooks", stamp],
  { tags: [CACHE_TAG] },
)();

function shortDate(iso: string) {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return iso;
  return new Intl.DateTimeFormat("uk-UA", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
    timeZone: "Europe/Kyiv",
  }).format(new Date(parsed));
}

async function fetchLiveProjects() {
  const token = await graphToken();
  const [pipelineItem, deliveryItem] = await Promise.all([
    fetchItem(token, process.env.SHAREPOINT_PIPELINE_FILE ?? DEFAULT_PIPELINE_FILE),
    fetchItem(token, process.env.SHAREPOINT_DELIVERY_FILE ?? DEFAULT_DELIVERY_FILE),
  ]);
  const refreshedAt = new Date().toISOString();
  const stamps = [pipelineItem.lastModifiedDateTime, deliveryItem.lastModifiedDateTime]
    .map((value) => value ?? refreshedAt);
  // Свіжіша з двох дат — це «коли востаннє щось змінилося в проєктах».
  const fileModifiedAt = [...stamps].sort().at(-1) ?? refreshedAt;
  const stamp = stamps.join("|");

  if (projectsCache?.stamp === stamp) {
    return { snapshot: projectsCache.snapshot, fileModifiedAt, refreshedAt, reused: true };
  }

  const snapshot = await readWorkbooks(stamp, fileModifiedAt, pipelineItem.id, deliveryItem.id);
  projectsCache = { stamp, snapshot };
  return { snapshot, fileModifiedAt, refreshedAt, reused: false };
}

function fallbackProjects(state: SharePointSync["state"], message: string) {
  const snapshot = snapshotJson as ProjectsSnapshot;
  return {
    projects: snapshot,
    projectsSync: {
      state,
      configured: isGraphConfigured(),
      refreshedAt: snapshot.exportedAt,
      fileModifiedAt: snapshot.exportedAt,
      nextRefreshAt: null,
      intervalMinutes: INTERVAL_MINUTES,
      records: snapshot.summary.pipelineCount + snapshot.summary.deliveryCount,
      message,
    } satisfies SharePointSync,
  };
}

/**
 * Реєстри проєктів із SharePoint.
 *
 * На відміну від реєстру закупівель, тут вбудована копія зібрана з тих самих
 * файлів, що читає Graph, тому «старша копія» неможлива за побудовою і
 * порівнювати дати не потрібно — свіже читання завжди не гірше за вбудоване.
 */
export async function getProjectsData() {
  if (!isGraphConfigured()) {
    return fallbackProjects(
      "snapshot",
      "Показано перевірену копію реєстрів проєктів. Для автооновлення потрібні доступи Microsoft Graph.",
    );
  }
  try {
    const live = await fetchLiveProjects();
    return {
      projects: live.snapshot,
      projectsSync: {
        state: "live",
        configured: true,
        refreshedAt: live.refreshedAt,
        fileModifiedAt: live.fileModifiedAt,
        nextRefreshAt: null,
        intervalMinutes: INTERVAL_MINUTES,
        records: live.snapshot.summary.pipelineCount + live.snapshot.summary.deliveryCount,
        message: `Реєстри проєктів читаються наживо, лише читання. Правки у файлах видно одразу. Останні зміни ${shortDate(live.fileModifiedAt)}.`,
      } satisfies SharePointSync,
    };
  } catch (error) {
    console.error("Projects sync failed", error instanceof Error ? error.message : "Unknown error");
    return fallbackProjects("error", "SharePoint тимчасово недоступний. Показано останню перевірену копію реєстрів проєктів.");
  }
}
