import "server-only";

import { scryptSync, timingSafeEqual } from "node:crypto";
import type { Direction } from "@/lib/types";
import type { TenderWorkspaceAccess, TenderWorkspaceMember } from "@/lib/tender-workspace";

type AccountRole = "owner" | "manager" | "employee";
export type AccountDirection = Exclude<Direction, "Інше">;

export type DashboardAccount = {
  id: string;
  username: string;
  label: string;
  role: AccountRole;
  direction: AccountDirection | null;
  financeAccess: boolean;
  tenderWorkspaceAccess: TenderWorkspaceAccess | null;
  /** Increase this number to invalidate every existing session for the account. */
  sessionVersion: number;
};

export type DashboardViewer = Omit<DashboardAccount, "sessionVersion"> & {
  availableDirections: AccountDirection[];
};

type PasswordVerifier = { salt: string; passwordHash: string };

const dashboardDirections: AccountDirection[] = [
  "Капбудівництво",
  "Сервіс",
  "Кондиціонування",
];

const standardAccounts: Array<Omit<DashboardAccount, "financeAccess" | "tenderWorkspaceAccess">> = [
  { id: "owner", username: "owner", label: "Директор", role: "owner", direction: null, sessionVersion: 1 },
  { id: "build-manager", username: "build.manager", label: "Керівник будівництва", role: "manager", direction: "Капбудівництво", sessionVersion: 1 },
  { id: "service-manager", username: "service.manager", label: "Керівник сервісу", role: "manager", direction: "Сервіс", sessionVersion: 1 },
  { id: "climate-manager", username: "climate.manager", label: "Керівник кондиціонування", role: "manager", direction: "Кондиціонування", sessionVersion: 2 },
  { id: "build-1", username: "build.1", label: "Працівник 1 · Будівництво", role: "employee", direction: "Капбудівництво", sessionVersion: 1 },
  { id: "build-2", username: "build.2", label: "Працівник 2 · Будівництво", role: "employee", direction: "Капбудівництво", sessionVersion: 1 },
  { id: "build-3", username: "build.3", label: "Працівник 3 · Будівництво", role: "employee", direction: "Капбудівництво", sessionVersion: 1 },
  { id: "service-1", username: "service.1", label: "Працівник 1 · Сервіс", role: "employee", direction: "Сервіс", sessionVersion: 1 },
  { id: "service-2", username: "service.2", label: "Працівник 2 · Сервіс", role: "employee", direction: "Сервіс", sessionVersion: 1 },
  { id: "service-3", username: "service.3", label: "Працівник 3 · Сервіс", role: "employee", direction: "Сервіс", sessionVersion: 1 },
  { id: "climate-1", username: "climate.1", label: "Працівник 1 · Кондиціонування", role: "employee", direction: "Кондиціонування", sessionVersion: 2 },
  { id: "climate-2", username: "climate.2", label: "Працівник 2 · Кондиціонування", role: "employee", direction: "Кондиціонування", sessionVersion: 2 },
  { id: "climate-3", username: "climate.3", label: "Працівник 3 · Кондиціонування", role: "employee", direction: "Кондиціонування", sessionVersion: 2 },
];

function configuredStandardVerifiers() {
  const raw = process.env.DASHBOARD_ACCOUNT_CREDENTIALS?.trim();
  if (!raw) return new Map<string, PasswordVerifier>();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("DASHBOARD_ACCOUNT_CREDENTIALS must be valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("DASHBOARD_ACCOUNT_CREDENTIALS must be an object");
  }
  const source = parsed as Record<string, unknown>;
  const verifiers = new Map<string, PasswordVerifier>();
  for (const account of standardAccounts) {
    const value = source[account.id];
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Missing verifier for ${account.id}`);
    const salt = String((value as Record<string, unknown>).salt ?? "");
    const passwordHash = String((value as Record<string, unknown>).passwordHash ?? "");
    if (!/^[A-Za-z0-9_-]{20,}$/.test(salt) || Buffer.from(passwordHash, "base64url").length !== 32) {
      throw new Error(`Invalid verifier for ${account.id}`);
    }
    verifiers.set(account.id, { salt, passwordHash });
  }
  return verifiers;
}

const standardVerifiers = configuredStandardVerifiers();

const accounts: DashboardAccount[] = [
  ...standardAccounts.map((account) => ({
    ...account,
    financeAccess: false,
    tenderWorkspaceAccess: account.direction === "Кондиціонування" && account.role !== "owner"
      ? account.role
      : null,
  })),
  {
    id: "executive-vault",
    username: process.env.CONFIDENTIAL_USERNAME?.trim().toLowerCase() || "executive.vault",
    label: "Власник",
    role: "owner",
    direction: null,
    financeAccess: true,
    tenderWorkspaceAccess: null,
    sessionVersion: 1,
  },
];

const byId = new Map(accounts.map((account) => [account.id, account]));
const byUsername = new Map(accounts.map((account) => [account.username, account]));

export function findAccountById(id: string) {
  return byId.get(id) ?? null;
}

export function authenticateAccount(username: string, password: string) {
  const account = byUsername.get(username.trim().toLowerCase());
  if (!account) {
    scryptSync(password || "invalid", "invalid-account", 32);
    return null;
  }
  const verifier = account.id === "executive-vault"
    ? {
        salt: process.env.CONFIDENTIAL_PASSWORD_SALT?.trim() ?? "",
        passwordHash: process.env.CONFIDENTIAL_PASSWORD_HASH?.trim() ?? "",
      }
    : standardVerifiers.get(account.id);
  if (!verifier?.salt || !verifier.passwordHash) {
    scryptSync(password || "invalid", "unconfigured-account", 32);
    return null;
  }
  const expected = Buffer.from(verifier.passwordHash, "base64url");
  const received = scryptSync(password, verifier.salt, 32);
  return expected.length === received.length && timingSafeEqual(expected, received) ? account : null;
}

export function toViewer(account: DashboardAccount): DashboardViewer {
  return {
    id: account.id,
    username: account.username,
    label: account.label,
    role: account.role,
    direction: account.direction,
    financeAccess: account.financeAccess,
    tenderWorkspaceAccess: account.tenderWorkspaceAccess,
    availableDirections: account.role === "owner"
      ? dashboardDirections
      : account.direction
        ? [account.direction]
        : [],
  };
}

export function tenderWorkspaceMembers(direction: AccountDirection): TenderWorkspaceMember[] {
  return accounts
    .filter((account) => account.direction === direction && account.tenderWorkspaceAccess)
    .map((account) => ({ id: account.id, label: account.label, role: account.role as "manager" | "employee" }));
}
