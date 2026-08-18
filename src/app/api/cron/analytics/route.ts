import { NextResponse } from "next/server";
import { syncAnalyticsV2 } from "@/lib/analytics-v2-sync";
import { hasValidBearerSecret } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Incremental discovery plus official Prozorro tender/contract change feeds. */
export async function GET(request: Request) {
  if (!hasValidBearerSecret(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await syncAnalyticsV2();
    return NextResponse.json(result, {
      status: result.ok ? 200 : 503,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return NextResponse.json({
      error: "Analytics synchronization failed",
      message: error instanceof Error ? error.message : "Unknown error",
    }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
}
