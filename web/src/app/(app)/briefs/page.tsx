"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { Brief } from "@/lib/argus-types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
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
      if (!batchRecipient.trim()) throw new Error("Enter a recipient email for the batch demo.");
      const sends = Array.from(selected).map((briefId) => ({ briefId, recipientEmail: batchRecipient.trim() }));
      return api<{ total: number; succeeded: number; failed: number }>("/briefs/batch-send", {
        method: "POST",
        body: { sends },
      });
    },
    onSuccess: (r) => {
      toast.success(`Batch: ${r.succeeded}/${r.total} sent, ${r.failed} failed.`);
      qc.invalidateQueries({ queryKey: ["briefs"] });
      setSelected(new Set());
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "batch-send-failed"),
  });

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Client briefs</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Auto-drafted by Composer. Edit inline, sign, send. Batch supported for a rule that hits many clients.
          </p>
        </div>
      </header>

      {selected.size > 0 && (
        <Card className="p-4 border-primary/40 bg-accent/50">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm font-medium">
              {selected.size} brief{selected.size === 1 ? "" : "s"} selected
            </span>
            <div className="flex-1 flex items-center gap-2">
              <Input
                type="email"
                placeholder="Batch recipient email (goes to same address for demo)"
                value={batchRecipient}
                onChange={(e) => setBatchRecipient(e.target.value)}
                className="max-w-xs"
              />
              <Button size="sm" onClick={() => batchSend.mutate()} disabled={batchSend.isPending}>
                <Send className="h-3.5 w-3.5" />
                {batchSend.isPending ? "Sending..." : `Send ${selected.size} briefs`}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
            </div>
          </div>
        </Card>
      )}

      <Card className="p-0 overflow-hidden">
        {q.isLoading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Loading briefs...</div>
        ) : (q.data?.briefs.length ?? 0) === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No briefs yet. Composer generates one for each affected client after a policy change.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="h-3.5 w-3.5 rounded border-input cursor-pointer"
                  />
                </TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Impact</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.data!.briefs.map((b) => {
                const selectable = b.status !== "sent";
                return (
                  <TableRow key={b.briefId}>
                    <TableCell>
                      {selectable && (
                        <input
                          type="checkbox"
                          checked={selected.has(b.briefId)}
                          onChange={() => toggle(b.briefId)}
                          className="h-3.5 w-3.5 rounded border-input cursor-pointer"
                        />
                      )}
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/briefs/${b.briefId}`}
                        className="font-medium text-foreground hover:underline"
                      >
                        {b.subject}
                      </Link>
                    </TableCell>
                    <TableCell className="text-xs">{b.clientId}</TableCell>
                    <TableCell className="text-xs">
                      <span className="text-muted-foreground">{b.impactType}</span>
                      <span className="ml-1 tabular">{formatDelta(b.numericDelta)}</span>
                    </TableCell>
                    <TableCell>
                      <BriefStatusBadge status={b.status} />
                    </TableCell>
                    <TableCell className="text-right text-[11px] text-muted-foreground">
                      {formatRelative(b.createdAt)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}

function BriefStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    draft: "bg-muted text-muted-foreground",
    edited: "bg-accent text-accent-foreground",
    sent: "bg-primary/10 text-primary",
  };
  return (
    <Badge className={"h-5 border-0 " + (map[status] ?? "bg-muted text-muted-foreground")}>
      {status}
    </Badge>
  );
}
