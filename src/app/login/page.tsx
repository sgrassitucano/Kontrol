"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const json = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok) {
        setError(json.error ?? "Login non riuscito.");
        return;
      }
      router.replace("/home/guida");
      router.refresh();
    } catch {
      setError("Login non riuscito.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center gap-6">
      <section className="rounded-[24px] border border-[var(--brand-line)] bg-[var(--brand-panel)] p-6">
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--brand-ink)]">
          Accedi
        </h1>
        <p className="mt-2 text-sm leading-7 text-slate-500">
          Inserisci le credenziali per accedere al gestionale.
        </p>
      </section>

      <form
        onSubmit={onSubmit}
        className="rounded-[24px] border border-[var(--brand-line)] bg-white p-6"
      >
        <div className="space-y-4">
          <label className="block space-y-1">
            <span className="text-sm font-medium text-slate-700">Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm text-slate-900"
              autoComplete="email"
              required
            />
          </label>

          <label className="block space-y-1">
            <span className="text-sm font-medium text-slate-700">Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-[var(--brand-line)] bg-white px-3 py-2 text-sm text-slate-900"
              autoComplete="current-password"
              required
            />
          </label>

          {error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={loading}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-full bg-[var(--brand-primary)] px-4 text-sm font-semibold text-white transition hover:brightness-95 disabled:opacity-60"
          >
            {loading ? "Accesso in corso..." : "Accedi"}
          </button>
        </div>
      </form>
    </div>
  );
}
