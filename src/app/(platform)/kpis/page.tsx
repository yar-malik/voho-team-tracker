import KpisPageClient from "@/app/components/KpisPageClient";
import { listMemberKpis, listMemberProfiles } from "@/lib/manualTimeEntriesStore";

export default async function KpisPage() {
  const [members, kpis] = await Promise.all([listMemberProfiles(), listMemberKpis()]);
  return (
    <KpisPageClient
      members={members.map((m) => ({ name: m.name }))}
      initialKpis={kpis.map((k) => ({
        id: k.id,
        member: k.member_name,
        label: k.kpi_label,
        value: k.kpi_value,
        notes: k.notes,
      }))}
    />
  );
}

