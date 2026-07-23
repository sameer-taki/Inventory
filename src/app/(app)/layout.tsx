import Link from "next/link";
import { redirect } from "next/navigation";
import { Sidebar } from "@/components/Sidebar";
import { getSessionContext } from "@/lib/auth";
import { titleCase } from "@/lib/format";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");

  // Signed in but not yet activated by an admin — RLS hides everything.
  if (!ctx.isMember) {
    return (
      <PendingAccess email={ctx.email} />
    );
  }

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-64 shrink-0 border-r border-slate-200 bg-white md:block">
        <Sidebar
          isAdmin={ctx.roles.includes("admin")}
          isFleetAdmin={ctx.roles.includes("fleet_admin")}
        />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
          <div className="text-sm text-slate-500">
            {ctx.profile?.full_name || ctx.email}
            {ctx.roles.length > 0 && (
              <span className="ml-2 space-x-1">
                {ctx.roles.map((r) => (
                  <span
                    key={r}
                    className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600"
                  >
                    {titleCase(r)}
                  </span>
                ))}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/account/password"
              className="btn-secondary py-1.5 text-xs"
            >
              Account
            </Link>
            <form action="/auth/signout" method="post">
              <button type="submit" className="btn-secondary py-1.5 text-xs">
                Sign out
              </button>
            </form>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto px-6 py-6">{children}</main>
      </div>
    </div>
  );
}

function PendingAccess({ email }: { email: string | null }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="card max-w-md p-8 text-center">
        <h1 className="text-lg font-semibold text-slate-900">
          Access pending activation
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          You&apos;re signed in as{" "}
          <span className="font-medium">{email}</span>, but your account has not
          been activated on the Golden Operations Platform yet. An administrator
          needs to activate your access and assign a role.
        </p>
        <form action="/auth/signout" method="post" className="mt-6">
          <button type="submit" className="btn-secondary">
            Sign out
          </button>
        </form>
      </div>
    </main>
  );
}
