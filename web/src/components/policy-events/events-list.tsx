"use client";

import { useId, useMemo, useState } from "react";
import { FilterBar } from "@/components/argus/filter-bar";
import { InlineError } from "@/components/argus/inline-error";
import { PageHeader } from "@/components/argus/page-header";
import { ProgressLine } from "@/components/argus/progress-line";
import { EmptyState } from "@/components/empty-state";
import {
  ALL,
  DEFAULT_FILTERS,
  NO_DOMAIN,
  domainsIn,
  filterEvents,
  hasActiveFilters,
  type EventFilters,
  type StatusFilter,
} from "@/components/policy-events/derive";
import { EventsTable } from "@/components/policy-events/events-table";
import { humanizePolicyDomain } from "@/lib/humanize";
import type { PolicyEventsListResponse } from "@/lib/types/policy-events";

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: ALL, label: "All" },
  { value: "action-required", label: "Action required" },
  { value: "done", label: "Done" },
  { value: "no-impact", label: "No impact" },
];

type Props = {
  data: PolicyEventsListResponse | undefined;
  loading: boolean;
  error: Error | null;
  retrying?: boolean;
  onRetry?: () => void;
};

/** The policy events list. Filters run in the browser over the full list, so the count is exact. */
export function EventsList({ data, loading, error, retrying, onRetry }: Props) {
  const [filters, setFilters] = useState<EventFilters>(DEFAULT_FILTERS);
  const domainId = useId();

  const all = useMemo(() => data?.events ?? [], [data]);
  const domains = useMemo(() => domainsIn(all), [all]);
  const shown = useMemo(() => filterEvents(all, filters), [all, filters]);

  const header = (
    <PageHeader
      title="Policy events"
      meta={
        data ? (
          <>
            {data.totals.actionRequired} need action · {data.totals.detectedThisMonth} detected this month
          </>
        ) : undefined
      }
    />
  );

  if (error && !data) {
    return (
      <div className="space-y-6">
        {header}
        <InlineError
          message="Couldn't load policy events."
          detail={error.message}
          retrying={retrying}
          onRetry={onRetry}
        />
      </div>
    );
  }

  if (data && all.length === 0) {
    return (
      <div className="space-y-6">
        {header}
        <EmptyState
          headline="No policy events yet."
          body="Argus is watching IRCC. When a change lands, it's checked against your caseload and listed here."
        />
      </div>
    );
  }

  const filtersActive = hasActiveFilters(filters);

  return (
    <div className="space-y-6">
      <ProgressLine active={loading} fixed label="Loading policy events" />
      {header}

      <div>
        <FilterBar
          className="border border-b-0 border-hairline"
          search={filters.query}
          onSearchChange={(query) => setFilters((f) => ({ ...f, query }))}
          searchLabel="Search policy events"
          searchPlaceholder="Search by change or reference"
          filters={STATUS_FILTERS}
          filter={filters.status}
          onFilterChange={(status) => setFilters((f) => ({ ...f, status: status as StatusFilter }))}
          filterLabel="Filter by status"
          count={
            data ? (
              <span aria-live="polite">
                {shown.length} of {all.length} {all.length === 1 ? "event" : "events"}
              </span>
            ) : undefined
          }
        >
          {domains.length > 1 && (
            <div className="flex items-center gap-2">
              <label htmlFor={domainId} className="label">
                Domain
              </label>
              <select
                id={domainId}
                value={filters.domain}
                onChange={(e) => setFilters((f) => ({ ...f, domain: e.target.value }))}
                className="h-8 rounded-sm border border-control bg-sunk px-2 text-[13px] text-ink-1"
              >
                <option value={ALL}>All domains</option>
                {domains.map((d) => (
                  <option key={d} value={d}>
                    {d === NO_DOMAIN ? "Not set" : humanizePolicyDomain(d)}
                  </option>
                ))}
              </select>
            </div>
          )}
        </FilterBar>

        <EventsTable
          events={shown}
          loading={!data && loading}
          empty={
            filtersActive ? (
              <span className="inline-flex flex-col items-center gap-3">
                <span>No events match these filters.</span>
                <button
                  type="button"
                  onClick={() => setFilters(DEFAULT_FILTERS)}
                  className="h-7 rounded-sm border border-control bg-surface px-3 text-[12px] text-ink-1 transition-colors hover:bg-sunk"
                >
                  Clear filters
                </button>
              </span>
            ) : undefined
          }
        />
      </div>

      {error && data && (
        <InlineError
          message="Couldn't refresh policy events. You're seeing the last list that loaded."
          detail={error.message}
          retrying={retrying}
          onRetry={onRetry}
        />
      )}
    </div>
  );
}
