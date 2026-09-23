"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { Brief } from "@/lib/argus-types";
import { Input } from "@/components/ui/input";
import { formatDelta, formatRelative } from "@/lib/format";
import { Seal } from "@/components/seal";
import { EmptyState } from "@/components/empty-state";
import { Send, Search } from "lucide-react";
import { cn } from "@/lib/utils";

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
        (b.topic ?? "").toLowerCase().includes(term),
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

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <div className="label">Briefs</div>
        <h1
          className="text-[24px] font-medium tracking-tight text-ink-primary leading-tight"
          style={{ fontFamily: "var(--font-newsreader), serif" }}
        >
          Client update drafts
        </h1>
        <p className="text-[13px] text-ink-secondary">
          Composer drafts one per affected client. Edit and send from here.
        </p>
      </header>

      <div className="flex items-center gap-3">
        <span className="label">{q.data?.briefs.length ?? 0} total</span>
        <div className="ml-auto relative w-[280px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-tertiary" strokeWidth={1.75} />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search subject, client, topic"
            className="h-8 pl-8 text-[13px]"
          />
        </div>
      </div>

      {selected.size > 0 && (
        <div className="rounded-md border border-seal-ring bg-seal-subtle/60 px-4 py-3 flex items-center gap-3">
          <span className="text-[13px] font-medium text-ink-primary">
            {selected.size} selected
          </span>
          <span className="text-[12px] text-ink-secondary">
            Sends to a single recipient email for demo purposes.
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Input
              type="email"
              placeholder="Recipient email"
              value={batchRecipient}
              onChange={(e) => setBatchRecipient(e.target.value)}
              className="h-8 w-[240px] text-[13px]"
            />
            <button
              type="button"
              onClick={() => batchSend.mutate()}
              disabled={batchSend.isPending}
              className="inline-flex h-8 items-center gap-1.5 rounded-sm bg-primary px-3 text-[13px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              <Send className="h-3 w-3" strokeWidth={1.75} />
              {batchSend.isPending ? "Sending" : `Send ${selected.size}`}
            </button>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="text-[12px] text-ink-secondary hover:text-ink-primary"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {(q.data?.briefs.length ?? 0) === 0 && !q.isLoading ? (
        <div className="rounded-md border border-border bg-surface">
          <EmptyState
            headline="No briefs drafted yet."
            body="Composer writes one for every affected client after a policy change. When Sentinel catches something, drafts appear here for you to edit and send."
          />
        </div>
      ) : (
      <div className="rounded-md border border-border bg-surface overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              <Th className="w-10 pl-4">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  className="h-3.5 w-3.5 accent-primary cursor-pointer"
                />
              </Th>
              <Th>Subject</Th>
              <Th>Client</Th>
              <Th>Impact</Th>
              <Th className="w-[110px]">Status</Th>
              <Th align="right" className="w-[120px]">When</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-divider">
            {q.isLoading ? (
              <tr>
                <td colSpan={6} className="py-16 text-center label">Loading</td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-16 text-center">
                  <div className="label">Nothing yet</div>
                  <p className="mt-2 text-[12px] text-ink-tertiary">
                    Composer drafts a brief for every affected client after a policy change.
                  </p>
                </td>
              </tr>
            ) : (
              rows.map((b) => {
                const selectable = b.status !== "sent";
                return (
                  <tr key={b.briefId} className="h-11 hover:bg-surface-alt/50 transition-colors">
                    <td className="pl-4">
                      {selectable && (
                        <input
                          type="checkbox"
                          checked={selected.has(b.briefId)}
                          onChange={() => toggle(b.briefId)}
                          className="h-3.5 w-3.5 accent-primary cursor-pointer"
                        />
                      )}
                    </td>
                    <Td>
                      <Link
                        href={`/briefs/${b.briefId}`}
                        className="text-[13px] font-medium text-ink-primary hover:underline underline-offset-4 decoration-border"
                      >
                        {b.subject}
                      </Link>
                    </Td>
                    <Td>
                      <span className="client-chip">{b.clientId}</span>
                    </Td>
                    <Td>
                      <span className="text-[12px] text-ink-secondary">{b.impactType}</span>
                      {b.numericDelta !== null && (
                        <span className="ml-1.5 fingerprint text-ink-primary">
                          {formatDelta(b.numericDelta)}
                        </span>
                      )}
                    </Td>
                    <Td>
                      <StatusPill status={b.status} />
                    </Td>
                    <Td align="right">
                      <span className="text-[11px] text-ink-tertiary tabular">
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
      )}
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
      className={cn(
        "px-4 py-2.5 label",
        align === "right" ? "text-right" : "text-left",
        className,
      )}
    >
      {children}
    </th>
  );
}

function Td({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <td className={cn("px-4", align === "right" ? "text-right" : "text-left")}>{children}</td>
  );
}

function StatusPill({ status }: { status: string }) {
  if (status === "sent") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[12px] text-seal">
        <Seal className="h-3 w-3" />
        Sent
      </span>
    );
  }
  if (status === "edited") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[12px] text-amber">
        <span className="h-2 w-2 rounded-full bg-amber" />
        Edited
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-secondary">
      <span className="h-2 w-2 rounded-full border border-ink-tertiary" />
      Draft
    </span>
  );
}
