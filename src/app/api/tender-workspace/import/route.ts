import { NextResponse } from "next/server";
import { importTenderWorkbookRows, type TenderWorkbookImportRow } from "@/lib/tender-workspace-store";
import { hasValidBearerSecret } from "@/lib/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const headers = { "Cache-Control": "private, no-store" };

export async function POST(request: Request) {
  if (!hasValidBearerSecret(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  }
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > 2_000_000) {
    return NextResponse.json({ error: "Import payload is too large" }, { status: 413, headers });
  }
  try {
    const body = await request.json() as { rows?: unknown };
    if (!Array.isArray(body.rows) || body.rows.length > 200) {
      return NextResponse.json({ error: "Invalid workbook rows" }, { status: 400, headers });
    }
    const result = await importTenderWorkbookRows(body.rows as TenderWorkbookImportRow[]);
    return NextResponse.json(result, { headers });
  } catch (error) {
    return NextResponse.json({
      error: "Workbook import failed",
      message: error instanceof Error ? error.message : "Unknown error",
    }, { status: 503, headers });
  }
}
