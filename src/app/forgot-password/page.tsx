"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    });
    setBusy(false);
    if (error) setError(error.message);
    else setSent(true);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-lg bg-gold-600 text-lg font-bold text-white">
            G
          </div>
          <h1 className="text-xl font-semibold text-slate-900">
            Reset your password
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            We&apos;ll email you a secure link to set a new one.
          </p>
        </div>

        {sent ? (
          <div className="card space-y-4 p-6 text-center">
            <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              If an account exists for <span className="font-medium">{email}</span>,
              a password-reset link is on its way. Open it on this device to
              continue.
            </p>
            <Link href="/login" className="btn-secondary w-full">
              Back to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="card space-y-4 p-6">
            <div>
              <label className="label" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                className="field"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            {error && (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            )}

            <button type="submit" className="btn-primary w-full" disabled={busy}>
              {busy ? "Sending…" : "Send reset link"}
            </button>

            <p className="text-center text-sm text-slate-500">
              Remembered it?{" "}
              <Link
                href="/login"
                className="font-medium text-gold-700 hover:underline"
              >
                Sign in
              </Link>
            </p>
          </form>
        )}
      </div>
    </main>
  );
}
