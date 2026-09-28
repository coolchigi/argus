import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type Crumb = { label: string; href?: string };

type Props = {
  title: ReactNode;
  /** Optional trail shown above the title. The top bar already carries the main breadcrumb. */
  crumbs?: Crumb[];
  meta?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

/** Page title block: optional trail, Plex Serif 24px title, a meta line, and right-aligned actions. */
export function PageHeader({ title, crumbs, meta, actions, className }: Props) {
  return (
    <header className={cn("flex flex-wrap items-end justify-between gap-4", className)}>
      <div className="min-w-0 space-y-1">
        {crumbs && crumbs.length > 0 && (
          <nav aria-label="Page trail">
            <ol className="flex flex-wrap items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">
              {crumbs.map((c, i) => (
                <li key={`${c.label}-${i}`} className="flex items-center gap-1.5">
                  {i > 0 && <span aria-hidden>/</span>}
                  {c.href ? (
                    <Link href={c.href} className="hover:text-ink-1">
                      {c.label}
                    </Link>
                  ) : (
                    <span>{c.label}</span>
                  )}
                </li>
              ))}
            </ol>
          </nav>
        )}
        <h1 className="font-display text-[24px] leading-tight text-ink-1">{title}</h1>
        {meta && <div className="font-mono text-[11px] text-ink-3">{meta}</div>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}
