"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { MobileNav } from "@/components/nav/mobile-nav";
import { navItemForPath } from "@/components/nav/nav-config";
import { useBreadcrumbLabels } from "@/components/nav/breadcrumb-context";

type Crumb = { label: string; href?: string };

function shorten(segment: string): string {
  let s = segment;
  try {
    s = decodeURIComponent(segment);
  } catch {
    // keep the raw segment
  }
  return s.length > 28 ? `${s.slice(0, 24)}...` : s;
}

function useCrumbs(): Crumb[] {
  const pathname = usePathname();
  const labels = useBreadcrumbLabels();
  const section = navItemForPath(pathname);
  const crumbs: Crumb[] = [{ label: "Argus", href: "/dashboard" }];
  if (!section) return crumbs;
  crumbs.push({ label: section.label, href: section.href });
  if (pathname !== section.href) {
    const rest = pathname.slice(section.href.length).split("/").filter(Boolean);
    crumbs.push({ label: labels[pathname] ?? shorten(rest[rest.length - 1] ?? "") });
  }
  return crumbs;
}

function useToday(): string | null {
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => {
    const fmt = () =>
      new Date().toLocaleDateString("en-CA", {
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric",
      });
    setToday(fmt());
    const id = window.setInterval(() => setToday(fmt()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return today;
}

/**
 * 44px top bar. Breadcrumb on the left. On the right, the date for now.
 * "IRCC last checked N min ago" replaces it once the Sentinel heartbeat lands (Phase C2).
 */
export function TopBar() {
  const crumbs = useCrumbs();
  const today = useToday();
  return (
    <div
      data-print="hide"
      className="sticky top-0 z-30 flex h-11 shrink-0 items-center justify-between gap-3 border-b border-hairline bg-surface px-4 sm:px-6"
    >
      <div className="flex min-w-0 items-center gap-2">
        <MobileNav />
        <nav aria-label="Breadcrumb" className="min-w-0">
          <ol className="flex min-w-0 items-center gap-1.5 font-mono text-[11px] text-ink-3">
            {crumbs.map((c, i) => {
              const last = i === crumbs.length - 1;
              return (
                <li key={`${c.label}-${i}`} className="flex min-w-0 items-center gap-1.5">
                  {i > 0 && <span aria-hidden>/</span>}
                  {last ? (
                    <span aria-current="page" className="truncate text-ink-1">
                      {c.label}
                    </span>
                  ) : c.href ? (
                    <Link href={c.href} className="truncate hover:text-ink-1">
                      {c.label}
                    </Link>
                  ) : (
                    <span className="truncate">{c.label}</span>
                  )}
                </li>
              );
            })}
          </ol>
        </nav>
      </div>
      {today && <div className="shrink-0 font-mono text-[11px] text-ink-3 tabular">{today}</div>}
    </div>
  );
}
