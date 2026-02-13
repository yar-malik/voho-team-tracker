import { cookies } from "next/headers";
import { ReactNode } from "react";
import PlatformShell from "@/app/components/PlatformShell";

export default async function PlatformLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const currentUserEmail = cookieStore.get("voho_user_email")?.value ?? null;

  return <PlatformShell currentUserEmail={currentUserEmail}>{children}</PlatformShell>;
}

