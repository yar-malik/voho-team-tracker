import { notFound } from "next/navigation";
import MemberProfilePageClient from "@/app/components/MemberProfilePageClient";
import { listMembers } from "@/lib/manualTimeEntriesStore";

function isValidDateInput(value: string | undefined) {
  if (!value) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export default async function MemberProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ name: string }>;
  searchParams: Promise<{ date?: string }>;
}) {
  const resolvedParams = await params;
  const resolvedSearch = await searchParams;
  let memberName = resolvedParams.name;
  try {
    memberName = decodeURIComponent(resolvedParams.name);
  } catch {
    notFound();
  }
  const members = await listMembers();
  const exists = members.some((member) => member.toLowerCase() === memberName.toLowerCase());
  if (!exists) {
    notFound();
  }

  const initialDate = isValidDateInput(resolvedSearch.date) ? resolvedSearch.date! : new Date().toISOString().slice(0, 10);
  return <MemberProfilePageClient memberName={memberName} initialDate={initialDate} />;
}
