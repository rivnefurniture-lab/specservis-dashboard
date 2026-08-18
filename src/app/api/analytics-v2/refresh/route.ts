import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { sessionAccount, sessionCookie } from "@/lib/auth";
import { syncAnalyticsV2 } from "@/lib/analytics-v2-sync";
import { hasTrustedMutationOrigin } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const account = sessionAccount(cookieStore.get(sessionCookie.name)?.value);
  if (!account) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (account.role !== "owner") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!hasTrustedMutationOrigin(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
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
