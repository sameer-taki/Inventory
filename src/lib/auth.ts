import { createClient } from "@/lib/supabase/server";

export type Profile = {
  user_id: number;
  email: string;
  full_name: string | null;
  is_active: boolean;
};

export type SessionContext = {
  authUserId: string;
  email: string | null;
  profile: Profile | null;
  roles: string[];
  /** true once linked to an active ops.users row (RLS `is_member()`). */
  isMember: boolean;
};

/**
 * Resolves the current session's platform profile + roles. Returns null when
 * there is no authenticated user at all. A signed-in user who has not yet been
 * activated by an admin returns { profile: null, isMember: false } — RLS hides
 * their own row until they are active, which the UI reads as "pending access".
 */
export async function getSessionContext(): Promise<SessionContext | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .schema("ops")
    .from("users")
    .select("user_id, email, full_name, is_active")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  let roles: string[] = [];
  if (profile) {
    const { data: roleRows } = await supabase
      .schema("ops")
      .from("user_roles")
      .select("role_key")
      .eq("user_id", profile.user_id);
    roles = (roleRows ?? []).map((r) => r.role_key as string);
  }

  return {
    authUserId: user.id,
    email: user.email ?? null,
    profile: (profile as Profile) ?? null,
    roles,
    isMember: Boolean(profile?.is_active),
  };
}

export function hasAnyRole(roles: string[], wanted: string[]): boolean {
  return roles.some((r) => wanted.includes(r));
}

export const QUALITY_WRITE_ROLES = ["quality", "supervisor", "admin"];
export const CAPA_WRITE_ROLES = ["quality", "admin"];
