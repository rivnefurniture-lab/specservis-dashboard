import "server-only";

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getAnalyticsSql } from "@/lib/analytics-v2-db";

let migrationPromise: Promise<void> | null = null;

/** Idempotent runtime bootstrap for managed databases whose secrets exist only inside Vercel. */
export function ensureAnalyticsV2Schema() {
  if (migrationPromise) return migrationPromise;
  migrationPromise = (async () => {
    const sql = getAnalyticsSql();
    if (!sql) throw new Error("DATABASE_URL is required");
    const migration = await readFile(resolve(process.cwd(), "db/analytics-v2.sql"), "utf8");
    const statements = migration.split(/;\s*(?:\n|$)/).map((statement) => statement.trim()).filter(Boolean);
    for (const statement of statements) await sql.query(statement, []);
  })().catch((error) => {
    migrationPromise = null;
    throw error;
  });
  return migrationPromise;
}
