import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { sessionAccount, sessionCookie } from "@/lib/auth";
import { hasTrustedMutationOrigin } from "@/lib/request-security";
import { syncAnalyticsV2 } from "@/lib/analytics-v2-sync";
import { loadTenderWorkspace, updateTenderWorkItem } from "@/lib/tender-workspace-store";
import type { TenderWorkspacePatch } from "@/lib/tender-workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const headers = { "Cache-Control": "private, no-store" };

async function authenticatedAccount() {
  const cookieStore = await cookies();
  return sessionAccount(cookieStore.get(sessionCookie.name)?.value);
}

export async function GET() {
  const account = await authenticatedAccount();
  if (!account) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  if (!account.tenderWorkspaceAccess || account.direction !== "Кондиціонування") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers });
  }
  try {
    const payload = await loadTenderWorkspace(account);
    return NextResponse.json(payload, { headers });
  } catch (error) {
    return NextResponse.json({
      error: "Tender workspace is unavailable",
      message: error instanceof Error ? error.message : "Unknown error",
    }, { status: 503, headers });
  }
}

export async function PATCH(request: Request) {
  const account = await authenticatedAccount();
  if (!account) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  if (!hasTrustedMutationOrigin(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403, headers });
  if (!account.tenderWorkspaceAccess || account.direction !== "Кондиціонування") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers });
  }
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid patch" }, { status: 400, headers });
  const raw = body as Record<string, unknown>;
  if (typeof raw.id !== "string" || raw.id.length > 200 || !Number.isSafeInteger(raw.version)) {
    return NextResponse.json({ error: "Invalid item identity" }, { status: 400, headers });
  }
  const patch: TenderWorkspacePatch = { id: raw.id, version: Number(raw.version) };
  if (typeof raw.participationDecision === "string") patch.participationDecision = raw.participationDecision as TenderWorkspacePatch["participationDecision"];
  if (typeof raw.workflowStatus === "string") patch.workflowStatus = raw.workflowStatus as TenderWorkspacePatch["workflowStatus"];
  if (typeof raw.priority === "string") patch.priority = raw.priority as TenderWorkspacePatch["priority"];
  if (typeof raw.assignedAccountId === "string" || raw.assignedAccountId === null) patch.assignedAccountId = raw.assignedAccountId;
  if (typeof raw.decisionReason === "string" || raw.decisionReason === null) patch.decisionReason = raw.decisionReason;
  if (typeof raw.actionNote === "string" || raw.actionNote === null) patch.actionNote = raw.actionNote;
  if (typeof raw.managerNote === "string" || raw.managerNote === null) patch.managerNote = raw.managerNote;
  if (typeof raw.nextActionAt === "string" || raw.nextActionAt === null) patch.nextActionAt = raw.nextActionAt;
  const result = await updateTenderWorkItem(account, patch);
  const status = result.kind === "updated" ? 200
    : result.kind === "missing" ? 404
      : result.kind === "conflict" ? 409
        : result.kind === "invalid" ? 400
          : 403;
  return NextResponse.json(result, { status, headers });
}

export async function POST(request: Request) {
  const account = await authenticatedAccount();
  if (!account) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  if (!hasTrustedMutationOrigin(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403, headers });
  if (account.tenderWorkspaceAccess !== "manager" || account.direction !== "Кондиціонування") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers });
  }
  try {
    const result = await syncAnalyticsV2();
    return NextResponse.json(result, { status: result.ok ? 200 : 503, headers });
  } catch (error) {
    return NextResponse.json({
      error: "Tender synchronization failed",
      message: error instanceof Error ? error.message : "Unknown error",
    }, { status: 503, headers });
  }
}
