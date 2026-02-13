import TimeDashboard from "@/app/components/TimeDashboard";
import { listMemberProfiles } from "@/lib/manualTimeEntriesStore";

export default async function ReportsPage() {
  const members = await listMemberProfiles();
  return <TimeDashboard members={members.map((m) => ({ name: m.name }))} initialMode="all" />;
}

