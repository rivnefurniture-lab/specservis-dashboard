import { NextResponse } from "next/server";
import { ensureAnalyticsV2Schema } from "@/lib/analytics-v2-migrate";
import { hasValidBearerSecret } from "@/lib/request-security";
import { syncPendingSpendingPayments } from "@/lib/spending-enrichment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!hasValidBearerSecret(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    await ensureAnalyticsV2Schema();
    return NextResponse.json(await syncPendingSpendingPayments(10), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return NextResponse.json({
      error: "Spending sync failed",
      message: error instanceof Error ? error.message : "Unknown error",
    }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
}
