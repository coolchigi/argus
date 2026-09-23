"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { Brief } from "@/lib/argus-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, ExternalLink, Send, ShieldCheck } from "lucide-react";
import { formatRelative } from "@/lib/format";

type ArchiveLink = { archiveUrl: string | null; expiresInSeconds: number; sourceUrl: string; sourceIsLive: boolean };

export default function BriefDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: briefId } = use(params);
  const qc = useQueryClient();

  const brief = useQuery({
    queryKey: ["brief", briefId],
    queryFn: () => api<Brief>(`/briefs/${briefId}`),
  });

  const archive = useQuery({
    queryKey: ["archive-link", briefId],
    queryFn: () => api<ArchiveLink>(`/briefs/${briefId}/archive-link`),
    enabled: !!brief.data?.ruleHash,
  });

  return (
    <div className="space-y-8">
      <Link href="/briefs" className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3 w-3" strokeWidth={1.75} /> Back to briefs
      </Link>

      {brief.isLoading ? (
        <div className="py-16 text-center text-[11px] text-muted-foreground">Loading…</div>
      ) : !brief.data ? (
        <div className="py-16 text-center text-[11px] text-destructive">Brief not found.</div>
      ) : (
        <BriefBody brief={brief.data} archive={archive.data} onSaved={() => qc.invalidateQueries({ queryKey: ["brief", briefId] })} />
      )}
    </div>
  );
}

function BriefBody({ brief, archive, onSaved }: { brief: Brief; archive: ArchiveLink | undefined; onSaved: () => void }) {
  const [subject, setSubject] = useState(brief.subject);
  const [body, setBody] = useState(brief.editedBodyMarkdown ?? brief.bodyMarkdown);
  const [actionsText, setActionsText] = useState((brief.suggestedActions ?? []).join("\n"));
  const [recipient, setRecipient] = useState("");
  const [savingBusy, setSavingBusy] = useState(false);
  const [sendingBusy, setSendingBusy] = useState(false);
  const readOnly = brief.status === "sent";

  useEffect(() => {
    setSubject(brief.subject);
    setBody(brief.editedBodyMarkdown ?? brief.bodyMarkdown);
    setActionsText((brief.suggestedActions ?? []).join("\n"));
  }, [brief]);

  const dirty =
    subject !== brief.subject ||
    body !== (brief.editedBodyMarkdown ?? brief.bodyMarkdown) ||
    actionsText !== (brief.suggestedActions ?? []).join("\n");

  async function onSave() {
    setSavingBusy(true);
    try {
      await api(`/briefs/${brief.briefId}`, {
        method: "PATCH",
        body: {
          subject,
          editedBodyMarkdown: body,
          suggestedActions: actionsText.split("\n").map((s) => s.trim()).filter(Boolean),
        },
      });
      toast.success("Draft saved.");
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "save-failed");
    } finally {
      setSavingBusy(false);
    }
  }

  async function onSend() {
    if (!recipient.trim()) {
      toast.error("Enter a recipient email.");
      return;
    }
    if (dirty) {
      toast.error("Save your edits first.");
      return;
    }
    setSendingBusy(true);
    try {
      const r = await api<{ result: { ok: boolean; sesMessageId?: string; error?: string } }>(
        `/briefs/${brief.briefId}/send`,
        { method: "POST", body: { recipientEmail: recipient.trim() } },
      );
      if (r.result.ok) {
        toast.success("Brief sent");
        onSaved();
      } else {
        toast.error(r.result.error ?? "send-failed");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "send-failed");
    } finally {
      setSendingBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-[1fr_300px] gap-8">
      <div className="space-y-6 min-w-0">
        <header className="space-y-1">
          <div className="flex items-center gap-2 text-[11px]">
            <StatusPill status={brief.status} />
            <span className="text-muted-foreground tabular">Client {brief.clientId}</span>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground tabular">{formatRelative(brief.createdAt)}</span>
          </div>
        </header>

        <div className="border border-border bg-card rounded-md p-6 space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="subject" className="label">Subject</Label>
            <Input
              id="subject"
              className="h-9 text-[13px] font-medium"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              disabled={readOnly}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="body" className="label">Body</Label>
            <Textarea
              id="body"
              rows={16}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              disabled={readOnly}
              className="font-mono text-[12px] leading-relaxed"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="actions" className="label">Suggested actions (one per line)</Label>
            <Textarea
              id="actions"
              rows={4}
              value={actionsText}
              onChange={(e) => setActionsText(e.target.value)}
              disabled={readOnly}
              className="text-[12px]"
            />
          </div>
          {!readOnly && (
            <div className="flex justify-end">
              <Button size="sm" onClick={onSave} disabled={savingBusy || !dirty}>
                {savingBusy ? "Saving…" : dirty ? "Save draft" : "Saved"}
              </Button>
            </div>
          )}
        </div>

        {!readOnly && (
          <div className="border border-border bg-card rounded-md p-6">
            <div className="flex items-center gap-1.5">
              <Send className="h-3.5 w-3.5 text-brand" strokeWidth={1.75} />
              <span className="label">Send to client</span>
            </div>
            <p className="mt-1 text-[12px] text-muted-foreground">
              KMS-signed before dispatch. Recipient hashed, never stored plaintext.
            </p>
            <div className="mt-4 flex items-center gap-2">
              <Input
                type="email"
                placeholder="client@example.com"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                className="h-9 text-[13px]"
              />
              <Button onClick={onSend} disabled={sendingBusy} size="sm">
                {sendingBusy ? "Sending…" : "Send"}
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="space-y-4">
        <div className="border border-border bg-card rounded-md p-4">
          <div className="label">Citation</div>
          {archive ? (
            <div className="mt-3 space-y-3">
              <div className="text-[11px]">
                <div className="text-muted-foreground">Live source</div>
                <a
                  href={archive.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-flex items-start gap-1 text-foreground hover:underline break-all"
                >
                  {archive.sourceUrl}
                  <ExternalLink className="h-3 w-3 mt-0.5 flex-shrink-0 text-muted-foreground" strokeWidth={1.75} />
                </a>
                <div className="mt-1">
                  {archive.sourceIsLive ? (
                    <span className="text-brand">Reachable</span>
                  ) : (
                    <span className="text-destructive">Dead. Use archive.</span>
                  )}
                </div>
              </div>
              {archive.archiveUrl && (
                <div className="border-t border-border pt-3 text-[11px]">
                  <div className="text-muted-foreground">Argus archive</div>
                  <a
                    href={archive.archiveUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-flex items-center gap-1 text-foreground hover:underline"
                  >
                    Open verified snapshot
                    <ExternalLink className="h-3 w-3 text-muted-foreground" strokeWidth={1.75} />
                  </a>
                  <div className="mt-1 text-muted-foreground">Presigned, 7-day TTL.</div>
                </div>
              )}
            </div>
          ) : (
            <div className="mt-2 text-[11px] text-muted-foreground">Checking…</div>
          )}
        </div>

        {readOnly && brief.sentBodyMarkdown && (
          <div className="border border-border bg-card rounded-md p-4">
            <div className="flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-brand" strokeWidth={1.75} />
              <span className="label">Sent + signed</span>
            </div>
            <div className="mt-3 space-y-1.5 text-[11px]">
              <div>
                <div className="text-muted-foreground">Sent</div>
                <div className="tabular">{formatRelative(brief.sentAt)}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Recipient domain</div>
                <div>{brief.sentRecipientDomain}</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
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
