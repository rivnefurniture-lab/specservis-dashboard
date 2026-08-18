import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { sessionAccount, sessionCookie } from "@/lib/auth";
import { refreshMarket } from "@/lib/market-refresh";
import { hasTrustedMutationOrigin } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Ручне оновлення ринку кнопкою на сайті.
 *
 * Метод POST, а не GET: це дія, яка змінює збережений зріз, і вона не має
 * запускатися від того, що хтось відкрив посилання або браузер вирішив
 * підвантажити сторінку наперед.
 */
export async function POST(request: Request) {
  const cookieStore = await cookies();
  const account = sessionAccount(cookieStore.get(sessionCookie.name)?.value);
  if (!account) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (account.role !== "owner") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!hasTrustedMutationOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const result = await refreshMarket();
  return NextResponse.json(result, {
    status: result.ok ? 200 : result.reason === "busy" ? 409 : 503,
    headers: { "Cache-Control": "private, no-store" },
  });
}
