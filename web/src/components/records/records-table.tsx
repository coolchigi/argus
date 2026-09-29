"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ClientChip } from "@/components/argus/client-chip";
import { DataTable, type Column } from "@/components/argus/data-table";
import { Fingerprint } from "@/components/argus/fingerprint";
import { humanizeTopic } from "@/lib/humanize";
import { receiptHref, recordHref, recordLabel } from "@/lib/records";
import type { LedgerEntry } from "@/lib/types/records";

function formatSignedAt(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: iso, time: "" };
  return {
    date: d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }),
    time: d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }),
  };
}

const COLUMNS: Column<LedgerEntry>[] = [
  {
    key: "signed",
    header: "Signed",
    className: "whitespace-nowrap",
    cell: (r) => {
      const { date, time } = formatSignedAt(r.signedAt);
      return (
        <time dateTime={r.signedAt} className="block">
          <span className="block text-[13px] text-ink-1">{date}</span>
          <span className="block font-mono text-[11px] text-ink-3">{time}</span>
        </time>
      );
    },
  },
  {
    key: "record",
    header: "Record",
    cell: (r) => (
      <div className="min-w-0">
        <Link href={recordHref(r)} className="text-[13px] text-ink-1 underline-offset-4 hover:underline">
          {humanizeTopic(r.topic)}
        </Link>
        <div className={r.recordKind === "consultant-review" ? "font-mono text-[11px] text-brand-ink" : "font-mono text-[11px] text-ink-3"}>
          {recordLabel(r)}
        </div>
      </div>
    ),
  },
  {
    key: "client",
    header: "Client",
    cell: (r) => (r.clientId ? <ClientChip clientId={r.clientId} /> : <span className="text-ink-3">None</span>),
  },
  {
    key: "fingerprint",
    header: "Fingerprint",
    cell: (r) =>
      r.canonicalHash ? (
        <Fingerprint hash={r.canonicalHash} signed={r.signed} chars={16} href={receiptHref(r)} />
      ) : (
        <span className="font-mono text-[11px] text-danger-ink">No signature</span>
      ),
  },
];

export function RecordsTable({ records, loading, empty }: { records: LedgerEntry[]; loading: boolean; empty: ReactNode }) {
  return (
    <DataTable
      columns={COLUMNS}
      rows={records}
      getRowKey={(r) => `${r.kind}:${r.id}`}
      caption="Signed assessments and sent briefs in the chosen date range"
      loading={loading}
      empty={empty}
    />
  );
}
