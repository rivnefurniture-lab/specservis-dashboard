import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ArrowRight, LockKeyhole } from "lucide-react";
import { sessionAccount, sessionCookie } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Фінанси · Захищений вхід · Спецсервіс",
  robots: { index: false, follow: false, noarchive: true, nosnippet: true },
};

export default async function ConfidentialLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; retryAfter?: string }>;
}) {
  const cookieStore = await cookies();
  const account = sessionAccount(cookieStore.get(sessionCookie.name)?.value);
  if (account?.financeAccess) redirect("/?workspace=finance");
  if (account) redirect("/");
  const { error, retryAfter } = await searchParams;
  const minutes = /^\d+$/.test(retryAfter ?? "") ? Math.max(1, Math.ceil(Number(retryAfter) / 60)) : 1;

  return (
    <main className="login-page brand-login-page">
      <div className="login-ambient login-ambient-one" />
      <div className="login-ambient login-ambient-two" />
      <section className="login-shell">
        <div className="login-brand"><span className="login-official-logo" role="img" aria-label="Спецсервіс — будуємо країну разом" /></div>
        <div className="login-copy">
          <span className="eyebrow">РОЗШИРЕНИЙ РЕЖИМ ВЛАСНИКА</span>
          <h1>Фінанси.<br /><em>Оборот і команда.</em></h1>
          <p>Той самий кабінет Спецсервіс із додатковим закритим табом «Фінанси». Стандартні акаунти цього таба не бачать.</p>
        </div>
        <div className="login-trust"><span /> Єдиний кабінет · окреме право доступу</div>
      </section>

      <section className="login-card-wrap">
        <div className="login-card">
          <span className="login-number">КОНФІДЕНЦІЙНИЙ ДОСТУП</span>
          <h2>Вхід для власника</h2>
          <p>Використайте реквізити executive.vault. Після входу відкриється основний кабінет.</p>
          <form className="login-form" action="/confidential/auth/login" method="post">
            <label htmlFor="confidential-username">Логін</label>
            <input id="confidential-username" name="username" type="text" autoComplete="username" required autoFocus aria-invalid={Boolean(error)} />
            <label htmlFor="confidential-password">Пароль</label>
            <input id="confidential-password" name="password" type="password" autoComplete="current-password" required aria-invalid={Boolean(error)} />
            {error === "credentials" ? <p className="login-error">Неправильний логін або пароль.</p> : null}
            {error === "rate-limit" ? <p className="login-error">Доступ тимчасово заблоковано. Спробуйте через {minutes} хв.</p> : null}
            <button className="login-button" type="submit"><LockKeyhole size={17} /><span>Увійти до кабінету власника</span><ArrowRight size={17} /></button>
          </form>
          <div className="login-status"><span /><span>Доступ за роллю</span><b>EXECUTIVE</b></div>
        </div>
      </section>
    </main>
  );
}
