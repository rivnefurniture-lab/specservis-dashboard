import { readFile } from "node:fs/promises";
import { neon } from "@neondatabase/serverless";

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) throw new Error("DATABASE_URL is required");

const migration = await readFile(new URL("../db/analytics-v2.sql", import.meta.url), "utf8");
const sql = neon(connectionString);
const statements = migration.split(/;\s*(?:\n|$)/).map((statement) => statement.trim()).filter(Boolean);
for (const statement of statements) await sql(statement, []);
console.log("analytics v2 schema is up to date");
