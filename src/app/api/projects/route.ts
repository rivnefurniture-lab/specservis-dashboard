import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { sessionAccount, sessionCookie } from "@/lib/auth";
import { getProjectsData } from "@/lib/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Реєстри проєктів окремим роутом, а не всередині /api/dashboard: це чималий
 * масив, який потрібен лише на своїй сторінці, і тягнути його в кожне
 * оновлення головної немає сенсу.
 */
export async function GET() {
  const cookieStore = await cookies();
  const account = sessionAccount(cookieStore.get(sessionCookie.name)?.value);
  if (!account) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (account.role === "employee") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { projects, projectsSync } = await getProjectsData();
  return NextResponse.json(
    { projects, projectsSync, role: account.role },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
