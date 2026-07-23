import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "./env";

/**
 * Service-role client — bypasses RLS. SERVER ONLY.
 *
 * Reserved for the "single writer" system paths (P2/I2/F2): appending
 * integration_outbox rows, admin provisioning, nightly jobs. Never import this
 * into client code and never use it to shortcut a role check that belongs in an
 * RPC. Day-to-day module writes go through the user-scoped RPCs instead.
 */
export function createServiceClient() {
  return createClient(
    SUPABASE_URL,
    (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim(),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
