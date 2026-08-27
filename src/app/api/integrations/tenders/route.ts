import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { isSameOriginRequest, sessionAccount, sessionCookie } from "@/lib/auth";
import {
  disableTenderSubscription,
  runTenderIntegrations,
  saveTenderSubscription,
  sendTenderIntegrationTest,
  tenderIntegrationStatus,
} from "@/lib/tender-integrations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function owner() {
  const cookieStore = await cookies();
  const account = sessionAccount(cookieStore.get(sessionCookie.name)?.value);
  return account?.role === "owner" ? account : null;
}

export async function GET() {
  if (!await owner()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await tenderIntegrationStatus(), {
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function POST(request: Request) {
  if (!await owner()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const action = typeof body?.action === "string" ? body.action : "";
  try {
    if (action === "test-email") {
      return NextResponse.json(await sendTenderIntegrationTest(), {
        headers: { "Cache-Control": "private, no-store" },
      });
    }
    if (action === "sync-excel") {
      return NextResponse.json(await runTenderIntegrations({ email: false, excel: true }), {
        headers: { "Cache-Control": "private, no-store" },
      });
    }
    if (action === "run") {
      return NextResponse.json(await runTenderIntegrations(), {
        headers: { "Cache-Control": "private, no-store" },
      });
    }
    if (action === "save-subscription") {
      const recipients = Array.isArray(body?.recipients)
        ? body.recipients.filter((item): item is string => typeof item === "string")
        : typeof body?.recipients === "string" ? body.recipients.split(",") : [];
      const item = await saveTenderSubscription({
        id: typeof body?.id === "string" ? body.id : undefined,
        name: typeof body?.name === "string" ? body.name : "",
        recipients,
        filters: body?.filters && typeof body.filters === "object" && !Array.isArray(body.filters) ? body.filters as Record<string, unknown> : {},
      }, (await owner())!.id);
      return NextResponse.json({ item }, { headers: { "Cache-Control": "private, no-store" } });
    }
    if (action === "delete-subscription") {
      const deleted = typeof body?.id === "string" && await disableTenderSubscription(body.id);
      return NextResponse.json({ deleted }, { status: deleted ? 200 : 404, headers: { "Cache-Control": "private, no-store" } });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({
      error: "Integration action failed",
      message: error instanceof Error ? error.message : "Unknown error",
    }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
}
