import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { fmtDate } from "@/lib/format";
import { ApproveRoutingButton } from "./ApproveRoutingButton";

export const dynamic = "force-dynamic";

type Routing = {
  routing_id: number;
  item_id: number;
  version_no: number;
  status: string;
  effective_from: string;
  effective_to: string | null;
};

function statusTone(s: string) {
  return s === "approved" ? "renewed" : s === "draft" ? "open" : s;
}

export default async function RoutingsPage() {
  const supabase = await createClient();
  const [{ data: routings }, { data: items }, { data: ops }] = await Promise.all([
    supabase
      .schema("mfg")
      .from("routings")
      .select("routing_id, item_id, version_no, status, effective_from, effective_to")
      .order("item_id")
      .order("version_no", { ascending: false })
      .returns<Routing[]>(),
    supabase
      .schema("ops")
      .from("items")
      .select("item_id, item_no, description")
      .returns<{ item_id: number; item_no: string; description: string }[]>(),
    supabase
      .schema("mfg")
      .from("routing_operations")
      .select("routing_id")
      .returns<{ routing_id: number }[]>(),
  ]);
  const itemMap = new Map((items ?? []).map((i) => [i.item_id, i]));
  const opCount = new Map<number, number>();
  for (const o of ops ?? []) opCount.set(o.routing_id, (opCount.get(o.routing_id) ?? 0) + 1);

  return (
    <div>
      <PageHeader
        title="Routings"
        subtitle="Operation sequences over work centres — the basis of capacity load (M5) and the labour/overhead half of the cost roll. Versioned and approval-gated (ECO-lite, M3)."
        action={{ href: "/manufacturing/routings/new", label: "New routing" }}
      />
      <div className="card overflow-hidden">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-2.5">Item</th>
              <th className="px-4 py-2.5">Version</th>
              <th className="px-4 py-2.5">Operations</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5">Effective</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {routings && routings.length > 0 ? (
              routings.map((r) => (
                <tr key={r.routing_id}>
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/manufacturing/routings/${r.routing_id}`}
                      className="font-medium text-gold-700 hover:underline"
                    >
                      {itemMap.get(r.item_id)?.item_no ?? r.item_id}
                    </Link>
                    <span className="ml-2 text-slate-400">
                      {itemMap.get(r.item_id)?.description}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-slate-600">v{r.version_no}</td>
                  <td className="px-4 py-2.5 text-slate-500">{opCount.get(r.routing_id) ?? 0}</td>
                  <td className="px-4 py-2.5">
                    <StatusBadge value={statusTone(r.status)} />
                  </td>
                  <td className="px-4 py-2.5 text-slate-500">
                    {fmtDate(r.effective_from)}
                    {r.effective_to ? ` → ${fmtDate(r.effective_to)}` : ""}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {r.status === "draft" && <ApproveRoutingButton routingId={r.routing_id} />}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-slate-400">
                  No routings yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
