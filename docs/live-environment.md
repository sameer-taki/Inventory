# Live environment

## Supabase — provisioned ✅

| | |
|---|---|
| Project | `golden-operations-platform` |
| Ref | `jvthwlypnwfcpgrnxqkh` |
| Region | `ap-southeast-2` (Sydney) |
| API URL | `https://jvthwlypnwfcpgrnxqkh.supabase.co` |
| Plan cost | ~US$10/month (org `wjgywgazknunhztizhac`) |

**Applied:** migrations `0001`–`0008`, demo/bootstrap seed, and the exposed-schemas
setting (`public, graphql_public, ops, quality, mfg, fleet` on the `authenticator`
role). Verified live: 4 users, 3 items, 3 NCRs, 1 CAPA, 3 work centres, 2 vehicles,
4 renewals.

**Admin bootstrap:** `sameer@golden.com.fj` is pre-provisioned with the `admin`
role. Sign up in the app with that email (Supabase Auth) and the trigger links +
activates the account with admin access.

## App env vars (client-safe)

```
NEXT_PUBLIC_SUPABASE_URL=https://jvthwlypnwfcpgrnxqkh.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon/publishable key from Supabase → Project Settings → API>
```

The app's runtime paths use only these two (client + server + middleware). The
service-role key is **not** required for the app to run (no code path uses it);
add `SUPABASE_SERVICE_ROLE_KEY` later only if you build system/service-role jobs.

## Vercel — recommended: connect the GitHub repo (CI/CD)

The maintainable production setup is to import the repo so every push builds:

1. Vercel → **Add New… → Project → Import** `sameer-taki/Inventory`.
2. Framework preset: **Next.js** (auto-detected). Root directory: repo root.
3. **Environment Variables** — add the two `NEXT_PUBLIC_SUPABASE_*` values above
   (Production + Preview).
4. **Deploy.**
5. In Supabase → **Authentication → URL Configuration**, set **Site URL** and add
   redirect URLs for the deployed Vercel domain(s).

This gives automatic deploys on push to the branch. (A one-off file-tree deploy is
also possible but produces a git-disconnected project that won't auto-update.)
