import "server-only";

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

let queryClient: NeonQueryFunction<false, false> | null = null;

export function analyticsDatabaseConfigured() {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export function getAnalyticsSql() {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) return null;
  if (!queryClient) queryClient = neon(connectionString);
  return queryClient;
}
