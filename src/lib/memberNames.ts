import "server-only";

const CANONICAL_BY_KEY: Record<string, string> = {
  rehman: "Rehman",
  rahman: "Rehman",
};

const ALIASES_BY_CANONICAL: Record<string, string[]> = {
  Rehman: ["Rehman", "Rahman"],
};

function normalizeLookupKey(value: string) {
  return value.trim().toLowerCase();
}

export function canonicalizeMemberName(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return CANONICAL_BY_KEY[normalizeLookupKey(trimmed)] ?? trimmed;
}

export function expandMemberAliases(value: string) {
  const canonical = canonicalizeMemberName(value);
  const aliases = ALIASES_BY_CANONICAL[canonical] ?? [canonical];
  return Array.from(new Set(aliases.map((item) => item.trim()).filter((item) => item.length > 0)));
}

export function namesMatch(a: string, b: string) {
  if (!a.trim() || !b.trim()) return false;
  return normalizeLookupKey(canonicalizeMemberName(a)) === normalizeLookupKey(canonicalizeMemberName(b));
}
