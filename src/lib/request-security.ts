import "server-only";

import { timingSafeEqual } from "node:crypto";

/** Constant-time comparison for secrets carried in HTTP headers. */
export function hasValidBearerSecret(authorization: string | null, secret: string | undefined) {
  if (!secret || secret.trim() !== secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`, "utf8");
  const received = Buffer.from(authorization ?? "", "utf8");
  return expected.length === received.length && timingSafeEqual(expected, received);
}

/**
 * Session cookies authenticate a user; Origin proves that a state-changing
 * browser request came from this application rather than a third-party page.
 */
export function hasTrustedMutationOrigin(request: Request) {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}
