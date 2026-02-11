import TimeDashboard from "@/app/components/TimeDashboard";
import { getTeamMembers } from "@/lib/toggl";

export default function Home() {
  const members = getTeamMembers();

  return (
    <div className="min-h-screen bg-[#EDFDF5]">
      <main className="mx-auto flex w-full max-w-none flex-col gap-8 px-8 py-8 md:px-10">
        <header className="space-y-3">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-700">
            Voho Team Overview
          </p>
          <h1 className="text-3xl font-semibold text-slate-900 md:text-4xl">
            Track daily activity without hopping between accounts.
          </h1>
          <p className="max-w-2xl text-base text-slate-600">
            Pick a teammate and date to see their logged time, running timer, and daily summary.
            Tokens stay server-side for safety.
          </p>
        </header>

        <TimeDashboard members={members} />
      </main>
    </div>
  );
}
