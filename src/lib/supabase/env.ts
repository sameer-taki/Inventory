// Centralised, whitespace-safe reads of the public Supabase config.
// NEXT_PUBLIC_* values are inlined at build time; trimming guards against a
// stray leading/trailing space in the env var (a common copy-paste mistake)
// that would otherwise produce an invalid URL and break the client.
export const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
export const SUPABASE_ANON_KEY = (
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""
).trim();
