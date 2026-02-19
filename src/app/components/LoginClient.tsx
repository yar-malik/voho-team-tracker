"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, type KeyboardEvent } from "react";

export default function LoginClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogin() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok || data.error) throw new Error(data.error || "Login failed");
      const next = searchParams.get("next") || "/";
      router.push(next);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  function onEnter(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (!busy) void handleLogin();
  }

  return (
    <div className="relative min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      <div className="pointer-events-none absolute inset-0 opacity-30">
        <div className="absolute -left-20 top-0 h-96 w-96 rounded-full bg-sky-500/20 blur-3xl" />
        <div className="absolute right-0 top-10 h-80 w-80 rounded-full bg-indigo-500/20 blur-3xl" />
        <div className="absolute bottom-0 left-1/3 h-64 w-64 rounded-full bg-cyan-500/20 blur-3xl" />
      </div>

      <main className="relative mx-auto flex min-h-screen w-full max-w-7xl items-center px-6 py-12">
        <div className="grid w-full gap-8 lg:grid-cols-[1.2fr_0.8fr]">
          <section className="rounded-2xl border border-white/10 bg-white/5 p-8 text-white shadow-2xl backdrop-blur-xl md:p-10">
            <p className="text-xs font-bold uppercase tracking-widest text-sky-400">Voho Tracker</p>
            <h1 className="mt-4 max-w-2xl text-4xl font-bold leading-tight text-white md:text-5xl">
              Time tracking that feels as polished as your product.
            </h1>
            <p className="mt-4 max-w-xl text-base text-slate-300">
              Unified tracking, project visibility, and performance insights for modern teams.
            </p>

            <div className="mt-8 grid gap-4 sm:grid-cols-3">
              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-sky-300">Realtime</p>
                <p className="mt-2 text-lg font-bold">Live timer sync</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-sky-300">Reporting</p>
                <p className="mt-2 text-lg font-bold">Actionable dashboards</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-sky-300">Operations</p>
                <p className="mt-2 text-lg font-bold">DB-first reliability</p>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200/50 bg-white/95 p-8 shadow-2xl backdrop-blur-xl md:p-10">
            <p className="text-xs font-bold uppercase tracking-widest text-sky-600">Welcome back</p>
            <h2 className="mt-2 text-3xl font-bold text-slate-800">Sign in</h2>
            <p className="mt-1 text-sm text-slate-500">Use your team account credentials to continue.</p>

            <div className="mt-6 space-y-4">
              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-500">Email</span>
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  onKeyDown={onEnter}
                  placeholder="you@company.com"
                  className="input"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-500">Password</span>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  onKeyDown={onEnter}
                  placeholder="••••••••"
                  className="input"
                />
              </label>

              <button
                type="button"
                disabled={busy}
                onClick={() => void handleLogin()}
                className="w-full rounded-xl bg-[#0BA5E9] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#0994cf] disabled:cursor-not-allowed disabled:bg-slate-400"
              >
                {busy ? "Signing in..." : "Sign in to Voho Tracker"}
              </button>

              {error && <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
            </div>

            <p className="mt-6 text-xs text-slate-500">
              By continuing, you agree to your organization&apos;s internal usage policy.
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
