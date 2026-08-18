"use client";

import { useFormStatus } from "react-dom";
import { LoaderCircle } from "lucide-react";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button className="login-button" type="submit" disabled={pending}>
      {pending && <LoaderCircle className="spin" size={18} />}
      {pending ? "Перевіряємо…" : "Увійти в кабінет"}
    </button>
  );
}

export function LoginForm({ error, retryAfter }: { error: "credentials" | "rate-limit" | null; retryAfter: number | null }) {
  const hasError = Boolean(error);
  return (
    <form action="/api/auth/login" method="post" className="login-form">
      <label htmlFor="username">Логін</label>
      <input
        id="username"
        name="username"
        type="text"
        autoComplete="username"
        placeholder="Наприклад, build.1"
        required
        autoFocus
        aria-invalid={hasError}
      />
      <label htmlFor="password">Пароль</label>
      <input
        id="password"
        name="password"
        type="password"
        autoComplete="current-password"
        placeholder="Введіть пароль"
        required
        aria-invalid={hasError}
      />
      {error === "credentials" ? <p className="login-error">Неправильний логін або пароль.</p> : null}
      {error === "rate-limit" ? (
        <p className="login-error">
          Забагато невдалих спроб. Спробуйте знову приблизно через {Math.max(1, Math.ceil((retryAfter ?? 60) / 60))} хв.
        </p>
      ) : null}
      <SubmitButton />
    </form>
  );
}
