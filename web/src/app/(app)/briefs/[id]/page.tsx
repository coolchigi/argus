"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { Brief } from "@/lib/argus-types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CitationChips } from "@/components/citation-chips";
import { Seal } from "@/components/seal";
import { ArrowLeft, Send } from "lucide-react";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

type ArchiveLink = {
  archiveUrl: string | null;
  expiresInSeconds: number;
  sourceUrl: string;
  sourceIsLive: boolean;
};

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
      <Link
        href="/briefs"
        className="inline-flex items-center gap-1 text-[12px] text-ink-secondary hover:text-ink-primary"
      >
        <ArrowLeft className="h-3 w-3" strokeWidth={1.75} />
        Back to briefs
      </Link>

      {brief.isLoading ? (
        <div className="py-16 text-center label">Loading</div>
      ) : !brief.data ? (
        <div className="py-16 text-center text-[13px] text-red">Brief not found.</div>
      ) : (
        <BriefBody
          brief={brief.data}
          archive={archive.data}
          onSaved={() => qc.invalidateQueries({ queryKey: ["brief", briefId] })}
        />
      )}
    </div>
  );
}

function BriefBody({
  brief,
  archive,
  onSaved,
}: {
  brief: Brief;
  archive: ArchiveLink | undefined;
  onSaved: () => void;
}) {
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

  const actions = actionsText
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

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
          suggestedActions: actions.slice(0, 5),
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
        toast.success("Brief sent and signed.");
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
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="flex items-center gap-2">
          <StatusPill status={brief.status} />
          <span className="text-[12px] text-ink-secondary">
            for <span className="client-chip">{brief.clientId}</span>
          </span>
          <span className="text-[12px] text-ink-tertiary">·</span>
          <span className="text-[12px] text-ink-tertiary tabular">{formatRelative(brief.createdAt)}</span>
        </div>
        <h1
          className="text-[24px] font-medium tracking-tight text-ink-primary leading-tight"
          style={{ fontFamily: "var(--font-newsreader), serif" }}
        >
          {subject || "Untitled brief"}
        </h1>
      </header>

      <div className="grid grid-cols-2 gap-4">
        {/* Editor */}
        <div className="rounded-md border border-border bg-surface overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-4 py-2">
            <div className="label">Editor</div>
            {!readOnly && (
              <div className="text-[11px] text-ink-tertiary">
                {dirty ? "Unsaved changes" : "Saved"}
              </div>
            )}
          </div>
          <div className="p-4 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="subject" className="label">Subject</Label>
              <Input
                id="subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                disabled={readOnly}
                className="h-9 text-[14px] font-medium"
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
                className="text-[13px] leading-relaxed"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="actions" className="label">Suggested actions · one per line</Label>
              <Textarea
                id="actions"
                rows={4}
                value={actionsText}
                onChange={(e) => setActionsText(e.target.value)}
                disabled={readOnly}
                className="text-[13px] leading-relaxed"
              />
            </div>
            {!readOnly && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={onSave}
                  disabled={savingBusy || !dirty}
                  className={cn(
                    "h-8 rounded-sm px-3 text-[12px] font-medium transition-colors",
                    "border border-border bg-surface text-ink-primary hover:bg-surface-alt disabled:opacity-50",
                  )}
                >
                  {savingBusy ? "Saving" : dirty ? "Save draft" : "Saved"}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Preview */}
        <div className="rounded-md border border-border bg-surface overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-4 py-2">
            <div className="label">Preview · what your client sees</div>
          </div>
          <div className="p-6 space-y-4 min-h-[500px]">
            <div className="pb-4 border-b border-divider">
              <div className="text-[11px] text-ink-tertiary uppercase tracking-wider">Subject</div>
              <div className="mt-1 text-[14px] font-medium text-ink-primary">{subject || "Untitled"}</div>
            </div>
            <article className="text-[13px] leading-relaxed text-ink-primary whitespace-pre-wrap">
              {body || "Body will appear here."}
            </article>
            {actions.length > 0 && (
              <div className="border-t border-divider pt-4">
                <div className="label mb-2">Suggested actions</div>
                <ul className="space-y-1.5">
                  {actions.map((a, i) => (
                    <li key={i} className="flex gap-2 text-[13px] text-ink-primary">
                      <span className="text-ink-tertiary">·</span>
                      <span>{a}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {archive && (archive.sourceUrl || archive.archiveUrl) && (
              <div className="border-t border-divider pt-4">
                <div className="label mb-2">IRCC page cited</div>
                <CitationChips
                  liveUrl={archive.sourceUrl}
                  liveIsReachable={archive.sourceIsLive}
                  archiveUrl={archive.archiveUrl}
                  archiveFingerprint={brief.ruleHash}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Send bar */}
      {!readOnly ? (
        <div className="rounded-md border border-border bg-surface px-5 py-4">
          <div className="flex items-center gap-4">
            <div className="flex-1 min-w-0">
              <div className="label">Send to client</div>
              <p className="mt-1 text-[12px] text-ink-secondary">
                Argus signs the final body before dispatch. Recipient email is hashed on our side, never stored plaintext.
              </p>
            </div>
            <Input
              type="email"
              placeholder="client@example.com"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              className="h-9 max-w-[280px] text-[13px]"
              disabled={dirty}
            />
            <button
              type="button"
              onClick={onSend}
              disabled={sendingBusy || dirty}
              className="inline-flex h-9 items-center gap-1.5 rounded-sm bg-primary px-4 text-[13px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              <Send className="h-3.5 w-3.5" strokeWidth={1.75} />
              {sendingBusy ? "Sending" : "Send and sign"}
            </button>
          </div>
          {dirty && (
            <p className="mt-2 text-[11px] text-amber">Save your edits before sending.</p>
          )}
        </div>
      ) : (
        <div className="rounded-md border border-seal-ring bg-seal-subtle/40 px-5 py-4">
          <div className="flex items-center gap-2">
            <Seal className="h-4 w-4 text-seal" />
            <span className="text-[13px] font-medium text-ink-primary">
              Sent and signed
            </span>
            <span className="ml-auto text-[12px] text-ink-secondary tabular">
              {formatRelative(brief.sentAt)}
              {brief.sentRecipientDomain && (
                <span className="ml-2 text-ink-tertiary">
                  domain <span className="fingerprint text-ink-secondary">{brief.sentRecipientDomain}</span>
                </span>
              )}
            </span>
          </div>
        </div>
      )}
    </div>
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
