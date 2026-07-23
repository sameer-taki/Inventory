const TONE: Record<string, string> = {
  default: "bg-gold-500",
  good: "bg-emerald-500",
  warn: "bg-amber-500",
  danger: "bg-red-500",
};

export function BarRow({
  label,
  value,
  max,
  display,
  tone = "default",
}: {
  label: string;
  value: number;
  max: number;
  display?: string;
  tone?: "default" | "good" | "warn" | "danger";
}) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-3 py-1 text-sm">
      <div className="w-40 shrink-0 truncate text-slate-600" title={label}>
        {label}
      </div>
      <div className="h-4 flex-1 overflow-hidden rounded bg-slate-100">
        <div className={`h-full ${TONE[tone]}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="w-16 shrink-0 text-right tabular-nums text-slate-500">
        {display ?? value}
      </div>
    </div>
  );
}
