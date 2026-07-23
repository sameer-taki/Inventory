"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = { href: string; label: string; badge?: string; exact?: boolean };
type NavSection = { title: string; items: NavItem[] };

const SECTIONS: NavSection[] = [
  {
    title: "Overview",
    items: [{ href: "/dashboard", label: "Dashboard", exact: true }],
  },
  {
    title: "Quality · M1",
    items: [
      { href: "/quality/dashboard", label: "Dashboard" },
      { href: "/quality/ncr", label: "NCRs" },
      { href: "/quality/capa", label: "CAPAs" },
    ],
  },
  {
    title: "Manufacturing · M2–M6",
    items: [
      { href: "/manufacturing", label: "Overview", exact: true },
      { href: "/manufacturing/production", label: "Production orders" },
      { href: "/manufacturing/mps", label: "MPS" },
      { href: "/manufacturing/planning", label: "Planning (MRP)" },
      { href: "/manufacturing/boms", label: "BOMs" },
      { href: "/manufacturing/work-centres", label: "Work centres" },
      { href: "/manufacturing/capacity", label: "Capacity" },
      { href: "/manufacturing/genealogy", label: "Genealogy" },
    ],
  },
  {
    title: "Fleet · F0–F3",
    items: [
      { href: "/fleet", label: "Overview", exact: true },
      { href: "/fleet/vehicles", label: "Vehicles" },
      { href: "/fleet/jobcards", label: "Job cards" },
      { href: "/fleet/renewals", label: "Renewals" },
      { href: "/fleet/fuel-import", label: "Fuel import" },
    ],
  },
];

const FLEET_ADMIN_ITEM: { section: string; item: NavItem } = {
  section: "Fleet · F0–F3",
  item: { href: "/fleet/drivers", label: "Drivers" },
};

const ADMIN_SECTION: NavSection = {
  title: "Admin",
  items: [
    { href: "/admin/outbox", label: "Integration outbox" },
    { href: "/admin/audit", label: "Audit log" },
  ],
};

export function Sidebar({
  isAdmin = false,
  isFleetAdmin = false,
}: {
  isAdmin?: boolean;
  isFleetAdmin?: boolean;
}) {
  const pathname = usePathname();
  let sections = SECTIONS;
  if (isFleetAdmin) {
    sections = sections.map((s) =>
      s.title === FLEET_ADMIN_ITEM.section
        ? { ...s, items: [...s.items, FLEET_ADMIN_ITEM.item] }
        : s,
    );
  }
  if (isAdmin) sections = [...sections, ADMIN_SECTION];

  return (
    <nav className="flex h-full flex-col gap-6 p-4">
      <div className="px-2">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded bg-gold-600 text-sm font-bold text-white">
            G
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold text-slate-900">
              Golden Ops
            </div>
            <div className="text-[11px] text-slate-500">Operations Platform</div>
          </div>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-5 overflow-y-auto">
        {sections.map((section) => (
          <div key={section.title}>
            <p className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              {section.title}
            </p>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const active = item.exact
                  ? pathname === item.href
                  : pathname === item.href ||
                    pathname.startsWith(item.href + "/");
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={`flex items-center justify-between rounded-md px-2 py-1.5 text-sm transition ${
                        active
                          ? "bg-gold-50 font-medium text-gold-800"
                          : "text-slate-600 hover:bg-slate-100"
                      }`}
                    >
                      <span>{item.label}</span>
                      {item.badge && (
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-slate-500">
                          {item.badge}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}
