import assert from "node:assert/strict";
import { scryptSync } from "node:crypto";

const username = "restricted-test";
const password = "test-only-password";
const salt = "test-only-salt";
process.env.CONFIDENTIAL_USERNAME = username;
process.env.CONFIDENTIAL_PASSWORD_SALT = salt;
process.env.CONFIDENTIAL_PASSWORD_HASH = scryptSync(password, salt, 32).toString("base64url");
process.env.CONFIDENTIAL_SESSION_SECRET = "test-confidential-session-secret-with-more-than-32-bytes";

const confidential = await import("../src/lib/confidential-auth.ts");
const primary = await import("../src/lib/auth.ts");

assert.equal(confidential.authenticateConfidential(username, password), true);
assert.equal(confidential.authenticateConfidential(username, "wrong"), false);
assert.equal(confidential.authenticateConfidential("owner", password), false);

const confidentialToken = confidential.createConfidentialSessionToken();
assert.equal(confidential.verifyConfidentialSessionToken(confidentialToken), true);
assert.equal(primary.verifySessionToken(confidentialToken), false, "restricted session must not authenticate the primary dashboard");

const ownerToken = primary.createSessionToken("owner");
assert.equal(confidential.verifyConfidentialSessionToken(ownerToken), false, "primary owner session must not authenticate restricted boardroom");
const executiveToken = primary.createSessionToken("executive-vault");
const executiveAccount = primary.sessionAccount(executiveToken);
assert.equal(executiveAccount?.financeAccess, true, "executive.vault must carry explicit finance access in the primary session");
assert.equal(primary.sessionAccount(ownerToken)?.financeAccess, false, "ordinary owner must not inherit finance access");
assert.equal(confidential.verifyConfidentialSessionToken(`${confidentialToken.slice(0, -1)}x`), false, "tampered token must fail");

console.log("confidential auth: credentials, tamper resistance, and primary-session finance capability passed");
