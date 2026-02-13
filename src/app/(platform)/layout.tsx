import { cookies } from "next/headers";
import { ReactNode } from "react";
import PlatformShell from "@/app/components/PlatformShell";
import { getMemberNameByEmail } from "@/lib/manualTimeEntriesStore";

export default async function PlatformLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const currentUserEmail = cookieStore.get("voho_user_email")?.value ?? null;
  const currentMemberName = currentUserEmail ? await getMemberNameByEmail(currentUserEmail) : null;

  return (
    <PlatformShell currentUserEmail={currentUserEmail} currentMemberName={currentMemberName}>
      {children}
    </PlatformShell>
  );
}
