import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { OwnerDashboard } from "@/components/owner-dashboard";
import { sessionAccount, sessionCookie } from "@/lib/auth";

export default async function Home() {
  const cookieStore = await cookies();
  if (!sessionAccount(cookieStore.get(sessionCookie.name)?.value)) redirect("/login");
  return <OwnerDashboard />;
}
