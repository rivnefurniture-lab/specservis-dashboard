import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { authenticateAccount } from "@/lib/accounts";
import { createSessionToken, isSameOriginRequest, sessionCookie } from "@/lib/auth";

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1_000;
const MAX_FAILURES_PER_LOGIN = 5;
const MAX_FAILURES_PER_IP = 20;
const MAX_RATE_LIMIT_KEYS = 5_000;
const MAX_FORM_BYTES = 8_192;

type FailureWindow = { failures: number; expiresAt: number };
const failureWindows = new Map<string, FailureWindow>();

function clientIp(request: Request) {
  // Forwarding headers are trustworthy only when the request came through the
  // configured Vercel proxy. Unknown clients deliberately share one bucket so
  // a forged header cannot create unlimited rate-limit identities.
  if (process.env.VERCEL !== "1") return "unknown";
  const candidates = [
    request.headers.get("x-vercel-forwarded-for")?.split(",")[0],
    request.headers.get("x-real-ip"),
    request.headers.get("x-forwarded-for")?.split(",")[0],
  ];
  for (const candidate of candidates) {
    const value = candidate?.trim();
    if (value && isIP(value)) return value.toLowerCase();
  }
  return "unknown";
}

function loginKey(username: string) {
  return createHash("sha256").update(username.trim().toLowerCase()).digest("base64url").slice(0, 22);
}

function activeWindow(key: string, now: number) {
  const window = failureWindows.get(key);
  if (!window || window.expiresAt <= now) {
    failureWindows.delete(key);
    return null;
  }
  return window;
}

function retryAfter(keys: Array<{ key: string; maximum: number }>, now: number) {
  let retryAt = 0;
  for (const entry of keys) {
    const window = activeWindow(entry.key, now);
    if (window && window.failures >= entry.maximum) retryAt = Math.max(retryAt, window.expiresAt);
  }
  return retryAt ? Math.max(Math.ceil((retryAt - now) / 1_000), 1) : 0;
}

function recordFailure(keys: string[], now: number) {
  if (failureWindows.size >= MAX_RATE_LIMIT_KEYS) {
    for (const [key, window] of failureWindows) {
      if (window.expiresAt <= now) failureWindows.delete(key);
    }
    while (failureWindows.size >= MAX_RATE_LIMIT_KEYS) {
      const oldestKey = failureWindows.keys().next().value as string | undefined;
      if (!oldestKey) break;
      failureWindows.delete(oldestKey);
    }
  }
  for (const key of keys) {
    const current = activeWindow(key, now);
    failureWindows.set(key, current
      ? { ...current, failures: current.failures + 1 }
      : { failures: 1, expiresAt: now + RATE_LIMIT_WINDOW_MS });
  }
}

function clearFailures(keys: string[]) {
  for (const key of keys) failureWindows.delete(key);
}

function rateLimited(request: Request, seconds: number) {
  const target = new URL("/login", request.url);
  target.searchParams.set("error", "rate-limit");
  target.searchParams.set("retryAfter", String(seconds));
  const response = NextResponse.redirect(target, 303);
  response.headers.set("Retry-After", String(seconds));
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_FORM_BYTES) {
    return NextResponse.json({ error: "Request body is too large" }, { status: 413 });
  }
  const data = await request.formData();
  const username = String(data.get("username") ?? "");
  const password = String(data.get("password") ?? "");
  if (!username || username.length > 64 || !password || password.length > 256) {
    return NextResponse.redirect(new URL("/login?error=credentials", request.url), 303);
  }

  const now = Date.now();
  const ip = clientIp(request);
  const keys = [`ip:${ip}`, `login:${ip}:${loginKey(username)}`];
  const limits = [
    { key: keys[0], maximum: MAX_FAILURES_PER_IP },
    { key: keys[1], maximum: MAX_FAILURES_PER_LOGIN },
  ];
  const wait = retryAfter(limits, now);
  if (wait) return rateLimited(request, wait);

  const account = authenticateAccount(username, password);
  if (!account) {
    recordFailure(keys, now);
    const blockedFor = retryAfter(limits, now);
    if (blockedFor) return rateLimited(request, blockedFor);
    return NextResponse.redirect(new URL("/login?error=credentials", request.url), 303);
  }
  clearFailures(keys);

  const cookieStore = await cookies();
  cookieStore.set(sessionCookie.name, createSessionToken(account.id), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: sessionCookie.maxAge,
    priority: "high",
  });
  return NextResponse.redirect(new URL(account.financeAccess ? "/?workspace=finance" : "/", request.url), 303);
}
