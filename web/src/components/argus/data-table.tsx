import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type Column<T> = {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  align?: "left" | "right";
  className?: string;
  /** Visually hide the header text but keep it for screen readers. */
  srOnlyHeader?: boolean;
};

type Props<T> = {
  columns: Column<T>[];
  rows: T[];
  getRowKey: (row: T) => string;
  /** Accessible name for the table. */
  caption: string;
  /**
   * When set, each row gets a real link in its first cell, stretched over the
   * whole row. Keyboard users tab to it, and a click anywhere on the row follows it.
   */
  rowHref?: (row: T) => string;
  /** Text for the row link, read by screen readers. Defaults to the first cell's content. */
  rowLinkLabel?: (row: T) => string;
  /** Marks a row for the demo tour ([data-tour]). */
  rowTour?: (row: T) => string | undefined;
  loading?: boolean;
  placeholderRows?: number;
  empty?: ReactNode;
  stickyHeader?: boolean;
  className?: string;
};

/** Dense ledger table. Zebra rows plus hairline dividers, sticky header, links inside rows. */
export function DataTable<T>({
  columns,
  rows,
  getRowKey,
  caption,
  rowHref,
  rowLinkLabel,
  rowTour,
  loading = false,
  placeholderRows = 4,
  empty,
  stickyHeader = true,
  className,
}: Props<T>) {
  return (
    <div className={cn("overflow-x-auto border border-hairline bg-card", className)}>
      <table className="w-full border-collapse text-[13px]" aria-busy={loading || undefined}>
        <caption className="sr-only">{caption}</caption>
        <thead className={cn("bg-surface", stickyHeader && "sticky top-0 z-10")}>
          <tr className="border-b border-hairline">
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                className={cn(
                  "px-4 py-2.5 font-mono text-[11px] font-normal uppercase tracking-[0.12em] text-ink-3",
                  col.align === "right" ? "text-right" : "text-left",
                  col.className,
                )}
              >
                {col.srOnlyHeader ? <span className="sr-only">{col.header}</span> : col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            Array.from({ length: placeholderRows }).map((_, i) => (
              <tr key={`placeholder-${i}`} className="border-b border-hairline last:border-0 even:bg-sunk">
                {columns.map((col) => (
                  <td key={col.key} className="px-4 py-3">
                    <span aria-hidden className="block h-2.5 w-2/3 rounded-sm bg-hairline" />
                  </td>
                ))}
              </tr>
            ))
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-12 text-center text-[13px] text-ink-2">
                {empty ?? "Nothing to show yet."}
              </td>
            </tr>
          ) : (
            rows.map((row) => {
              const href = rowHref?.(row);
              return (
                <tr
                  key={getRowKey(row)}
                  data-tour={rowTour?.(row)}
                  className={cn(
                    "border-b border-hairline last:border-0 even:bg-sunk",
                    href && "relative transition-colors hover:bg-brand-subtle/40 focus-within:bg-brand-subtle/40",
                  )}
                >
                  {columns.map((col, ci) => (
                    <td
                      key={col.key}
                      className={cn(
                        "px-4 py-3 align-top text-ink-1",
                        col.align === "right" && "text-right",
                        col.className,
                      )}
                    >
                      {href && ci === 0 ? (
                        <Link
                          href={href}
                          className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-[-2px] focus-visible:after:outline-focus"
                          aria-label={rowLinkLabel?.(row)}
                        >
                          {col.cell(row)}
                        </Link>
                      ) : (
                        col.cell(row)
                      )}
                    </td>
                  ))}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
