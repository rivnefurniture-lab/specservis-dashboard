import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { sessionAccount, sessionCookie } from "@/lib/auth";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; retryAfter?: string }>;
}) {
  const cookieStore = await cookies();
  if (sessionAccount(cookieStore.get(sessionCookie.name)?.value)) redirect("/");
  const { error, retryAfter } = await searchParams;
  const loginError = error === "credentials" || error === "rate-limit" ? error : null;
  const retryAfterSeconds = /^\d+$/.test(retryAfter ?? "") ? Number(retryAfter) : null;

  return (
    <main className="login-page brand-login-page">
      <div className="login-ambient login-ambient-one" />
      <div className="login-ambient login-ambient-two" />
      <section className="login-shell">
        <div className="login-brand">
          <span className="login-official-logo" role="img" aria-label="Спецсервіс — будуємо країну разом" />
        </div>
        <div className="login-copy">
          <span className="eyebrow">ВНУТРІШНЯ СИСТЕМА СПЕЦСЕРВІС</span>
          <h1>Тендери.<br /><em>Робота команди.</em></h1>
          <p>Персональний робочий простір для директора, керівників напрямків і тендерної команди.</p>
        </div>
        <div className="login-trust"><span /> Дані захищено. Доступ лише для команди.</div>
      </section>

      <section className="login-card-wrap">
        <div className="login-card">
          <span className="login-number">ПЕРСОНАЛЬНИЙ ДОСТУП</span>
          <h2>Вхід до системи</h2>
          <p>Введіть свій логін і пароль. Система автоматично відкриє вашу роль та напрямок.</p>
          <LoginForm error={loginError} retryAfter={retryAfterSeconds} />
          <div className="login-status"><span /><span>Безпечний доступ</span><b>READ ONLY</b></div>
        </div>
      </section>
    </main>
  );
}
