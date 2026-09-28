"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { Brief } from "@/lib/argus-types";
import { formatDelta, formatRelative } from "@/lib/format";
import { humanizeImpactType, humanizeTopic } from "@/lib/humanize";
import { PageHeader } from "@/components/argus/page-header";
import { DataTable, type Column } from "@/components/argus/data-table";
import { FilterBar } from "@/components/argus/filter-bar";
import { StatusBadge } from "@/components/argus/status-badge";
import { ClientChip } from "@/components/argus/client-chip";
import { InlineError } from "@/components/argus/inline-error";
import { ProgressLine } from "@/components/argus/progress-line";
import { EmptyState } from "@/components/empty-state";
import { Send } from "lucide-react";

export default function BriefsPage() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["briefs"],
    queryFn: () => api<{ briefs: Brief[] }>("/briefs"),
  });
  const [search, setSearch] = useState("");

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    const all = q.data?.briefs ?? [];
    if (!term) return all;
    return all.filter(
      (b) =>
        b.subject.toLowerCase().includes(term) ||
        b.clientId.toLowerCase().includes(term) ||
        (b.topic ?? "").toLowerCase().includes(term) ||
        humanizeTopic(b.topic).toLowerCase().includes(term),
    );
  }, [q.data, search]);
  const draftIds = useMemo(() => rows.filter((b) => b.status !== "sent").map((b) => b.briefId), [rows]);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchRecipient, setBatchRecipient] = useState("");
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allSelected = draftIds.length > 0 && draftIds.every((id) => selected.has(id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(draftIds));

  const batchSend = useMutation({
    mutationFn: async () => {
      if (!batchRecipient.trim()) throw new Error("Enter a recipient email for the batch.");
      const sends = Array.from(selected).map((briefId) => ({
        briefId,
        recipientEmail: batchRecipient.trim(),
      }));
      return api<{ total: number; succeeded: number; failed: number }>("/briefs/batch-send", {
        method: "POST",
        body: { sends },
      });
    },
    onSuccess: (r) => {
      toast.success(`Sent ${r.succeeded} of ${r.total}`);
      qc.invalidateQueries({ queryKey: ["briefs"] });
      setSelected(new Set());
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "batch-send-failed"),
  });

  const columns: Column<Brief>[] = [
    {
      key: "select",
      header: (
        <input
          type="checkbox"
          aria-label="Select every unsent brief"
          checked={allSelected}
          onChange={toggleAll}
          disabled={draftIds.length === 0}
          className="h-3.5 w-3.5 cursor-pointer accent-brand align-middle"
        />
      ),
      className: "w-10",
      cell: (b) =>
        b.status !== "sent" ? (
          <input
            type="checkbox"
            aria-label={`Select brief for ${b.clientId}`}
            checked={selected.has(b.briefId)}
            onChange={() => toggle(b.briefId)}
            className="h-3.5 w-3.5 cursor-pointer accent-brand align-middle"
          />
        ) : null,
    },
    {
      key: "subject",
      header: "Subject",
      cell: (b) => (
        <Link
          href={`/briefs/${b.briefId}`}
          className="font-medium text-ink-1 underline-offset-4 decoration-hairline hover:underline"
        >
          {b.subject}
        </Link>
      ),
    },
    {
      key: "client",
      header: "Client",
      cell: (b) => <ClientChip clientId={b.clientId} />,
    },
    {
      key: "impact",
      header: "Impact",
      cell: (b) => (
        <span className="whitespace-nowrap">
          <span className="text-ink-2">{humanizeImpactType(b.impactType)}</span>
          {b.numericDelta !== null && (
            <span className="ml-1.5 font-mono text-[12px] tabular text-ink-1">{formatDelta(b.numericDelta)}</span>
          )}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (b) => <StatusBadge kind="brief" status={b.status} />,
    },
    {
      key: "when",
      header: "Drafted",
      align: "right",
      cell: (b) => (
        <time dateTime={b.createdAt} className="font-mono text-[12px] tabular whitespace-nowrap text-ink-2">
          {formatRelative(b.createdAt)}
        </time>
      ),
    },
  ];

  const total = q.data?.briefs.length ?? 0;
  const header = (
    <PageHeader title="Action briefs" meta="Composer drafts one per affected client. Edit and send from here." />
  );

  if (q.error) {
    return (
      <div className="space-y-6">
        {header}
        <InlineError
          message="Couldn't load your briefs."
          detail={q.error instanceof Error ? q.error.message : null}
          retrying={q.isFetching}
          onRetry={() => void q.refetch()}
        />
      </div>
    );
  }

  if (q.data && total === 0) {
    return (
      <div className="space-y-6">
        {header}
        <EmptyState
          headline="No briefs drafted yet."
          body="Composer writes one for every affected client after a policy change. When Sentinel catches something, drafts appear here for you to edit and send."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <ProgressLine active={q.isPending} fixed label="Loading briefs" />
      {header}

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 border border-brand-ink/40 bg-brand-subtle px-4 py-3">
          <span className="text-[13px] font-medium text-ink-1">{selected.size} selected</span>
          <span className="text-[12px] text-ink-2">Sends to a single recipient email for demo purposes.</span>
          <div className="ml-auto flex items-center gap-2">
            <label htmlFor="batch-recipient" className="sr-only">
              Recipient email
            </label>
            <input
              id="batch-recipient"
              type="email"
              placeholder="Recipient email"
              value={batchRecipient}
              onChange={(e) => setBatchRecipient(e.target.value)}
              className="h-8 w-[240px] rounded-sm border border-control bg-surface px-3 text-[13px] text-ink-1 placeholder:text-ink-3"
            />
            <button
              type="button"
              onClick={() => batchSend.mutate()}
              disabled={batchSend.isPending}
              className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-brand-ink bg-brand px-3 text-[13px] font-medium text-on-brand transition-colors hover:bg-brand-hover disabled:opacity-50"
            >
              <Send className="h-3 w-3" strokeWidth={1.75} />
              {batchSend.isPending ? "Sending" : `Send ${selected.size}`}
            </button>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="h-8 px-2 text-[12px] text-ink-2 transition-colors hover:text-ink-1"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      <div>
        <FilterBar
          className="border border-b-0 border-hairline"
          search={search}
          onSearchChange={setSearch}
          searchLabel="Search briefs"
          searchPlaceholder="Search subject, client, topic"
          count={q.isPending ? undefined : `${rows.length} of ${total}`}
        />
        <DataTable
          caption="Action briefs"
          columns={columns}
          rows={rows}
          getRowKey={(b) => b.briefId}
          loading={q.isPending}
          empty="Nothing matches. Clear the search to see every brief."
        />
      </div>
    </div>
  );
}
