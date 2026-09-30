"use client";

import type { ReactNode } from "react";
import { ClientChip } from "@/components/argus/client-chip";
import { DataTable, type Column } from "@/components/argus/data-table";
import { Badge, StatusBadge } from "@/components/argus/status-badge";
import { formatDayMonthYear } from "@/components/dashboard/derive";
import { humanizePolicyDomain } from "@/lib/humanize";
import type { ClientSummary } from "@/lib/types/profiles";
import { clientNeedsAction } from "@/components/caseload/needs-action";

export function clientHref(clientId: string): string {
  return `/caseload/${encodeURIComponent(clientId)}`;
}

function actionLabel(c: ClientSummary): string {
  const parts: string[] = [];
  if (c.unsentBriefs > 0) parts.push(`${c.unsentBriefs} ${c.unsentBriefs === 1 ? "brief" : "briefs"} to send`);
  const d = c.auditorDisagrees ?? 0;
  if (d > 0) parts.push(`the Auditor disagrees with ${d} ${d === 1 ? "verdict" : "verdicts"}`);
  return parts.length > 0 ? `, ${parts.join(", ")}` : "";
}

function nocLine(c: ClientSummary): string | null {
  const parts: string[] = [];
  if (c.nocCode) parts.push(`NOC ${c.nocCode}`);
  if (c.teerLevel !== undefined && c.teerLevel !== null) parts.push(`TEER ${c.teerLevel}`);
  return parts.length ? parts.join(" · ") : null;
}

const zero = <span className="font-mono tabular text-ink-3">0</span>;

const COLUMNS: Column<ClientSummary>[] = [
  {
    key: "client",
    header: "Client",
    // The row link wraps this cell, so the chip renders as a span.
    cell: (c) => (
      <div className="flex flex-col items-start gap-1">
        <ClientChip clientId={c.clientId} needsAction={clientNeedsAction(c)} />
        {(c.auditorDisagrees ?? 0) > 0 && (
          <Badge tone="danger">
            Auditor disagrees{(c.auditorDisagrees ?? 0) > 1 ? ` · ${c.auditorDisagrees}` : ""}
          </Badge>
        )}
      </div>
    ),
  },
  {
    key: "program",
    header: "Program",
    cell: (c) => {
      const line = nocLine(c);
      return (
        <div>
          <div className="text-[13px] text-ink-1">{humanizePolicyDomain(c.program)}</div>
          {line && <div className="font-mono text-[11px] text-ink-3">{line}</div>}
        </div>
      );
    },
  },
  {
    key: "crs",
    header: "CRS",
    align: "right",
    cell: (c) =>
      typeof c.currentCrsScore === "number" ? (
        <span className="font-mono tabular">{c.currentCrsScore}</span>
      ) : (
        <span className="font-mono text-[11px] text-ink-3">Not set</span>
      ),
  },
  {
    key: "status",
    header: "Status",
    cell: (c) =>
      c.status === "closed" ? (
        <StatusBadge kind="client" status="closed" />
      ) : c.status === "submitted" ? (
        <Badge tone="neutral">Submitted</Badge>
      ) : (
        <StatusBadge kind="client" status="active" />
      ),
  },
  {
    key: "lastAssessed",
    header: "Last assessed",
    cell: (c) =>
      c.lastAssessedAt ? <span className="font-mono text-[12px] text-ink-2">{formatDayMonthYear(c.lastAssessedAt)}</span> : <span className="font-mono text-[11px] text-ink-3">Not yet</span>,
  },
  {
    key: "affected",
    header: "Affected",
    align: "right",
    cell: (c) =>
      c.assessedCount === 0 ? (
        zero
      ) : (
        <span className="font-mono tabular text-ink-1">
          {c.affectedCount}
          <span className="text-ink-3"> of {c.assessedCount}</span>
        </span>
      ),
  },
  {
    key: "briefs",
    header: "Briefs to send",
    align: "right",
    cell: (c) =>
      c.unsentBriefs > 0 ? <span className="font-mono tabular font-medium text-danger-ink">{c.unsentBriefs}</span> : zero,
  },
];

type Props = {
  clients: ClientSummary[];
  loading: boolean;
  empty?: ReactNode;
};

export function CaseloadTable({ clients, loading, empty }: Props) {
  return (
    <DataTable
      columns={COLUMNS}
      rows={clients}
      getRowKey={(c) => c.clientId}
      caption="Your clients, one row each"
      rowHref={(c) => clientHref(c.clientId)}
      rowLinkLabel={(c) => `Open client ${c.clientId}${actionLabel(c)}`}
      loading={loading}
      placeholderRows={6}
      empty={empty}
    />
  );
}
