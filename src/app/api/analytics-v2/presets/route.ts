import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { sessionAccount, sessionCookie, isSameOriginRequest } from "@/lib/auth";
import {
  createAnalyticsPreset,
  deleteAnalyticsPreset,
  listAnalyticsPresets,
  updateAnalyticsPreset,
} from "@/lib/analytics-v2-presets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILTER_BYTES = 16_384;

async function viewer() {
  const cookieStore = await cookies();
  const account = sessionAccount(cookieStore.get(sessionCookie.name)?.value);
  return account?.role === "employee" ? null : account;
}

function parseBody(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.trim().replace(/\s+/g, " ").slice(0, 60) : "";
  const filters = body.filters;
  if (!name || !filters || typeof filters !== "object" || Array.isArray(filters)) return null;
  const serialized = JSON.stringify(filters);
  if (Buffer.byteLength(serialized, "utf8") > MAX_FILTER_BYTES) return null;
  return { name, filters: filters as Record<string, unknown> };
}

export async function GET() {
  const account = await viewer();
  if (!account) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const items = await listAnalyticsPresets(account.id);
  return NextResponse.json(
    { storage: items ? "database" : "browser", items: items ?? [] },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function POST(request: Request) {
  const account = await viewer();
  if (!account) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const parsed = parseBody(await request.json().catch(() => null));
  if (!parsed) return NextResponse.json({ error: "Invalid preset" }, { status: 400 });
  try {
    const item = await createAnalyticsPreset(account.id, parsed.name, parsed.filters);
    if (!item) return NextResponse.json({ error: "Database is not configured", storage: "browser" }, { status: 503 });
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && /unique/i.test(error.message)) {
      return NextResponse.json({ error: "Preset name already exists" }, { status: 409 });
    }
    throw error;
  }
}

export async function PATCH(request: Request) {
  const account = await viewer();
  if (!account) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const id = typeof body?.id === "string" ? body.id.trim() : "";
  const parsed = parseBody(body);
  if (!id || id.length > 100 || !parsed) return NextResponse.json({ error: "Invalid preset" }, { status: 400 });
  const item = await updateAnalyticsPreset(account.id, id, parsed.name, parsed.filters);
  if (item === null) return NextResponse.json({ error: "Database is not configured", storage: "browser" }, { status: 503 });
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ item });
}

export async function DELETE(request: Request) {
  const account = await viewer();
  if (!account) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const id = new URL(request.url).searchParams.get("id")?.trim() ?? "";
  if (!id || id.length > 100) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  const deleted = await deleteAnalyticsPreset(account.id, id);
  if (deleted === null) return NextResponse.json({ error: "Database is not configured", storage: "browser" }, { status: 503 });
  if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}
