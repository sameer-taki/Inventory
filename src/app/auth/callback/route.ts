import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * OAuth / recovery callback. Supabase redirects here with a PKCE `code` after
 * the user clicks an email link (e.g. password recovery). We exchange it for a
 * session (setting the auth cookies) and forward to `next`.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }
  return NextResponse.redirect(
    `${origin}/login?error=${encodeURIComponent("Reset link is invalid or has expired.")}`,
  );
}
