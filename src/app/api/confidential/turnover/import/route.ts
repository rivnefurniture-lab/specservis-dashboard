import { NextResponse } from "next/server";
import { importConfidentialTurnover } from "@/lib/confidential-turnover";
import { hasValidBearerSecret } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  if (!hasValidBearerSecret(request.headers.get("authorization"), process.env.CONFIDENTIAL_IMPORT_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "private, no-store" } });
  }
  const length = Number(request.headers.get("content-length"));
  if (Number.isFinite(length) && length > 2_000_000) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413, headers: { "Cache-Control": "private, no-store" } });
  }
  try {
    const result = await importConfidentialTurnover(await request.json());
    return NextResponse.json({ ok: true, ...result }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({
      error: "Confidential turnover import failed",
      message: error instanceof Error ? error.message : "Unknown error",
    }, { status: 400, headers: { "Cache-Control": "private, no-store" } });
  }
}
