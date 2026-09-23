"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { Brief } from "@/lib/argus-types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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
    <div className="space-y-6">
      <Link href="/briefs" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3 w-3" /> Back to briefs
      </Link>

      {brief.isLoading ? (
        <div className="py-16 text-center text-sm text-muted-foreground">Loading brief...</div>
      ) : !brief.data ? (
        <div className="py-16 text-center text-sm text-destructive">Brief not found.</div>
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
        toast.success("Brief sent. SES message id " + r.result.sesMessageId);
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
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
      <div className="space-y-4 min-w-0">
        <header className="space-y-1">
          <div className="flex items-center gap-2">
            <BriefStatusBadge status={brief.status} />
            <span className="text-xs text-muted-foreground">·</span>
            <span className="text-xs text-muted-foreground">Client {brief.clientId}</span>
            <span className="text-xs text-muted-foreground">·</span>
            <span className="text-xs text-muted-foreground">{formatRelative(brief.createdAt)}</span>
          </div>
        </header>

        <Card className="p-5 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="subject" className="text-xs">Subject</Label>
            <Input id="subject" value={subject} onChange={(e) => setSubject(e.target.value)} disabled={readOnly} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="body" className="text-xs">Body (Markdown)</Label>
            <Textarea
              id="body"
              rows={14}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              disabled={readOnly}
              className="font-mono text-xs"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="actions" className="text-xs">Suggested actions (one per line, up to 5)</Label>
            <Textarea
              id="actions"
              rows={4}
              value={actionsText}
              onChange={(e) => setActionsText(e.target.value)}
              disabled={readOnly}
            />
          </div>
          {!readOnly && (
            <div className="flex justify-end">
              <Button size="sm" onClick={onSave} disabled={savingBusy || !dirty}>
                {savingBusy ? "Saving..." : dirty ? "Save draft" : "Saved"}
              </Button>
            </div>
          )}
        </Card>

        {!readOnly && (
          <Card className="p-5">
            <div className="flex items-center gap-2 mb-3">
              <Send className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold">Send to client</h3>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              KMS-signs the final body before dispatch. Recipient email is hashed on our side, not stored plaintext.
            </p>
            <div className="flex items-center gap-2">
              <Input
                type="email"
                placeholder="client@example.com"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
              />
              <Button onClick={onSend} disabled={sendingBusy}>
                {sendingBusy ? "Sending..." : "Send"}
              </Button>
            </div>
          </Card>
        )}
      </div>

      <div className="space-y-4">
        <Card className="p-4">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Citation</div>
          {archive ? (
            <div className="mt-2 space-y-2 text-xs">
              <div>
                <div className="text-muted-foreground">Live source</div>
                <div className="mt-0.5 flex items-start gap-1">
                  <a href={archive.sourceUrl} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2 break-all">
                    {archive.sourceUrl}
                  </a>
                  <ExternalLink className="h-3 w-3 mt-0.5 flex-shrink-0 text-muted-foreground" />
                </div>
                <div className="mt-1">
                  {archive.sourceIsLive ? (
                    <span className="text-primary">Live URL is reachable.</span>
                  ) : (
                    <span className="text-destructive">Live URL is dead. Use archive.</span>
                  )}
                </div>
              </div>
              {archive.archiveUrl && (
                <div className="pt-2 border-t border-border">
                  <div className="text-muted-foreground">Argus archive (verified snapshot)</div>
                  <div className="mt-0.5 flex items-start gap-1">
                    <a href={archive.archiveUrl} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2 break-all">
                      Open archive
                    </a>
                    <ExternalLink className="h-3 w-3 mt-0.5 flex-shrink-0 text-muted-foreground" />
                  </div>
                  <div className="mt-1 text-muted-foreground">Presigned URL, expires in 7 days.</div>
                </div>
              )}
            </div>
          ) : (
            <div className="mt-2 text-xs text-muted-foreground">Checking citation...</div>
          )}
        </Card>

        {readOnly && brief.sentBodyMarkdown && (
          <Card className="p-4">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-primary" />
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Sent + signed</div>
            </div>
            <div className="mt-2 text-xs">
              <div className="text-muted-foreground">Sent at</div>
              <div className="tabular">{brief.sentAt}</div>
            </div>
            <div className="mt-2 text-xs">
              <div className="text-muted-foreground">Recipient domain</div>
              <div>{brief.sentRecipientDomain}</div>
            </div>
          </Card>
        )}
      </div>
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
