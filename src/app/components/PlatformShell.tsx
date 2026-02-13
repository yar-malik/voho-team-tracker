"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReactNode } from "react";

function navClass(active: boolean) {
  return `block w-full rounded-lg px-3 py-2 text-left text-sm font-medium ${
    active ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"
  }`;
}

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function PlatformShell({
  children,
  currentUserEmail,
}: {
  children: ReactNode;
  currentUserEmail: string | null;
}) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-[#f4f6fb]">
      <div className="mx-auto flex w-full max-w-[1700px] gap-4 px-4 py-4 md:px-6">
        <aside className="sticky top-4 hidden h-[calc(100vh-2rem)] w-[260px] shrink-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:block">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Voho Platform</p>
          <p className="mt-2 text-sm text-slate-600">{currentUserEmail ?? "Signed in"}</p>

          <nav className="mt-6 space-y-2">
            <Link href="/reports" className={navClass(isActive(pathname, "/reports"))}>
              Reports
            </Link>
            <Link href="/track" className={navClass(isActive(pathname, "/track"))}>
              Tracking
            </Link>
            <Link href="/team-overview" className={navClass(isActive(pathname, "/team-overview"))}>
              Team overview
            </Link>
            <Link href="/projects" className={navClass(isActive(pathname, "/projects"))}>
              Projects
            </Link>
            <Link href="/members" className={navClass(isActive(pathname, "/members") || isActive(pathname, "/member"))}>
              Members
            </Link>
            <Link href="/kpis" className={navClass(isActive(pathname, "/kpis"))}>
              KPIs
            </Link>
          </nav>

          <button
            type="button"
            onClick={async () => {
              await fetch("/api/auth/logout", { method: "POST" });
              window.location.href = "/login";
            }}
            className="mt-6 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700"
          >
            Sign out
          </button>
        </aside>

        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
