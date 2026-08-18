import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  authenticateConfidential,
} from "@/lib/confidential-auth";
import { createSessionToken, isSameOriginRequest, sessionCookie } from "@/lib/auth";

const WINDOW_MS = 15 * 60 * 1_000;
const MAX_FAILURES = 5;
const failures = new Map<string, { count: number; expiresAt: number }>();

function clientIp(request: Request) {
  if (process.env.VERCEL !== "1") return "local";
  for (const candidate of [request.headers.get("x-vercel-forwarded-for")?.split(",")[0], request.headers.get("x-real-ip")]) {
    const value = candidate?.trim();
    if (value && isIP(value)) return value.toLowerCase();
  }
  return "unknown";
}

function key(request: Request, username: string) {
  return createHash("sha256").update(`${clientIp(request)}\0${username.trim().toLowerCase()}`).digest("base64url");
}

function redirectError(request: Request, error: "credentials" | "rate-limit", retryAfter?: number) {
  const target = new URL("/confidential/login", request.url);
  target.searchParams.set("error", error);
  if (retryAfter) target.searchParams.set("retryAfter", String(retryAfter));
  const response = NextResponse.redirect(target, 303);
  response.headers.set("Cache-Control", "private, no-store");
  if (retryAfter) response.headers.set("Retry-After", String(retryAfter));
  return response;
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const length = Number(request.headers.get("content-length"));
  if (Number.isFinite(length) && length > 8_192) return NextResponse.json({ error: "Request too large" }, { status: 413 });
  const data = await request.formData();
  const username = String(data.get("username") ?? "");
  const password = String(data.get("password") ?? "");
  if (!username || username.length > 80 || !password || password.length > 256) return redirectError(request, "credentials");

  const now = Date.now();
  const failureKey = key(request, username);
  const current = failures.get(failureKey);
  if (current && current.expiresAt > now && current.count >= MAX_FAILURES) {
    return redirectError(request, "rate-limit", Math.max(1, Math.ceil((current.expiresAt - now) / 1_000)));
  }
  if (!authenticateConfidential(username, password)) {
    const next = current && current.expiresAt > now
      ? { count: current.count + 1, expiresAt: current.expiresAt }
      : { count: 1, expiresAt: now + WINDOW_MS };
    failures.set(failureKey, next);
    return next.count >= MAX_FAILURES
      ? redirectError(request, "rate-limit", Math.ceil((next.expiresAt - now) / 1_000))
      : redirectError(request, "credentials");
  }
  failures.delete(failureKey);

  const cookieStore = await cookies();
  cookieStore.set(sessionCookie.name, createSessionToken("executive-vault"), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: sessionCookie.maxAge,
    priority: "high",
  });
  return NextResponse.redirect(new URL("/?workspace=finance", request.url), 303);
}
