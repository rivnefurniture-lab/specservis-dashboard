import { syncAnalyticsV2 } from "@/lib/analytics-v2-sync";

if (!process.env.DATABASE_URL?.trim()) throw new Error("DATABASE_URL is required");
const result = await syncAnalyticsV2();
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
