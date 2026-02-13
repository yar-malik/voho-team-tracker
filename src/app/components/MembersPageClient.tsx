"use client";

import Link from "next/link";

type Member = { name: string; email?: string | null; role?: string | null };

export default function MembersPageClient({ initialMembers }: { initialMembers: Member[] }) {
  const members = initialMembers;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h1 className="text-2xl font-semibold text-slate-900">Members</h1>
      <p className="mt-1 text-sm text-slate-600">Open a member to view detailed time entries and KPIs.</p>

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
            {members.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-slate-500">
                  No members found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
