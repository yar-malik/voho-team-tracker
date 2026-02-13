import { cookies } from "next/headers";
import { getCurrentUserContext } from "@/lib/authorization";
import { getMemberNameByEmail } from "@/lib/manualTimeEntriesStore";

export default async function SettingsPage() {
  const context = await getCurrentUserContext();
  const cookieStore = await cookies();
  const cookieEmail = cookieStore.get("voho_user_email")?.value ?? null;
  const email = context?.email ?? cookieEmail;
  const memberName = email ? await getMemberNameByEmail(email) : null;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">Settings</h1>
        <p className="mt-1 text-sm text-slate-600">Account profile details.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Username</span>
          <input
            type="text"
            value={memberName ?? "Not linked"}
            readOnly
            disabled
            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-medium text-slate-700"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Email</span>
          <input
            type="email"
            value={email ?? "Not available"}
            readOnly
            disabled
            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-medium text-slate-700"
          />
        </label>
      </div>
    </section>
  );
}
