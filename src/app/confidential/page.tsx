import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { sessionAccount, sessionCookie } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ConfidentialPage() {
  const cookieStore = await cookies();
  const account = sessionAccount(cookieStore.get(sessionCookie.name)?.value);
  if (!account) redirect("/confidential/login");
  if (!account.financeAccess) redirect("/");
  redirect("/?workspace=finance");
}
