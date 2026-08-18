import "server-only";

import { createHmac, scryptSync, timingSafeEqual } from "node:crypto";

const SESSION_TTL_SECONDS = 60 * 60 * 4;
const TOKEN_VERSION = "cv1";
const MIN_SECRET_BYTES = 32;

type ConfidentialCredentials = {
  username: string;
  salt: string;
  passwordHash: string;
  sessionSecret: string;
};

function configuration(): ConfidentialCredentials {
  const username = process.env.CONFIDENTIAL_USERNAME?.trim().toLowerCase() ?? "";
  const salt = process.env.CONFIDENTIAL_PASSWORD_SALT?.trim() ?? "";
  const passwordHash = process.env.CONFIDENTIAL_PASSWORD_HASH?.trim() ?? "";
  const sessionSecret = process.env.CONFIDENTIAL_SESSION_SECRET?.trim() ?? "";
  if (!username || !salt || !passwordHash || Buffer.byteLength(sessionSecret, "utf8") < MIN_SECRET_BYTES) {
    throw new Error("Confidential authentication is not configured securely");
  }
  return { username, salt, passwordHash, sessionSecret };
}

function sign(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function authenticateConfidential(username: string, password: string) {
  const configured = configuration();
  const suppliedUsername = username.trim().toLowerCase();
  const expected = Buffer.from(configured.passwordHash, "base64url");
  const received = scryptSync(password || "invalid", suppliedUsername === configured.username ? configured.salt : "invalid-confidential-account", 32);
  return suppliedUsername === configured.username
    && expected.length === received.length
    && timingSafeEqual(expected, received);
}

export function createConfidentialSessionToken() {
  const configured = configuration();
  const issuedAt = Math.floor(Date.now() / 1_000);
  const expiresAt = issuedAt + SESSION_TTL_SECONDS;
  const data = Buffer.from(JSON.stringify({ issuedAt, expiresAt, audience: "confidential-finance" })).toString("base64url");
  const payload = `${TOKEN_VERSION}.${data}`;
  return `${payload}.${sign(payload, configured.sessionSecret)}`;
}

export function verifyConfidentialSessionToken(token?: string) {
  if (!token) return false;
  const [version, data, signature, extra] = token.split(".");
  if (version !== TOKEN_VERSION || !data || !signature || extra) return false;
  const configured = configuration();
  const payload = `${version}.${data}`;
  const expected = Buffer.from(sign(payload, configured.sessionSecret));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return false;
  try {
    const parsed = JSON.parse(Buffer.from(data, "base64url").toString("utf8")) as {
      issuedAt?: number;
      expiresAt?: number;
      audience?: string;
    };
    const now = Math.floor(Date.now() / 1_000);
    return parsed.audience === "confidential-finance"
      && Number.isSafeInteger(parsed.issuedAt)
      && Number.isSafeInteger(parsed.expiresAt)
      && parsed.issuedAt! <= now + 60
      && parsed.expiresAt! > now
      && parsed.expiresAt! - parsed.issuedAt! <= SESSION_TTL_SECONDS;
  } catch {
    return false;
  }
}

export const confidentialSessionCookie = {
  name: "specservis_confidential_session",
  maxAge: SESSION_TTL_SECONDS,
  path: "/confidential",
};
