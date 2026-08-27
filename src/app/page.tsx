import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { FinanceWorkspace } from "@/components/finance-workspace";
import { FastTenderDashboard, type FastTenderView } from "@/components/fast-tender-dashboard";
import { OwnerDashboard } from "@/components/owner-dashboard";
import { toViewer } from "@/lib/accounts";
import { sessionAccount, sessionCookie } from "@/lib/auth";
import { loadConfidentialTurnover } from "@/lib/confidential-turnover";

type HomeProps = { searchParams: Promise<{ workspace?: string; view?: string }> };

const fastTenderViews = new Set<FastTenderView>(["market", "competitors", "projects", "tender-workspace"]);

function allowedFastView(view: string | undefined, account: NonNullable<ReturnType<typeof sessionAccount>>): view is FastTenderView {
  if (!view || !fastTenderViews.has(view as FastTenderView)) return false;
  if (view === "tender-workspace") return Boolean(account.tenderWorkspaceAccess);
  if (account.role === "employee") return view === "market";
  return true;
}

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
  if (allowedFastView(query.view, account)) {
    return <FastTenderDashboard viewer={toViewer(account)} initialView={query.view} />;
  }
  return <OwnerDashboard />;
}
