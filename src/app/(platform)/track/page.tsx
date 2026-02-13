import TrackPageClient from "@/app/components/TrackPageClient";
import { getCurrentUserContext } from "@/lib/authorization";
import { getMemberNameByEmail, listMemberProfiles } from "@/lib/manualTimeEntriesStore";

export default async function TrackPage() {
  const context = await getCurrentUserContext();
  const memberNameByEmail = context?.email ? await getMemberNameByEmail(context.email) : null;
  let memberName = memberNameByEmail;

  if (!memberName && context?.email) {
    const members = await listMemberProfiles();
    const byEmail = new Map(
      members
        .filter((member) => member.email)
        .map((member) => [member.email!.trim().toLowerCase(), member.name] as const)
    );
    memberName = byEmail.get(context.email.trim().toLowerCase()) ?? null;
  }

  if (!memberName) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold text-slate-900">Tracking</h1>
        <p className="mt-2 text-sm text-slate-600">
          Your account is signed in, but no member profile is linked to this email yet.
        </p>
        <p className="mt-1 text-sm text-slate-600">Ask an admin to set your member email in the Members list.</p>
      </section>
    );
  }

  return <TrackPageClient memberName={memberName} />;
}
