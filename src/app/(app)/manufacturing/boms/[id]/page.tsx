import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { StatusBadge } from "@/components/StatusBadge";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { ApproveBomButton } from "../ApproveBomButton";

export const dynamic = "force-dynamic";

type Bom = {
  bom_id: number;
  item_id: number;
  version_no: number;
  status: string;
  effective_from: string;
  effective_to: string | null;
  approved_by: number | null;
  approved_at: string | null;
  source: string;
  created_at: string;
};
type Line = {
  line_no: number;
  component_item_id: number;
  qty_per: number;
  uom: string;
  scrap_pct: number;
  is_phantom: boolean;
};

function statusTone(s: string) {
  return s === "approved" ? "renewed" : s === "draft" ? "open" : s;
}

export default async function BomDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const bomId = Number(id);
  if (!Number.isFinite(bomId)) notFound();

  const supabase = await createClient();
  const { data: bom } = await supabase
    .schema("mfg")
    .from("boms")
    .select("*")
    .eq("bom_id", bomId)
    .maybeSingle<Bom>();
  if (!bom) notFound();

  const [{ data: lines }, { data: versions }, { data: item }] = await Promise.all([
    supabase
      .schema("mfg")
      .from("bom_lines")
      .select("line_no, component_item_id, qty_per, uom, scrap_pct, is_phantom")
      .eq("bom_id", bom.bom_id)
      .order("line_no")
      .returns<Line[]>(),
    supabase
      .schema("mfg")
      .from("boms")
      .select("bom_id, version_no, status, effective_from, effective_to, approved_by, approved_at, created_at")
      .eq("item_id", bom.item_id)
      .order("version_no", { ascending: false })
      .returns<Bom[]>(),
    supabase
      .schema("ops")
      .from("items")
      .select("item_no, description")
      .eq("item_id", bom.item_id)
      .maybeSingle<{ item_no: string; description: string }>(),
  ]);

  // previous version (immediately lower version_no) for the ECO diff
  const prev = (versions ?? [])
    .filter((v) => v.version_no < bom.version_no)
    .sort((a, b) => b.version_no - a.version_no)[0];
  let prevLines: Line[] = [];
  if (prev) {
    const { data } = await supabase
      .schema("mfg")
      .from("bom_lines")
      .select("line_no, component_item_id, qty_per, uom, scrap_pct, is_phantom")
      .eq("bom_id", prev.bom_id)
      .returns<Line[]>();
    prevLines = data ?? [];
  }

  // resolve component + approver names
  const compIds = Array.from(
    new Set([...(lines ?? []), ...prevLines].map((l) => l.component_item_id)),
  );
  const approverIds = Array.from(
    new Set((versions ?? []).map((v) => v.approved_by).filter((x): x is number => !!x)),
  );
  const [{ data: comps }, { data: users }] = await Promise.all([
    compIds.length
      ? supabase.schema("ops").from("items").select("item_id, item_no").in("item_id", compIds)
          .returns<{ item_id: number; item_no: string }[]>()
      : Promise.resolve({ data: [] as { item_id: number; item_no: string }[] }),
    approverIds.length
      ? supabase.schema("ops").from("users").select("user_id, full_name, email").in("user_id", approverIds)
          .returns<{ user_id: number; full_name: string | null; email: string }[]>()
      : Promise.resolve({ data: [] as { user_id: number; full_name: string | null; email: string }[] }),
  ]);
  const compMap = new Map((comps ?? []).map((c) => [c.item_id, c.item_no]));
  const userMap = new Map((users ?? []).map((u) => [u.user_id, u.full_name || u.email]));

  // build the diff
  const prevMap = new Map(prevLines.map((l) => [l.component_item_id, l]));
  const curMap = new Map((lines ?? []).map((l) => [l.component_item_id, l]));
  type DiffRow = { kind: "added" | "removed" | "changed" | "unchanged"; item: string; detail: string };
  const diff: DiffRow[] = [];
  for (const l of lines ?? []) {
    const p = prevMap.get(l.component_item_id);
    const name = compMap.get(l.component_item_id) ?? String(l.component_item_id);
    if (!p) {
      diff.push({ kind: "added", item: name, detail: `qty ${l.qty_per} ${l.uom}, scrap ${l.scrap_pct}%` });
    } else if (Number(p.qty_per) !== Number(l.qty_per) || Number(p.scrap_pct) !== Number(l.scrap_pct) || p.uom !== l.uom) {
      diff.push({
        kind: "changed",
        item: name,
        detail: `qty ${p.qty_per}→${l.qty_per} ${l.uom}, scrap ${p.scrap_pct}%→${l.scrap_pct}%`,
      });
    } else {
      diff.push({ kind: "unchanged", item: name, detail: `qty ${l.qty_per} ${l.uom}` });
    }
  }
  for (const l of prevLines) {
    if (!curMap.has(l.component_item_id)) {
      const name = compMap.get(l.component_item_id) ?? String(l.component_item_id);
      diff.push({ kind: "removed", item: name, detail: `was qty ${l.qty_per} ${l.uom}` });
    }
  }
  const diffTone: Record<DiffRow["kind"], string> = {
    added: "bg-emerald-50 text-emerald-700",
    removed: "bg-red-50 text-red-700 line-through",
    changed: "bg-amber-50 text-amber-800",
    unchanged: "text-slate-600",
  };

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Link href="/manufacturing/boms" className="text-sm text-slate-500 hover:underline">
          ← BOMs
        </Link>
        <h1 className="text-xl font-semibold text-slate-900">
          {item ? item.item_no : `Item ${bom.item_id}`} · BOM v{bom.version_no}
        </h1>
        <StatusBadge value={statusTone(bom.status)} />
        {bom.status === "draft" && <ApproveBomButton bomId={bom.bom_id} />}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section className="card p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-700">
              Change vs v{prev ? prev.version_no : "—"} (ECO diff)
            </h2>
            {prev ? (
              <ul className="space-y-1 text-sm">
                {diff.map((d, i) => (
                  <li key={i} className={`flex items-center justify-between rounded px-2 py-1 ${diffTone[d.kind]}`}>
                    <span className="font-medium">
                      <span className="mr-2 inline-block w-16 text-xs uppercase opacity-70">{d.kind}</span>
                      {d.item}
                    </span>
                    <span className="text-xs">{d.detail}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-400">Initial version — no prior BOM to compare.</p>
            )}
          </section>

          <section className="card p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-700">
              Components (this version)
            </h2>
            <table className="min-w-full text-sm">
              <thead className="text-left text-xs uppercase text-slate-400">
                <tr>
                  <th className="py-1.5 pr-4">#</th>
                  <th className="py-1.5 pr-4">Component</th>
                  <th className="py-1.5 pr-4">Qty per</th>
                  <th className="py-1.5 pr-4">UoM</th>
                  <th className="py-1.5 pr-4">Scrap %</th>
                  <th className="py-1.5">Phantom</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(lines ?? []).map((l) => (
                  <tr key={l.line_no}>
                    <td className="py-1.5 pr-4 text-slate-400">{l.line_no}</td>
                    <td className="py-1.5 pr-4 font-medium text-slate-700">
                      {compMap.get(l.component_item_id) ?? l.component_item_id}
                    </td>
                    <td className="py-1.5 pr-4 text-slate-600">{l.qty_per}</td>
                    <td className="py-1.5 pr-4 text-slate-500">{l.uom}</td>
                    <td className="py-1.5 pr-4 text-slate-500">{l.scrap_pct}</td>
                    <td className="py-1.5 text-slate-500">{l.is_phantom ? "yes" : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>

        <div className="space-y-6">
          <section className="card p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-700">Details</h2>
            <dl className="space-y-2 text-sm">
              <Field label="Item" value={item ? `${item.item_no} — ${item.description}` : String(bom.item_id)} />
              <Field label="Effective" value={`${fmtDate(bom.effective_from)}${bom.effective_to ? " → " + fmtDate(bom.effective_to) : ""}`} />
              <Field label="Source" value={bom.source} />
              <Field label="Approved by" value={bom.approved_by ? (userMap.get(bom.approved_by) ?? `#${bom.approved_by}`) : "—"} />
              <Field label="Approved at" value={fmtDateTime(bom.approved_at)} />
              <Field label="Created" value={fmtDateTime(bom.created_at)} />
            </dl>
          </section>

          <section className="card p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-700">Version history</h2>
            <ul className="space-y-1.5 text-sm">
              {(versions ?? []).map((v) => (
                <li key={v.bom_id} className="flex items-center justify-between">
                  <Link
                    href={`/manufacturing/boms/${v.bom_id}`}
                    className={`font-medium hover:underline ${v.bom_id === bom.bom_id ? "text-gold-800" : "text-gold-700"}`}
                  >
                    v{v.version_no}
                    {v.bom_id === bom.bom_id && " (viewing)"}
                  </Link>
                  <span className="flex items-center gap-2 text-slate-400">
                    <span>{fmtDate(v.effective_from)}</span>
                    <StatusBadge value={statusTone(v.status)} />
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-slate-400">{label}</dt>
      <dd className="text-right text-slate-700">{value}</dd>
    </div>
  );
}
