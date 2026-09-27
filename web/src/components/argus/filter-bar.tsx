"use client";

import { useId, type ReactNode } from "react";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import { Toggle } from "@base-ui/react/toggle";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

export type FilterOption = { value: string; label: string };

type Props = {
  search?: string;
  onSearchChange?: (value: string) => void;
  searchLabel?: string;
  searchPlaceholder?: string;
  filters?: FilterOption[];
  filter?: string;
  onFilterChange?: (value: string) => void;
  filterLabel?: string;
  /** Right-aligned count, such as "5 of 12 events". */
  count?: ReactNode;
  children?: ReactNode;
  className?: string;
};

/** Search box, single-select filter pills (Base UI ToggleGroup), and a result count. */
export function FilterBar({
  search,
  onSearchChange,
  searchLabel = "Search",
  searchPlaceholder,
  filters,
  filter,
  onFilterChange,
  filterLabel = "Filter",
  count,
  children,
  className,
}: Props) {
  const searchId = useId();
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-3 border-b border-hairline bg-surface px-4 py-3 sm:px-6",
        className,
      )}
    >
      {onSearchChange && (
        <div className="relative">
          <label htmlFor={searchId} className="sr-only">
            {searchLabel}
          </label>
          <Search
            aria-hidden
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-3"
            strokeWidth={1.5}
          />
          <input
            id={searchId}
            type="search"
            value={search ?? ""}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            className="h-8 w-64 max-w-full rounded-sm border border-control bg-sunk pl-8 pr-3 text-[13px] text-ink-1 placeholder:text-ink-3"
          />
        </div>
      )}

      {filters && filters.length > 0 && onFilterChange && (
        <ToggleGroup
          aria-label={filterLabel}
          value={filter ? [filter] : []}
          onValueChange={(next) => {
            // Single select that never goes empty. Pressing the active pill keeps it.
            if (next.length > 0) onFilterChange(next[next.length - 1]);
          }}
          className="flex flex-wrap items-center gap-1"
        >
          {filters.map((f) => (
            <Toggle
              key={f.value}
              value={f.value}
              className="h-7 rounded-sm px-2.5 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2 transition-colors hover:text-ink-1 data-[pressed]:bg-brand-subtle data-[pressed]:text-brand-ink"
            >
              {f.label}
            </Toggle>
          ))}
        </ToggleGroup>
      )}

      {children}

      {count && <div className="ml-auto font-mono text-[11px] text-ink-3">{count}</div>}
    </div>
  );
}
