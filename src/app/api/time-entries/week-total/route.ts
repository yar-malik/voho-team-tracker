import { NextRequest, NextResponse } from "next/server";
import { getMemberWeekTotalSeconds, resolveCanonicalMemberName } from "@/lib/manualTimeEntriesStore";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const member = searchParams.get("member")?.trim();
  const dateParam = searchParams.get("date")?.trim();

  if (!member) {
    return NextResponse.json({ error: "Missing member" }, { status: 400 });
  }
  const endDate = dateParam || new Date().toISOString().slice(0, 10);
  if (!DATE_RE.test(endDate)) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  }

  const canonicalMember = await resolveCanonicalMemberName(member);
  if (!canonicalMember) {
    return NextResponse.json({ error: "Unknown member" }, { status: 404 });
  }

  try {
    const totalSeconds = await getMemberWeekTotalSeconds(canonicalMember, endDate);
    return NextResponse.json({
      member: canonicalMember,
      endDate,
      totalSeconds,
      source: "db",
      cachedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load week total";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
