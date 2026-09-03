import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { sessionAccount, sessionCookie, isSameOriginRequest } from "@/lib/auth";
import {
  loadMonitoringV2,
  monitoringConfidenceLevels,
  monitoringReviewStatuses,
  saveMonitoringReview,
} from "@/lib/monitoring-v2-store";
import type { MonitoringV2Filters } from "@/lib/monitoring-v2-types";
import { publishMonitoringRuleEntry } from "@/lib/monitoring-rule-admin";
import { directionsForAccount, expandDirectionGroups, TENDER_DIRECTION_GROUPS } from "@/lib/tender-scope";
import { monitoringWorkbook } from "@/lib/tender-excel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const defaultMonitoringDirections = TENDER_DIRECTION_GROUPS.flatMap((group) => group.directions);

const array = (params: URLSearchParams, name: string) => params.getAll(name)
  .flatMap((value) => value.split(","))
  .map((value) => value.trim())
  .filter(Boolean)
  .slice(0, 100);
const number = (value: string | null) => value && Number.isFinite(Number(value)) ? Number(value) : null;
const date = (value: string | null) => value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;

async function account() {
  const cookieStore = await cookies();
  return sessionAccount(cookieStore.get(sessionCookie.name)?.value);
}

function filtersFrom(request: Request, direction: string | null, isOwner: boolean): MonitoringV2Filters {
  const params = new URL(request.url).searchParams;
  const requestedDirections = expandDirectionGroups(array(params, "direction"));
  const allowed = directionsForAccount(direction);
  const directions = isOwner
    ? requestedDirections.length ? requestedDirections : defaultMonitoringDirections
    : requestedDirections.length ? requestedDirections.filter((item) => allowed.includes(item)) : allowed;
  const sort = params.get("sort");
  const confidence = array(params, "confidence").filter((item) => monitoringConfidenceLevels.includes(item as never));
  const reviewStatuses = array(params, "reviewStatus").filter((item) => monitoringReviewStatuses.includes(item as never));
  return {
    q: params.get("q")?.slice(0, 200) || undefined,
    from: date(params.get("from")),
    to: date(params.get("to")),
    deadlineFrom: date(params.get("deadlineFrom")),
    deadlineTo: date(params.get("deadlineTo")),
    buyer: params.get("buyer")?.slice(0, 200) || undefined,
    directions,
    categories: array(params, "category"),
    procedures: array(params, "procedure"),
    statuses: array(params, "status"),
    cpv: params.get("cpv")?.slice(0, 120) || undefined,
    cpvCodes: array(params, "cpvCode").map((value) => value.replace(/\D/g, "").slice(0, 8)).filter(Boolean),
    cpvIncludeDescendants: params.get("cpvIncludeDescendants") !== "false",
    cpvExclusions: array(params, "cpvExclude"),
    keyword: params.get("keyword")?.slice(0, 200) || undefined,
    confidence: confidence as MonitoringV2Filters["confidence"],
    geography: array(params, "geography"),
    amountMin: number(params.get("amountMin")),
    amountMax: number(params.get("amountMax")),
    participantsMin: number(params.get("participantsMin")),
    participantsMax: number(params.get("participantsMax")),
    reviewStatuses: reviewStatuses as MonitoringV2Filters["reviewStatuses"],
    sort: sort === "deadline" || sort === "amount-desc" || sort === "amount-asc" ? sort : "newest",
    page: Math.max(1, Math.floor(number(params.get("page")) ?? 1)),
    pageSize: Math.min(200, Math.max(20, Math.floor(number(params.get("pageSize")) ?? 50))),
  };
}

export async function GET(request: Request) {
  const startedAt = performance.now();
  const viewer = await account();
  if (!viewer) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const exportRequested = new URL(request.url).searchParams.get("format") === "xlsx";
    const filters = filtersFrom(request, viewer.direction, viewer.role === "owner");
    const exportPageSize = 500;
    if (exportRequested) filters.pageSize = exportPageSize;
    const payload = await loadMonitoringV2(filters, exportRequested ? { maxPageSize: exportPageSize } : undefined);
    if (!payload) return NextResponse.json({ error: "Database is not configured" }, { status: 503 });
    if (exportRequested) {
      const rows = [...payload.rows];
      const pageCount = Math.ceil(payload.total / exportPageSize);
      for (let page = 2; page <= pageCount; page += 1) {
        const next = await loadMonitoringV2({ ...filters, page }, { maxPageSize: exportPageSize, recordsOnly: true });
        if (!next) return NextResponse.json({ error: "Database is not configured" }, { status: 503 });
        rows.push(...next.rows);
      }
      const body = await monitoringWorkbook(rows);
      return new NextResponse(body, {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="monitoring-${new Date().toISOString().slice(0, 10)}.xlsx"`,
          "Cache-Control": "private, no-store",
        },
      });
    }
    console.info("[monitoring-v2] request completed", {
      durationMs: Math.round(performance.now() - startedAt),
      rows: payload.rows.length,
      total: payload.total,
    });
    return NextResponse.json(payload, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("[monitoring-v2] request failed", {
      durationMs: Math.round(performance.now() - startedAt),
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Monitoring is temporarily unavailable" }, {
      status: 503,
      headers: { "Cache-Control": "private, no-store" },
    });
  }
}

export async function PATCH(request: Request) {
  const viewer = await account();
  if (!viewer) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  if (viewer.role === "employee") return NextResponse.json({ error: "Manager access required" }, { status: 403 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (body?.action === "rule-entry") {
    const kinds = ["cpv_include", "cpv_exclude", "term", "brand", "exclusion"] as const;
    const kind = typeof body.kind === "string" && kinds.includes(body.kind as (typeof kinds)[number])
      ? body.kind as (typeof kinds)[number] : null;
    const directionId = typeof body.directionId === "string" ? body.directionId.trim().slice(0, 100) : "";
    const value = typeof body.value === "string" ? body.value.trim().slice(0, 300) : "";
    const allowedDirections = directionsForAccount(viewer.direction);
    if (!kind || !directionId || !value || (viewer.role !== "owner" && !allowedDirections.includes(directionId))) {
      return NextResponse.json({ error: "Invalid rule entry" }, { status: 400 });
    }
    const item = await publishMonitoringRuleEntry({
      id: typeof body.id === "string" ? body.id.trim().slice(0, 300) : "",
      directionId,
      kind,
      value,
      includeDescendants: body.includeDescendants === true,
      fields: Array.isArray(body.fields) ? body.fields.filter((field): field is string => typeof field === "string").slice(0, 10) : [],
      active: body.active !== false,
      priority: Number.isFinite(Number(body.priority)) ? Math.max(0, Math.min(1_000, Number(body.priority))) : 0,
    }, viewer.id);
    if (!item) return NextResponse.json({ error: "Database is not configured" }, { status: 503 });
    return NextResponse.json({ item });
  }
  const procurementId = typeof body?.procurementId === "string" ? body.procurementId.trim().slice(0, 200) : "";
  const lotId = typeof body?.lotId === "string" ? body.lotId.trim().slice(0, 240) : "";
  const directionId = typeof body?.directionId === "string" ? body.directionId.trim().slice(0, 100) : null;
  const status = typeof body?.status === "string" ? body.status : "";
  const comment = typeof body?.comment === "string" ? body.comment.trim().slice(0, 2_000) : null;
  const suggestedValue = typeof body?.suggestedRule === "string" ? body.suggestedRule.trim().slice(0, 300) : "";
  if (!procurementId || !lotId || !monitoringReviewStatuses.includes(status as never)) {
    return NextResponse.json({ error: "Invalid review" }, { status: 400 });
  }
  if (status === "not_relevant" && !comment) {
    return NextResponse.json({ error: "Comment is required when removing a lot from monitoring" }, { status: 400 });
  }
  const item = await saveMonitoringReview({
    procurementId,
    lotId,
    directionId,
    status: status as (typeof monitoringReviewStatuses)[number],
    comment,
    suggestedRuleChange: suggestedValue && directionId ? {
      directionId,
      kind: status === "not_relevant" ? "exclusion" : "term",
      value: suggestedValue,
    } : null,
    reviewedBy: viewer.id,
  });
  if (!item) return NextResponse.json({ error: "Database is not configured" }, { status: 503 });
  return NextResponse.json({ item });
}
