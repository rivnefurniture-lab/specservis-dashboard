import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { sessionAccount, sessionCookie } from "@/lib/auth";
import { loadConfidentialTurnover } from "@/lib/confidential-turnover";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const cookieStore = await cookies();
  const account = sessionAccount(cookieStore.get(sessionCookie.name)?.value);
  if (!account) {
    return NextResponse.json({ error: "Unauthorized" }, {
      status: 401,
      headers: { "Cache-Control": "private, no-store" },
    });
  }
  if (!account.financeAccess) {
    return NextResponse.json({ error: "Forbidden" }, {
      status: 403,
      headers: { "Cache-Control": "private, no-store" },
    });
  }

  const dataset = await loadConfidentialTurnover();
  if (!dataset) {
    return NextResponse.json({ error: "Dataset is not available" }, {
      status: 503,
      headers: { "Cache-Control": "private, no-store" },
    });
  }
  return NextResponse.json(dataset, {
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet",
    },
  });
}
