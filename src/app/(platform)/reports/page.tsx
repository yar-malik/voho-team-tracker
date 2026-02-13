import TimeDashboard from "@/app/components/TimeDashboard";
import { getCurrentUserContext } from "@/lib/authorization";
import { getMemberNameByEmail, listMemberProfiles } from "@/lib/manualTimeEntriesStore";
import { cookies } from "next/headers";

export default async function ReportsPage() {
  const members = await listMemberProfiles();
  const context = await getCurrentUserContext();
  const cookieStore = await cookies();
  const cookieEmail = cookieStore.get("voho_user_email")?.value ?? null;
  const resolvedEmail = context?.email ?? cookieEmail;

  const memberNameByEmail = resolvedEmail ? await getMemberNameByEmail(resolvedEmail) : null;
  let memberName = memberNameByEmail;
  if (!memberName && resolvedEmail) {
    const byEmail = new Map(
      members
        .filter((member) => member.email)
        .map((member) => [member.email!.trim().toLowerCase(), member.name] as const)
    );
    memberName = byEmail.get(resolvedEmail.trim().toLowerCase()) ?? null;
  }

  if (!memberName) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold text-slate-900">Reports</h1>
        <p className="mt-2 text-sm text-slate-600">
          Your account is signed in, but no member profile is linked to this email yet.
        </p>
        <p className="mt-1 text-sm text-slate-600">Ask an admin to set your member email in the Members list.</p>
      </section>
    );
  }

  return (
    <TimeDashboard
      members={members.map((m) => ({ name: m.name }))}
      initialMode="member"
      restrictToMember={memberName}
    />
  );
}
