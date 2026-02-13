import "server-only";
import { cookies } from "next/headers";
import { getUserFromAccessToken } from "@/lib/supabaseAuth";

function isSupabaseConfigured() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function supabaseHeaders() {
  const token = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return {
    apikey: token,
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

export async function getCurrentUserContext() {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get("voho_access_token")?.value ?? "";
  const authUser = await getUserFromAccessToken(accessToken);
  if (!authUser?.email) return null;
  if (!isSupabaseConfigured()) {
    return { email: authUser.email, role: "member" };
  }

  const url =
    `${process.env.SUPABASE_URL!}/rest/v1/members` +
    `?select=member_name,email,role` +
    `&email=eq.${encodeURIComponent(authUser.email)}` +
    `&limit=1`;
  const response = await fetch(url, {
    method: "GET",
    headers: supabaseHeaders(),
    cache: "no-store",
  });
  if (!response.ok) return { email: authUser.email, role: "member" };
  const rows = (await response.json()) as Array<{ role?: string }>;
  return {
    email: authUser.email,
    role: rows[0]?.role ?? "member",
  };
}

export async function requireAdminOrThrow() {
  const context = await getCurrentUserContext();
  if (!context) throw new Error("Unauthorized");
  if (context.role !== "admin") throw new Error("Forbidden");
  return context;
}

export async function requireSignedInOrThrow() {
  const context = await getCurrentUserContext();
  if (!context) throw new Error("Unauthorized");
  return context;
}
