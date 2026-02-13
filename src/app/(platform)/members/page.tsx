import MembersPageClient from "@/app/components/MembersPageClient";
import { listMemberProfiles } from "@/lib/manualTimeEntriesStore";

export default async function MembersPage() {
  const members = await listMemberProfiles();
  return <MembersPageClient initialMembers={members.map((m) => ({ name: m.name, email: m.email, role: m.role }))} />;
}

