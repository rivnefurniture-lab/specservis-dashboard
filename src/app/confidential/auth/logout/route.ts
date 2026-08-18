import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { isSameOriginRequest, sessionCookie } from "@/lib/auth";
import { confidentialSessionCookie } from "@/lib/confidential-auth";

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const cookieStore = await cookies();
  cookieStore.set(confidentialSessionCookie.name, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: confidentialSessionCookie.path,
    maxAge: 0,
    priority: "high",
  });
  cookieStore.set(sessionCookie.name, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
    priority: "high",
  });
  return NextResponse.redirect(new URL("/login", request.url), 303);
}
