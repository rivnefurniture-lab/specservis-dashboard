import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { findAccountById } from "@/lib/accounts";

const SESSION_TTL_SECONDS = 60 * 60 * 12;
const SESSION_TOKEN_VERSION = "v3";
const MIN_SECRET_BYTES = 32;
const DEVELOPMENT_SECRET = "specservis-local-development-session-secret-not-for-production";

function resolveSessionSecret() {
  const configured = process.env.SESSION_SECRET?.trim();
  if (process.env.NODE_ENV === "production") {
    if (!configured || Buffer.byteLength(configured, "utf8") < MIN_SECRET_BYTES || configured === DEVELOPMENT_SECRET) {
      throw new Error(`SESSION_SECRET must contain at least ${MIN_SECRET_BYTES} bytes in production`);
    }
  }
  return configured || DEVELOPMENT_SECRET;
}

// Resolve at module startup so a misconfigured production instance never serves
// an authentication flow that can only fail later, after password verification.
const SESSION_SECRET = resolveSessionSecret();

function sign(payload: string) {
  return createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
}

export function createSessionToken(accountId: string) {
  const account = findAccountById(accountId);
  if (!account) throw new Error("Cannot create a session for an unknown account");
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + SESSION_TTL_SECONDS;
  const data = Buffer.from(JSON.stringify({
    accountId,
    sessionVersion: account.sessionVersion,
    issuedAt,
    expiresAt,
  })).toString("base64url");
  const payload = `${SESSION_TOKEN_VERSION}.${data}`;
  return `${payload}.${sign(payload)}`;
}

export function sessionAccount(token?: string) {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [version, data, signature] = parts;
  if (version !== SESSION_TOKEN_VERSION || !data || !signature) return null;
  const payload = `${version}.${data}`;
  const expected = Buffer.from(sign(payload));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(data, "base64url").toString("utf8")) as {
      accountId?: string;
      sessionVersion?: number;
      issuedAt?: number;
      expiresAt?: number;
    };
    const now = Math.floor(Date.now() / 1000);
    if (!parsed.accountId
      || !Number.isSafeInteger(parsed.sessionVersion)
      || !Number.isSafeInteger(parsed.issuedAt)
      || !Number.isSafeInteger(parsed.expiresAt)
      || parsed.issuedAt! > now + 60
      || parsed.expiresAt! <= now
      || parsed.expiresAt! - parsed.issuedAt! > SESSION_TTL_SECONDS) return null;
    const account = findAccountById(parsed.accountId);
    return account && account.sessionVersion === parsed.sessionVersion ? account : null;
  } catch {
    return null;
  }
}

/** Reject cross-site POSTs before processing credentials or changing cookies. */
export function isSameOriginRequest(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin === "null") return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export const verifySessionToken = (token?: string) => Boolean(sessionAccount(token));

export const sessionCookie = {
  name: "specservis_session",
  maxAge: SESSION_TTL_SECONDS,
};
