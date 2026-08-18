import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { sessionAccount, sessionCookie } from "@/lib/auth";
import { competitorDetail, competitorSnapshotMeta, listCompetitors, type CompetitorQuery } from "@/lib/competitors";
import type { Direction } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const directions = new Set<Exclude<Direction, "Інше">>(["Капбудівництво", "Сервіс", "Кондиціонування"]);
const sorts = new Set(["wonValue", "wins", "participations", "winRate", "vsUs"]);

function boundedInteger(value: string | null, fallback: number | undefined, minimum: number, maximum: number) {
  if (!value || !/^\d+$/.test(value)) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? Math.min(Math.max(parsed, minimum), maximum) : fallback;
}

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const account = sessionAccount(cookieStore.get(sessionCookie.name)?.value);
  if (!account) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (account.role === "employee") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const params = new URL(request.url).searchParams;
  const requested = params.get("direction");
  // Керівник бачить ринок лише свого напрямку — те саме правило, що й на решті сторінок.
  const permitted = account.role === "owner"
    ? (requested && directions.has(requested as Exclude<Direction, "Інше">) ? requested as Exclude<Direction, "Інше"> : null)
    : account.direction;

  const sort = params.get("sort");
  const query: CompetitorQuery = {
    days: boundedInteger(params.get("days"), undefined, 1, competitorSnapshotMeta.days),
    direction: permitted,
    territory: params.get("territory") === "target" ? "target" : "all",
    search: (params.get("q") ?? "").trim().slice(0, 120),
    sort: sort && sorts.has(sort) ? sort as CompetitorQuery["sort"] : "wonValue",
    page: boundedInteger(params.get("page"), 1, 1, 10_000),
    limit: boundedInteger(params.get("limit"), 30, 1, 100),
  };

  const requestedCompany = params.get("company");
  if (requestedCompany && requestedCompany.length > 200) {
    return NextResponse.json({ error: "Invalid company" }, { status: 400 });
  }
  const company = requestedCompany?.trim();
  if (company) {
    const detail = competitorDetail(company, query);
    if (!detail) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(detail, { headers: { "Cache-Control": "private, no-store" } });
  }

  return NextResponse.json(listCompetitors(query), { headers: { "Cache-Control": "private, no-store" } });
}
