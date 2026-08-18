import "server-only";

import { unstable_cache } from "next/cache";
import snapshotJson from "@/data/internal-snapshot.json";
import { fetchItem, fetchItemContent, graphToken, isGraphConfigured } from "@/lib/graph";
import { parseInternalWorkbook } from "@/lib/internal-snapshot-parser.mjs";
import type { InternalSnapshot, SharePointSync } from "@/lib/types";

const CACHE_TAG = "sharepoint-tenders";
const INTERVAL_MINUTES = 15 as const;
// Робочий файл команди, а не копія. Копія «закупівлі копия.xlsx» лишається в тій
// самій теці, але вона заморожена на 05.08 — читати треба саме оригінал.
const DEFAULT_FILE_NAME = "закупівлі.xlsx";

/**
 * Кеш, ключем якого є час зміни самого файлу.
 *
 * На кожен запит ми питаємо в Graph лише метадані — кількасот байтів, близько
 * 150 мс. Якщо час зміни той самий, віддається вже розібраний файл. Щойно
 * хтось зберіг книгу в SharePoint, мітка інша, ключ інший — і наступне
 * відкриття сторінки читає нову версію. Це і є миттєва синхронізація.
 *
 * Кешів два, і обидва потрібні:
 *
 *   • `unstable_cache` — спільний між усіма екземплярами функції. Без нього
 *     кожен «холодний» запуск заново качав би 500 КБ і розбирав книгу
 *     ExcelJS — це близько двох секунд на ровному місці, які платить
 *     користувач.
 *   • пам'ять процесу — щоб теплий екземпляр не ходив навіть у спільний кеш.
 *
 * Інтервального протермінування тут немає навмисно: інтервал означав би, що
 * правка в Excel висить невидимою до кінця вікна.
 */
let internalCache: { stamp: string; snapshot: InternalSnapshot } | null = null;

const readWorkbook = (stamp: string, fileName: string, itemId: string) => unstable_cache(
  async () => {
    const buffer = await fetchItemContent(await graphToken(), itemId);
    return await parseInternalWorkbook(buffer, {
      exportedAt: stamp,
      source: `SharePoint · ${fileName} · Microsoft Graph read-only`,
      registryDirection: "Капбудівництво",
    }) as InternalSnapshot;
  },
  ["specservis-internal-workbook", stamp],
  { tags: [CACHE_TAG] },
)();

/**
 * Дата з часом: «06.08.2026, 00:22».
 *
 * Час тут не косметика. Копія в SharePoint і вбудований зріз бувають зроблені
 * в один календарний день, і без годин повідомлення «копія старша за наш зріз»
 * показувало б дві однакові дати й виглядало б як помилка.
 */
function shortDate(iso: string) {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return iso;
  return new Intl.DateTimeFormat("uk-UA", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
    timeZone: "Europe/Kyiv",
  }).format(new Date(parsed));
}

/**
 * Читає реєстр закупівель із SharePoint. Завантажує сам файл лише тоді, коли
 * час його зміни відрізняється від того, що вже розібрано.
 */
async function fetchLiveSnapshot() {
  const token = await graphToken();
  const fileName = process.env.SHAREPOINT_FILE_NAME ?? DEFAULT_FILE_NAME;
  const item = await fetchItem(token, fileName);
  const refreshedAt = new Date().toISOString();
  const fileModifiedAt = item.lastModifiedDateTime ?? refreshedAt;

  if (internalCache?.stamp === fileModifiedAt) {
    return { snapshot: internalCache.snapshot, fileModifiedAt, refreshedAt, reused: true };
  }

  const snapshot = await readWorkbook(fileModifiedAt, item.name, item.id);
  internalCache = { stamp: fileModifiedAt, snapshot };
  return { snapshot, fileModifiedAt, refreshedAt, reused: false };
}

function bundled() {
  return snapshotJson as InternalSnapshot;
}

function fallbackSnapshot(state: SharePointSync["state"], message: string) {
  const snapshot = bundled();
  return {
    snapshot,
    sharePointSync: {
      state,
      configured: isGraphConfigured(),
      refreshedAt: snapshot.exportedAt,
      fileModifiedAt: snapshot.exportedAt,
      nextRefreshAt: null,
      intervalMinutes: INTERVAL_MINUTES,
      records: snapshot.summary.totalCount,
      message,
    } satisfies SharePointSync,
  };
}

export async function getSharePointData() {
  if (!isGraphConfigured()) {
    return fallbackSnapshot(
      "snapshot",
      "Показано перевірену копію реєстру. Для автооновлення потрібні доступи Microsoft Graph.",
    );
  }
  try {
    const live = await fetchLiveSnapshot();
    const reference = bundled();

    // Найважливіше місце всієї синхронізації.
    //
    // У теці CRM_Dev лежить не робочий файл команди, а його копія, зроблена
    // вручну. Вона може бути старшою за зріз, який уже вбудований у застосунок.
    // Якщо просто взяти те, що віддав Graph, дашборд тихо відкотиться на кілька
    // днів назад: зникнуть закупівлі, які команда встигла опрацювати, і вони
    // знову покажуться як пропущені. Тому з двох джерел завжди береться те, чий
    // файл новіший, і користувачеві прямо пишеться, яке саме показано.
    // Строга нерівність, а не «менше або дорівнює»: коли вбудований зріз
    // зібраний із того самого файлу, часи збігаються — і це не привід оголошувати
    // живе джерело застарілим.
    if (Date.parse(live.fileModifiedAt) < Date.parse(reference.exportedAt)) {
      return fallbackSnapshot(
        "snapshot",
        `Копія в SharePoint (${shortDate(live.fileModifiedAt)}) старша за наш зріз (${shortDate(reference.exportedAt)}), тому показано новіші дані. Автооновлення запрацює, щойно копію в теці оновлять.`,
      );
    }

    return {
      snapshot: live.snapshot,
      sharePointSync: {
        state: "live",
        configured: true,
        refreshedAt: live.refreshedAt,
        fileModifiedAt: live.fileModifiedAt,
        nextRefreshAt: null,
        intervalMinutes: INTERVAL_MINUTES,
        records: live.snapshot.summary.totalCount,
        message: `SharePoint читається наживо, лише читання. Правки у файлі видно одразу. Останні зміни ${shortDate(live.fileModifiedAt)}.`,
      } satisfies SharePointSync,
    };
  } catch (error) {
    console.error("SharePoint sync failed", error instanceof Error ? error.message : "Unknown error");
    return fallbackSnapshot("error", "SharePoint тимчасово недоступний. Показано останню перевірену копію.");
  }
}
