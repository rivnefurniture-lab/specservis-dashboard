import assert from "node:assert/strict";
import { scryptSync } from "node:crypto";

const accountIds = [
  "owner", "build-manager", "service-manager", "climate-manager",
  "build-1", "build-2", "build-3", "service-1", "service-2", "service-3",
  "climate-1", "climate-2", "climate-3",
];

const password = "fixture-password";
process.env.DASHBOARD_ACCOUNT_CREDENTIALS = JSON.stringify(Object.fromEntries(
  accountIds.map((id) => {
    const salt = Buffer.from(`fixture-salt-${id}`).toString("base64url");
    return [id, { salt, passwordHash: scryptSync(password, salt, 32).toString("base64url") }];
  }),
));

const { authenticateAccount } = await import("../src/lib/accounts");

assert.equal(authenticateAccount("owner", password)?.id, "owner");
assert.equal(authenticateAccount("climate.2", password)?.id, "climate-2");
assert.equal(authenticateAccount("owner", "wrong-password"), null);
assert.equal(authenticateAccount("unknown", password), null);
assert.equal(authenticateAccount("executive.vault", password), null);

console.log("account credentials: environment-backed verification and failure paths passed");
