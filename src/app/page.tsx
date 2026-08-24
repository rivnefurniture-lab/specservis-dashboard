import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { FinanceWorkspace } from "@/components/finance-workspace";
import { OwnerDashboard } from "@/components/owner-dashboard";
import { toViewer } from "@/lib/accounts";
import { sessionAccount, sessionCookie } from "@/lib/auth";
import { loadConfidentialTurnover } from "@/lib/confidential-turnover";

type HomeProps = { searchParams: Promise<{ workspace?: string }> };

export default async function Home({ searchParams }: HomeProps) {
  const [cookieStore, query] = await Promise.all([cookies(), searchParams]);
  const account = sessionAccount(cookieStore.get(sessionCookie.name)?.value);
  if (!account) redirect("/login");
  if (query.workspace === "finance" && account.financeAccess) {
    let dataset;
    try {
      dataset = await loadConfidentialTurnover();
    } catch (error) {
      console.error("[finance-page] initial dataset failed", error);
    }
    return <FinanceWorkspace viewer={toViewer(account)} dataset={dataset ?? undefined} />;
  }
  return <OwnerDashboard />;
}
