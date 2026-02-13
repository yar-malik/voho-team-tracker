"use client";

import Link from "next/link";
import { useState } from "react";

type Member = { name: string; email?: string | null; role?: string | null };

export default function MembersPageClient({ initialMembers }: { initialMembers: Member[] }) {
  const [members, setMembers] = useState(initialMembers);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("member");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h1 className="text-2xl font-semibold text-slate-900">Members</h1>
      <p className="mt-1 text-sm text-slate-600">Invite and manage team members.</p>

      <div className="mt-4 grid gap-2 md:grid-cols-2">
        <input
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Member name"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="Member email"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Temporary password"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <div className="flex gap-2">
          <select
            value={role}
            onChange={(event) => setRole(event.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="member">member</option>
            <option value="admin">admin</option>
          </select>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              if (!name.trim() || !email.trim() || !password.trim()) {
                setError("Name, email and password are required");
                return;
              }
              setBusy(true);
              setError(null);
              try {
                const res = await fetch("/api/members", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ name, email, password, role }),
                });
                const data = (await res.json()) as { error?: string; member?: Member };
                if (!res.ok || data.error) throw new Error(data.error || "Failed to invite member");
                if (data.member) {
                  setMembers((prev) =>
                    [...prev.filter((m) => m.name.toLowerCase() !== data.member!.name.toLowerCase()), data.member!].sort((a, b) =>
                      a.name.localeCompare(b.name)
                    )
                  );
                }
                setName("");
                setEmail("");
                setPassword("");
                setRole("member");
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

      {error && <p className="mt-3 rounded bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

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
            {members.map((member) => (
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
  );
}

