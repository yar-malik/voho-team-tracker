"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import TimeDashboard from "@/app/components/TimeDashboard";

type Member = { name: string; email?: string | null; role?: string | null };
type Project = { key: string; name: string; source: "manual" | "external" };
type Kpi = { id: number; member: string; label: string; value: string; notes: string | null };

type Section = "reports" | "team" | "projects" | "members" | "kpis";

export default function PlatformHomeClient({
  members,
  projects,
  kpis,
  currentUserEmail,
}: {
  members: Member[];
  projects: Project[];
  kpis: Kpi[];
  currentUserEmail: string | null;
}) {
  const [section, setSection] = useState<Section>("reports");
  const [allProjects, setAllProjects] = useState<Project[]>(projects);
  const [allMembers, setAllMembers] = useState<Member[]>(members);
  const [allKpis, setAllKpis] = useState<Kpi[]>(kpis);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newProjectName, setNewProjectName] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [invitePassword, setInvitePassword] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [kpiMember, setKpiMember] = useState(members[0]?.name ?? "");
  const [kpiLabel, setKpiLabel] = useState("");
  const [kpiValue, setKpiValue] = useState("");
  const [kpiNotes, setKpiNotes] = useState("");

  const dashboardMembers = useMemo(() => allMembers.map((m) => ({ name: m.name })), [allMembers]);

  return (
    <div className="min-h-screen bg-[#f4f6fb]">
      <div className="mx-auto flex w-full max-w-[1700px] gap-4 px-4 py-4 md:px-6">
        <aside className="sticky top-4 hidden h-[calc(100vh-2rem)] w-[260px] shrink-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:block">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Voho Track</p>
          <p className="mt-2 text-sm text-slate-600">{currentUserEmail ?? "Signed in"}</p>
          <nav className="mt-6 space-y-2 text-sm">
            <button
              type="button"
              onClick={() => setSection("reports")}
              className={`block w-full rounded-lg px-3 py-2 text-left font-medium ${section === "reports" ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"}`}
            >
              Reports
            </button>
            <button
              type="button"
              onClick={() => setSection("team")}
              className={`block w-full rounded-lg px-3 py-2 text-left font-medium ${section === "team" ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"}`}
            >
              Team overview
            </button>
            <button
              type="button"
              onClick={() => setSection("projects")}
              className={`block w-full rounded-lg px-3 py-2 text-left font-medium ${section === "projects" ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"}`}
            >
              Projects
            </button>
            <button
              type="button"
              onClick={() => setSection("members")}
              className={`block w-full rounded-lg px-3 py-2 text-left font-medium ${section === "members" ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"}`}
            >
              Members
            </button>
            <button
              type="button"
              onClick={() => setSection("kpis")}
              className={`block w-full rounded-lg px-3 py-2 text-left font-medium ${section === "kpis" ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"}`}
            >
              KPIs
            </button>
          </nav>
          <button
            type="button"
            onClick={async () => {
              await fetch("/api/auth/logout", { method: "POST" });
              window.location.href = "/login";
            }}
            className="mt-4 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700"
          >
            Sign out
          </button>
          {error && <p className="mt-3 rounded bg-rose-50 px-2 py-1 text-xs text-rose-700">{error}</p>}
        </aside>

        <main className="min-w-0 flex-1 space-y-4">
          {(section === "reports" || section === "team") && (
            <TimeDashboard members={dashboardMembers} initialMode={section === "team" ? "team" : "all"} />
          )}

          {section === "projects" && (
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <h1 className="text-2xl font-semibold text-slate-900">Projects</h1>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newProjectName}
                    onChange={(event) => setNewProjectName(event.target.value)}
                    placeholder="New project"
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                  <button
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      if (!newProjectName.trim()) {
                        setError("Project name is required");
                        return;
                      }
                      setBusy(true);
                      setError(null);
                      try {
                        const res = await fetch("/api/projects", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ name: newProjectName }),
                        });
                        const data = (await res.json()) as { error?: string; project?: Project };
                        if (!res.ok || data.error) throw new Error(data.error || "Failed to create project");
                        if (data.project) {
                          setAllProjects((prev) => [...prev.filter((p) => p.key !== data.project!.key), data.project!].sort((a, b) => a.name.localeCompare(b.name)));
                        }
                        setNewProjectName("");
                      } catch (err) {
                        setError(err instanceof Error ? err.message : "Failed to create project");
                      } finally {
                        setBusy(false);
                      }
                    }}
                    className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-400"
                  >
                    New project
                  </button>
                </div>
              </div>
              <p className="mt-1 text-sm text-slate-600">All projects in your workspace.</p>
              <div className="mt-4 overflow-auto rounded-xl border border-slate-200">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-left text-slate-600">
                    <tr>
                      <th className="px-4 py-2">Project</th>
                      <th className="px-4 py-2">Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allProjects.map((project) => (
                      <tr key={project.key} className="border-t border-slate-100">
                        <td className="px-4 py-2 font-medium text-slate-900">{project.name}</td>
                        <td className="px-4 py-2 text-slate-600">{project.source}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {section === "members" && (
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h1 className="text-2xl font-semibold text-slate-900">Members</h1>
              <p className="mt-1 text-sm text-slate-600">Invite and manage team members.</p>
              <div className="mt-4 grid gap-2 md:grid-cols-2">
                <input
                  type="text"
                  value={inviteName}
                  onChange={(event) => setInviteName(event.target.value)}
                  placeholder="Member name"
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(event) => setInviteEmail(event.target.value)}
                  placeholder="Member email"
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
                <input
                  type="password"
                  value={invitePassword}
                  onChange={(event) => setInvitePassword(event.target.value)}
                  placeholder="Temporary password"
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
                <div className="flex gap-2">
                  <select
                    value={inviteRole}
                    onChange={(event) => setInviteRole(event.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option value="member">member</option>
                    <option value="admin">admin</option>
                  </select>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      if (!inviteName.trim() || !inviteEmail.trim() || !invitePassword.trim()) {
                        setError("Name, email and password are required");
                        return;
                      }
                      setBusy(true);
                      setError(null);
                      try {
                        const res = await fetch("/api/members", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            name: inviteName,
                            email: inviteEmail,
                            password: invitePassword,
                            role: inviteRole,
                          }),
                        });
                        const data = (await res.json()) as { error?: string; member?: Member };
                        if (!res.ok || data.error) throw new Error(data.error || "Failed to invite member");
                        if (data.member) {
                          setAllMembers((prev) =>
                            [...prev.filter((m) => m.name.toLowerCase() !== data.member!.name.toLowerCase()), data.member!].sort((a, b) =>
                              a.name.localeCompare(b.name)
                            )
                          );
                        }
                        setInviteName("");
                        setInviteEmail("");
                        setInvitePassword("");
                        setInviteRole("member");
                      } catch (err) {
                        setError(err instanceof Error ? err.message : "Failed to invite member");
                      } finally {
                        setBusy(false);
                      }
                    }}
                    className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-400"
                  >
                    Invite
                  </button>
                </div>
              </div>
              <div className="mt-4 overflow-auto rounded-xl border border-slate-200">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-left text-slate-600">
                    <tr>
                      <th className="px-4 py-2">Name</th>
                      <th className="px-4 py-2">Email</th>
                      <th className="px-4 py-2">Role</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allMembers.map((member) => (
                      <tr key={member.name} className="border-t border-slate-100">
                        <td className="px-4 py-2 font-medium text-slate-900">
                          <Link href={`/member/${encodeURIComponent(member.name)}`} className="text-sky-700 hover:underline">
                            {member.name}
                          </Link>
                        </td>
                        <td className="px-4 py-2 text-slate-600">{member.email || "—"}</td>
                        <td className="px-4 py-2 text-slate-600">{member.role || "member"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {section === "kpis" && (
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h1 className="text-2xl font-semibold text-slate-900">KPIs</h1>
              <p className="mt-1 text-sm text-slate-600">Member KPI registry managed inside the platform.</p>
              <div className="mt-4 grid gap-2 md:grid-cols-2">
                <select
                  value={kpiMember}
                  onChange={(event) => setKpiMember(event.target.value)}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  {allMembers.map((member) => (
                    <option key={member.name} value={member.name}>
                      {member.name}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={kpiLabel}
                  onChange={(event) => setKpiLabel(event.target.value)}
                  placeholder="KPI label"
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
                <input
                  type="text"
                  value={kpiValue}
                  onChange={(event) => setKpiValue(event.target.value)}
                  placeholder="KPI value"
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
                <input
                  type="text"
                  value={kpiNotes}
                  onChange={(event) => setKpiNotes(event.target.value)}
                  placeholder="Notes"
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    if (!kpiMember || !kpiLabel.trim() || !kpiValue.trim()) {
                      setError("Member, KPI label and value are required");
                      return;
                    }
                    setBusy(true);
                    setError(null);
                    try {
                      const res = await fetch("/api/kpis", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          member: kpiMember,
                          label: kpiLabel,
                          value: kpiValue,
                          notes: kpiNotes,
                        }),
                      });
                      const data = (await res.json()) as { error?: string; kpi?: Kpi };
                      if (!res.ok || data.error) throw new Error(data.error || "Failed to save KPI");
                      if (data.kpi) {
                        setAllKpis((prev) => [...prev.filter((item) => item.id !== data.kpi!.id), data.kpi!].sort((a, b) => a.member.localeCompare(b.member) || a.label.localeCompare(b.label)));
                      }
                      setKpiLabel("");
                      setKpiValue("");
                      setKpiNotes("");
                    } catch (err) {
                      setError(err instanceof Error ? err.message : "Failed to save KPI");
                    } finally {
                      setBusy(false);
                    }
                  }}
                  className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-400"
                >
                  Save KPI
                </button>
              </div>
              <div className="mt-4 overflow-auto rounded-xl border border-slate-200">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-left text-slate-600">
                    <tr>
                      <th className="px-4 py-2">Member</th>
                      <th className="px-4 py-2">KPI</th>
                      <th className="px-4 py-2">Value</th>
                      <th className="px-4 py-2">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allKpis.map((kpi) => (
                      <tr key={kpi.id} className="border-t border-slate-100">
                        <td className="px-4 py-2 font-medium text-slate-900">{kpi.member}</td>
                        <td className="px-4 py-2 text-slate-700">{kpi.label}</td>
                        <td className="px-4 py-2 text-slate-700">{kpi.value}</td>
                        <td className="px-4 py-2 text-slate-600">{kpi.notes || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
