import { NextResponse } from "next/server";
import { refreshMarket } from "@/lib/market-refresh";
import { hasValidBearerSecret } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Обхід кількох днів Prozorro триває хвилини, а не секунди.
export const maxDuration = 300;

/** Планове оновлення ринку кожні 3 години. Розклад — у vercel.json. */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!hasValidBearerSecret(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await refreshMarket();
  return NextResponse.json(result, {
    status: result.ok ? 200 : result.reason === "busy" ? 409 : 503,
    headers: { "Cache-Control": "private, no-store" },
  });
}
