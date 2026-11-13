import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { DataTable, type Column } from "@/components/argus/data-table";
import { StatusBadge } from "@/components/argus/status-badge";
import { formatDayMonthYear } from "@/components/dashboard/derive";
import { humanizeTopic } from "@/lib/humanize";
import type { PolicyEvent } from "@/lib/types/policy-events";
import { TOUR_TOPIC } from "@/lib/demo-tour";

const COLUMNS: Column<PolicyEvent>[] = [
  {
    key: "ref",
    header: "Reference",
    cell: (e) => <span className="font-mono text-[12px] text-ink-2 tabular whitespace-nowrap">{e.ref}</span>,
  },
  {
    key: "title",
    header: "Change",
    cell: (e) => <span className="text-ink-1">{humanizeTopic(e.topic)}</span>,
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
        <span className="text-ink-1">{e.affectedCount}</span>
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

export const RECENT_EVENT_ROWS = 5;

/** Five newest policy events. Each row is a real link to the event. */
export function RecentEventsTable({
  events,
  loading,
  error,
}: {
  events: PolicyEvent[];
  loading: boolean;
  /** Rendered in place of the table when the request failed. */
  error?: ReactNode;
}) {
  return (
    <section aria-labelledby="recent-events-heading" className="min-w-0">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 id="recent-events-heading" className="label">
          Recent policy events
        </h2>
        <Link
          href="/policy-events"
          className="inline-flex items-center gap-0.5 font-mono text-[11px] text-ink-2 hover:text-ink-1"
        >
          View all
          <span className="sr-only"> policy events</span>
          <ChevronRight aria-hidden className="h-3 w-3" strokeWidth={1.5} />
        </Link>
      </div>
      {error ?? (
        <DataTable
          caption="Recent policy events"
          columns={COLUMNS}
          rows={events.slice(0, RECENT_EVENT_ROWS)}
          getRowKey={(e) => e.eventId}
          rowHref={(e) => `/policy-events/${encodeURIComponent(e.eventId)}`}
          rowLinkLabel={(e) => `${e.ref}, ${humanizeTopic(e.topic)}`}
          rowTour={(e) => (e.topic === TOUR_TOPIC ? "dashboard-event" : undefined)}
          loading={loading}
          placeholderRows={RECENT_EVENT_ROWS}
          stickyHeader={false}
          empty="No policy events yet."
        />
      )}
    </section>
  );
}
