"use client";

import { useState } from "react";
import { LoaderCircle, RefreshCw } from "lucide-react";
import { dateTime } from "@/lib/dashboard-data";

type RefreshResult = {
  ok: boolean;
  durationSeconds: number;
  crawlDays: number;
  added: number;
  updated: number;
  failures: number;
  message: string;
};

/**
 * Ручне оновлення ринку.
 *
 * Обхід триває хвилини, тому кнопка не вдає миттєвість: вона блокується на час
 * запиту і показує, що саме зробив останній запуск. Якщо оновлення вже йде в
 * іншому serverless-процесі, сервер не запускає другий обхід і повертає
 * зрозуміле повідомлення про зайнятий процес.
 */
export function MarketRefresh({ generatedAt, onDone }: { generatedAt: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RefreshResult | null>(null);
  const [error, setError] = useState("");

  const refresh = async () => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/market/refresh", { method: "POST", cache: "no-store" });
      const payload = await response.json() as RefreshResult & { error?: string };
      if (!response.ok && !payload.message) throw new Error(payload.error ?? "Не вдалося оновити ринок");
      setResult(payload);
      if (payload.ok) onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Невідома помилка");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="market-refresh">
      <div>
        <b>Дані Prozorro станом на {dateTime(generatedAt)}</b>
        <small>
          {error
            ? error
            : result
              ? result.message + (result.failures ? ` Не відповіли ${result.failures} запитів.` : "")
              : "Оновлюється автоматично кожні 3 години. Кнопка перевіряє останні дні просто зараз."}
        </small>
      </div>
      <button type="button" onClick={() => void refresh()} disabled={busy}>
        {busy ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}
        {busy ? "Перевіряємо Prozorro…" : "Оновити зараз"}
      </button>
    </section>
  );
}
