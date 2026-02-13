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
    <div className="relative min-h-screen overflow-hidden bg-slate-950">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-20 top-0 h-80 w-80 rounded-full bg-cyan-400/30 blur-3xl" />
        <div className="absolute right-0 top-10 h-[28rem] w-[28rem] rounded-full bg-blue-500/25 blur-3xl" />
        <div className="absolute bottom-0 left-1/3 h-[24rem] w-[24rem] rounded-full bg-sky-400/20 blur-3xl" />
      </div>

      <main className="relative mx-auto flex min-h-screen w-full max-w-7xl items-center px-6 py-12">
        <div className="grid w-full gap-8 lg:grid-cols-[1.2fr_0.8fr]">
          <section className="rounded-3xl border border-white/10 bg-white/[0.06] p-8 text-white shadow-[0_30px_80px_rgba(2,6,23,0.55)] backdrop-blur-xl md:p-10">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-200/90">Voho Track</p>
            <h1 className="mt-4 max-w-2xl text-3xl font-semibold leading-tight text-white md:text-5xl">
              Time tracking that feels as polished as your product.
            </h1>
            <p className="mt-4 max-w-xl text-sm text-slate-200/90 md:text-base">
              Unified tracking, project visibility, and performance insights for modern teams.
            </p>

            <div className="mt-8 grid gap-4 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-white/[0.07] p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-cyan-100/80">Realtime</p>
                <p className="mt-2 text-lg font-semibold">Live timer sync</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.07] p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-cyan-100/80">Reporting</p>
                <p className="mt-2 text-lg font-semibold">Actionable dashboards</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.07] p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-cyan-100/80">Operations</p>
                <p className="mt-2 text-lg font-semibold">DB-first reliability</p>
              </div>
            </div>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-[0_24px_70px_rgba(15,23,42,0.22)] md:p-8">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-700">Welcome back</p>
            <h2 className="mt-2 text-3xl font-semibold text-slate-900">Sign in</h2>
            <p className="mt-1 text-sm text-slate-600">Use your team account credentials to continue.</p>

            <div className="mt-6 space-y-4">
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Email</span>
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  onKeyDown={onEnter}
                  placeholder="you@company.com"
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-[#0BA5E9] focus:ring-2 focus:ring-sky-100"
                />
              </label>

              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Password</span>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  onKeyDown={onEnter}
                  placeholder="••••••••"
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-[#0BA5E9] focus:ring-2 focus:ring-sky-100"
                />
              </label>

              <button
                type="button"
                disabled={busy}
                onClick={() => void handleLogin()}
                className="w-full rounded-xl bg-[#0BA5E9] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#0994cf] disabled:cursor-not-allowed disabled:bg-slate-400"
              >
                {busy ? "Signing in..." : "Sign in to Voho Track"}
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
