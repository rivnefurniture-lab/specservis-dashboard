import assert from "node:assert/strict";
import { findAccountById, tenderWorkspaceMembers, toViewer } from "@/lib/accounts";

const owner = findAccountById("owner");
const executive = findAccountById("executive-vault");
const climateManager = findAccountById("climate-manager");
const climateEmployee = findAccountById("climate-1");
const serviceManager = findAccountById("service-manager");

assert(owner && executive && climateManager && climateEmployee && serviceManager);
assert.equal(toViewer(owner).tenderWorkspaceAccess, null, "ordinary owner must not see the operational direction workspace");
assert.equal(toViewer(executive).tenderWorkspaceAccess, null, "executive vault must not see the operational direction workspace");
assert.equal(toViewer(serviceManager).tenderWorkspaceAccess, null, "other directions must not see the conditioning workspace");
assert.equal(toViewer(climateManager).tenderWorkspaceAccess, "manager");
assert.equal(toViewer(climateEmployee).tenderWorkspaceAccess, "employee");

const members = tenderWorkspaceMembers("Кондиціонування");
assert.deepEqual(members.map((member) => member.id), ["climate-manager", "climate-1", "climate-2", "climate-3"]);
assert(members.every((member) => !member.id.includes("owner")));

console.log("tender workspace: strict direction RBAC and team membership passed");
