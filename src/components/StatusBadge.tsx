import { titleCase } from "@/lib/format";

const COLORS: Record<string, string> = {
  // NCR / CAPA / generic status
  open: "bg-blue-100 text-blue-800",
  under_review: "bg-amber-100 text-amber-800",
  dispositioned: "bg-violet-100 text-violet-800",
  closed: "bg-slate-200 text-slate-700",
  in_progress: "bg-amber-100 text-amber-800",
  pending_verification: "bg-violet-100 text-violet-800",
  // severity
  minor: "bg-slate-100 text-slate-700",
  major: "bg-orange-100 text-orange-800",
  critical: "bg-red-100 text-red-800",
  // renewals
  current: "bg-emerald-100 text-emerald-800",
  due_soon: "bg-amber-100 text-amber-800",
  overdue: "bg-red-100 text-red-800",
  lapsed: "bg-red-100 text-red-800",
  renewed: "bg-emerald-100 text-emerald-800",
  na: "bg-slate-100 text-slate-500",
};

export function StatusBadge({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-slate-400">—</span>;
  const cls = COLORS[value] ?? "bg-slate-100 text-slate-700";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}
    >
      {titleCase(value)}
    </span>
  );
}
