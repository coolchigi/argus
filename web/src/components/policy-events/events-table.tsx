import type { ReactNode } from "react";
import { DataTable, type Column } from "@/components/argus/data-table";
import { StatusBadge } from "@/components/argus/status-badge";
import { formatDayMonthYear } from "@/components/dashboard/derive";
import { eventNote } from "@/components/policy-events/derive";
import { humanizePolicyDomain, humanizeTopic } from "@/lib/humanize";
import type { PolicyEvent } from "@/lib/types/policy-events";

const COLUMNS: Column<PolicyEvent>[] = [
  {
    key: "ref",
    header: "Reference",
    cell: (e) => <span className="font-mono text-[12px] text-brand-ink tabular whitespace-nowrap">{e.ref}</span>,
  },
  {
    key: "title",
    header: "Change",
    className: "min-w-[220px]",
    cell: (e) => {
      const note = eventNote(e);
      return (
        <>
          <span className="block font-medium leading-snug text-ink-1">{humanizeTopic(e.topic)}</span>
          {note && (
            <span className="mt-0.5 block font-mono text-[11px] text-ink-3">
              <span aria-hidden>↳ </span>
              {note}
            </span>
          )}
        </>
      );
    },
  },
  {
    key: "domain",
    header: "Domain",
    className: "hidden xl:table-cell",
    cell: (e) => <span className="whitespace-nowrap text-[12px] text-ink-2">{humanizePolicyDomain(e.policyDomain)}</span>,
  },
  {
    key: "severity",
    header: "Severity",
    className: "hidden xl:table-cell",
    cell: (e) =>
      e.severity ? <StatusBadge kind="severity" status={e.severity} /> : <span className="text-[12px] text-ink-3">Not set</span>,
  },
  {
    key: "date",
    header: "Detected",
    cell: (e) => (
      <time dateTime={e.detectedAt} className="font-mono text-[12px] text-ink-2 tabular whitespace-nowrap">
        {formatDayMonthYear(e.detectedAt)}
      </time>
    ),
  },
  {
    key: "affected",
    header: "Affected",
    align: "right",
    cell: (e) => (
      <span className="font-mono text-[12px] tabular whitespace-nowrap">
        <span className={e.affectedCount > 0 ? "text-ink-1" : "text-ink-3"}>{e.affectedCount}</span>
        <span className="text-ink-3"> of {e.assessedCount}</span>
      </span>
    ),
  },
  {
    key: "status",
    header: "Status",
    cell: (e) => <StatusBadge kind="event" status={e.status} />,
  },
];

/** Every policy event, one row per rule. Each row is a real link to its detail page. */
export function EventsTable({
  events,
  loading,
  empty,
}: {
  events: PolicyEvent[];
  loading: boolean;
  /** Shown in the table body when the filters leave nothing. */
  empty?: ReactNode;
}) {
  return (
    <DataTable
      caption="Policy events"
      columns={COLUMNS}
      rows={events}
      getRowKey={(e) => e.eventId}
      rowHref={(e) => `/policy-events/${encodeURIComponent(e.eventId)}`}
      rowLinkLabel={(e) => `${e.ref}, ${humanizeTopic(e.topic)}`}
      loading={loading}
      placeholderRows={6}
      empty={empty}
    />
  );
}
