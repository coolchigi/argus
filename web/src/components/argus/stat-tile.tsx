import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type Accent = "none" | "brand" | "danger";

type Props = {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  accent?: Accent;
  /** When set, the whole tile is a link to the filtered list behind the number. */
  href?: string;
  className?: string;
};

const ACCENT: Record<Accent, string> = {
  none: "border-t-hairline",
  brand: "border-t-brand",
  danger: "border-t-danger",
};

/** Dashboard stat. Mono label, Plex Serif 30px numeral, optional sub line. */
export function StatTile({ label, value, sub, accent = "none", href, className }: Props) {
  const body = (
    <>
      <div className="label mb-3">{label}</div>
      <div className="font-display text-[30px] leading-none text-ink-1 tabular">{value}</div>
      {sub && <div className="mt-2 font-mono text-[11px] text-ink-3">{sub}</div>}
    </>
  );
  const base = cn(
    "block border border-hairline border-t-2 bg-card p-5",
    ACCENT[accent],
    href && "transition-colors hover:bg-sunk",
    className,
  );
  if (href) {
    return (
      <Link href={href} className={base}>
        {body}
      </Link>
    );
  }
  return <div className={base}>{body}</div>;
}
