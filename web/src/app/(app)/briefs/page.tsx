"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { Brief } from "@/lib/argus-types";
import { Input } from "@/components/ui/input";
import { formatDelta, formatRelative } from "@/lib/format";
import { Send } from "lucide-react";

export default function BriefsPage() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["briefs"],
    queryFn: () => api<{ briefs: Brief[] }>("/briefs"),
  });

  const draftBriefs = useMemo(
    () => (q.data?.briefs ?? []).filter((b) => b.status !== "sent"),
    [q.data],
  );

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchRecipient, setBatchRecipient] = useState("");

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const allSelected = draftBriefs.length > 0 && draftBriefs.every((b) => selected.has(b.briefId));
  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(draftBriefs.map((b) => b.briefId)));
  };

  const batchSend = useMutation({
    mutationFn: async () => {
      if (!batchRecipient.trim()) throw new Error("Enter a recipient email.");
      const sends = Array.from(selected).map((briefId) => ({ briefId, recipientEmail: batchRecipient.trim() }));
      return api<{ total: number; succeeded: number; failed: number }>("/briefs/batch-send", {
        method: "POST",
        body: { sends },
      });
    },
    onSuccess: (r) => {
      toast.success(`Batch: ${r.succeeded}/${r.total} sent`);
      qc.invalidateQueries({ queryKey: ["briefs"] });
      setSelected(new Set());
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "batch-send-failed"),
  });

  const rows = q.data?.briefs ?? [];

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <div className="label">Briefs</div>
        <h1 className="text-xl font-semibold tracking-tight">Client briefs</h1>
        <p className="text-[12px] text-muted-foreground">
          Auto-drafted by Composer. Edit inline, sign, send. Batch supported.
        </p>
      </header>

      {selected.size > 0 && (
        <div className="border border-foreground/20 bg-accent/50 rounded-md px-4 py-3 flex items-center gap-3">
          <span className="text-[12px] font-medium">
            {selected.size} selected
          </span>
          <div className="flex-1 flex items-center gap-2">
            <Input
              type="email"
              placeholder="Batch recipient email"
              value={batchRecipient}
              onChange={(e) => setBatchRecipient(e.target.value)}
              className="max-w-xs h-8 text-[12px]"
            />
            <button
              type="button"
              onClick={() => batchSend.mutate()}
              disabled={batchSend.isPending}
              className="inline-flex h-8 items-center gap-1.5 rounded-sm bg-primary px-3 text-[12px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <Send className="h-3 w-3" strokeWidth={1.75} />
              {batchSend.isPending ? "Sending…" : `Send ${selected.size}`}
            </button>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="text-[12px] text-muted-foreground hover:text-foreground"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      <div className="border border-border bg-card rounded-md overflow-hidden">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <Th align="left" className="w-8 pl-3">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  className="h-3 w-3 rounded-sm border-input cursor-pointer"
                />
              </Th>
              <Th>Subject</Th>
              <Th>Client</Th>
              <Th>Impact</Th>
              <Th>Status</Th>
              <Th align="right">Time</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {q.isLoading ? (
              <tr>
                <td colSpan={6} className="py-10 text-center text-[11px] text-muted-foreground">Loading…</td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-10 text-center text-[11px] text-muted-foreground">
                  No briefs yet. Composer drafts one per affected client after a policy change.
                </td>
              </tr>
            ) : (
              rows.map((b) => {
                const selectable = b.status !== "sent";
                return (
                  <tr key={b.briefId} className="row group hover:bg-accent/40 transition-colors">
                    <td className="pl-3">
                      {selectable && (
                        <input
                          type="checkbox"
                          checked={selected.has(b.briefId)}
                          onChange={() => toggle(b.briefId)}
                          className="h-3 w-3 rounded-sm border-input cursor-pointer"
                        />
                      )}
                    </td>
                    <Td>
                      <Link
                        href={`/briefs/${b.briefId}`}
                        className="font-medium hover:underline truncate"
                      >
                        {b.subject}
                      </Link>
                    </Td>
                    <Td>
                      <span className="text-muted-foreground tabular">{b.clientId}</span>
                    </Td>
                    <Td>
                      <span className="text-muted-foreground">{b.impactType}</span>
                      {b.numericDelta !== null && (
                        <span className="ml-1.5 tabular text-foreground">{formatDelta(b.numericDelta)}</span>
                      )}
                    </Td>
                    <Td>
                      <StatusPill status={b.status} />
                    </Td>
                    <Td align="right">
                      <span className="text-[11px] text-muted-foreground tabular">
                        {formatRelative(b.createdAt)}
                      </span>
                    </Td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({
  children,
  align = "left",
  className = "",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <th
      className={
        "h-8 px-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground " +
        (align === "right" ? "text-right " : "text-left ") +
        className
      }
    >
      {children}
    </th>
  );
}

function Td({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return <td className={"px-3 " + (align === "right" ? "text-right" : "text-left")}>{children}</td>;
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    draft: "bg-muted text-muted-foreground",
    edited: "bg-accent text-accent-foreground",
    sent: "bg-brand-subtle text-brand",
  };
  return (
    <span
      className={
        "inline-block rounded-sm px-1.5 py-0.5 text-[10px] uppercase tracking-wider " +
        (map[status] ?? "bg-muted text-muted-foreground")
      }
    >
      {status}
    </span>
  );
}
