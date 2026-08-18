import "server-only";

/**
 * Спільний клієнт Microsoft Graph у режимі лише читання.
 *
 * Застосунок має дозвіл `Sites.Selected` рівно на один сайт — CRM_Dev. Це
 * навмисно: жодного запису, жодного доступу до решти SharePoint. Усі функції
 * тут виключно читають — у проєкті немає й не має бути коду, який пише в
 * SharePoint.
 */

const DEFAULT_HOSTNAME = "specservis.sharepoint.com";
const DEFAULT_SITE_PATH = "/sites/CRM_Dev";
const DEFAULT_FOLDER = "Tenders/Excels";

export type GraphDriveItem = {
  id: string;
  name: string;
  lastModifiedDateTime?: string;
  size?: number;
  webUrl?: string;
};

export function isGraphConfigured() {
  return Boolean(
    process.env.MICROSOFT_TENANT_ID
    && process.env.MICROSOFT_CLIENT_ID
    && process.env.MICROSOFT_CLIENT_SECRET,
  );
}

/**
 * Токен живе годину. Просити новий на кожен запит — це зайва мережева ходка
 * перед кожним читанням файлу, а саме швидкість читання і робить синхронізацію
 * миттєвою. Тому тримаємо його в пам'яті процесу з запасом у хвилину.
 */
let tokenCache: { value: string; expiresAt: number } | null = null;

export async function graphToken() {
  if (tokenCache && tokenCache.expiresAt > Date.now()) return tokenCache.value;
  const body = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID ?? "",
    client_secret: process.env.MICROSOFT_CLIENT_SECRET ?? "",
    grant_type: "client_credentials",
    scope: "https://graph.microsoft.com/.default",
  });
  const response = await fetch(
    `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID}/oauth2/v2.0/token`,
    { method: "POST", body, cache: "no-store", signal: AbortSignal.timeout(20_000) },
  );
  // Тіло відповіді не логується і не повертається: у ньому може бути відлуння
  // client_secret. Назовні йде тільки код статусу.
  if (!response.ok) throw new Error(`Microsoft token request failed (${response.status})`);
  const payload = await response.json() as { access_token?: string; expires_in?: number };
  if (!payload.access_token) throw new Error("Microsoft token response has no access token");
  const lifetime = (payload.expires_in ?? 3600) * 1000;
  tokenCache = { value: payload.access_token, expiresAt: Date.now() + lifetime - 60_000 };
  return payload.access_token;
}

async function graphFetch(pathname: string, token: string) {
  const response = await fetch(`https://graph.microsoft.com/v1.0${pathname}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Microsoft Graph request failed (${response.status})`);
  return response;
}

let cachedSiteId: string | null = null;

/**
 * Складений ідентифікатор сайту (`host,guid,guid`).
 *
 * Адресувати сайт шляхом `host:/sites/CRM_Dev:` і одразу дописувати
 * `/drive/root:/тека/файл` не можна: Graph не приймає два двокрапкових шляхи в
 * одному запиті й відповідає «Resource not found for the segment 'root:'».
 * Тому шлях сайту один раз перетворюється на ідентифікатор, а вже за ним
 * будуються всі решта запитів.
 */
async function resolveSiteId(token: string) {
  const explicitId = process.env.SHAREPOINT_SITE_ID;
  if (explicitId) return explicitId;
  if (cachedSiteId) return cachedSiteId;
  const hostname = process.env.SHAREPOINT_HOSTNAME ?? DEFAULT_HOSTNAME;
  const sitePath = process.env.SHAREPOINT_SITE_PATH ?? DEFAULT_SITE_PATH;
  const response = await graphFetch(`/sites/${hostname}:${sitePath}?$select=id`, token);
  const site = await response.json() as { id?: string };
  if (!site.id) throw new Error("Microsoft Graph site response has no id");
  cachedSiteId = site.id;
  return site.id;
}

function folderPath() {
  return (process.env.SHAREPOINT_FOLDER ?? DEFAULT_FOLDER).replace(/^\/+|\/+$/g, "");
}

/**
 * Метадані файлу за іменем у робочій теці. Адресація саме за шляхом, а не за
 * пошуком: пошук у Graph індексується із затримкою і після перейменування
 * повертає застарілі результати.
 */
export async function fetchItem(token: string, fileName: string): Promise<GraphDriveItem> {
  const siteId = await resolveSiteId(token);
  const path = `${folderPath()}/${fileName}`.split("/").map(encodeURIComponent).join("/");
  const response = await graphFetch(
    `/sites/${siteId}/drive/root:/${path}?$select=id,name,lastModifiedDateTime,size,webUrl`,
    token,
  );
  return await response.json() as GraphDriveItem;
}

export async function fetchItemContent(token: string, itemId: string) {
  const siteId = await resolveSiteId(token);
  const response = await graphFetch(`/sites/${siteId}/drive/items/${itemId}/content`, token);
  return Buffer.from(await response.arrayBuffer());
}
