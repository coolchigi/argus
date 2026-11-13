"use client";

import Link from "next/link";
import { use, useEffect, useId, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, ClipboardCopy, Send } from "lucide-react";
import { ApiError, api } from "@/lib/api";
import type { Brief } from "@/lib/argus-types";
import { CLIENT_NAME_TOKEN, type SendResult, buildCopyText, confirmManualCopy, copyBrief, describeSendError, findNamedSalutation } from "@/lib/briefs";
import { isNotFound, queryKeys, useBrief, useBriefs, useMarkBriefCopied } from "@/lib/queries";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SectionLabel } from "@/components/argus/section-label";
import { StatusBadge } from "@/components/argus/status-badge";
import { ClientChip } from "@/components/argus/client-chip";
import { Fingerprint } from "@/components/argus/fingerprint";
import { InlineError } from "@/components/argus/inline-error";
import { CitationChips } from "@/components/citation-chips";
import { SignatureReceipt } from "@/components/signature-receipt";
import { ManualCopyDialog } from "@/components/briefs/manual-copy-dialog";
import { useBreadcrumbLabel } from "@/components/nav/breadcrumb-context";
import { formatDayMonthYear } from "@/components/dashboard/derive";
import { humanizeTopic } from "@/lib/humanize";
import { formatRelative } from "@/lib/format";

type ArchiveLink = {
  archiveUrl: string | null;
  expiresInSeconds: number;
  sourceUrl: string;
  sourceIsLive: boolean;
};

export default function BriefDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const briefId = decodeURIComponent(id);
  const brief = useBrief(briefId);
  // Severity only comes on the list response.
  const list = useBriefs();
  const severity = list.data?.briefs.find((b) => b.briefId === briefId)?.severity ?? null;
  const archive = useQuery({
    queryKey: ["archive-link", briefId],
    queryFn: () => api<ArchiveLink>(`/briefs/${encodeURIComponent(briefId)}/archive-link`),
    enabled: !!brief.data?.ruleHash,
  });

  return (
    <div className="space-y-6">
      <Link href="/briefs" className="inline-flex items-center gap-1 text-[12px] text-ink-2 hover:text-ink-1 lg:hidden">
        <ArrowLeft className="h-3 w-3" strokeWidth={1.75} />
        All briefs
      </Link>
      {brief.isLoading ? (
        <div className="py-16 text-center label">Loading</div>
      ) : brief.error && !isNotFound(brief.error) ? (
        <InlineError
          message="Couldn't load this brief."
          detail={brief.error instanceof Error ? brief.error.message : null}
          retrying={brief.isFetching}
          onRetry={() => void brief.refetch()}
        />
      ) : !brief.data ? (
        <div className="py-16 text-center text-[13px] text-danger-ink">Brief not found.</div>
      ) : (
        <BriefBody key={brief.data.briefId} brief={brief.data} severity={severity} archive={archive.data} />
      )}
    </div>
  );
}

function BriefBody({ brief, severity, archive }: { brief: Brief; severity: Brief["severity"]; archive: ArchiveLink | undefined }) {
  const qc = useQueryClient();
  const warningId = useId();
  useBreadcrumbLabel(`${brief.clientId} · ${humanizeTopic(brief.topic)}`);

  const savedBody = brief.editedBodyMarkdown ?? brief.bodyMarkdown;
  const savedActions = (brief.suggestedActions ?? []).join("\n");
  const [subject, setSubject] = useState(brief.subject);
  const [body, setBody] = useState(savedBody);
  const [actionsText, setActionsText] = useState(savedActions);
  const [recipient, setRecipient] = useState("");
  const [sendOpen, setSendOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copying, setCopying] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [justSent, setJustSent] = useState(false);
  // Set when the browser blocks the clipboard. Holds the text the consultant copies by hand.
  const [manualText, setManualText] = useState<string | null>(null);
  const [manualError, setManualError] = useState<string | null>(null);
  const markCopied = useMarkBriefCopied(brief.briefId);
  const sent = brief.status === "sent";

  useEffect(() => {
    setSubject(brief.subject);
    setBody(brief.editedBodyMarkdown ?? brief.bodyMarkdown);
    setActionsText((brief.suggestedActions ?? []).join("\n"));
  }, [brief]);

  const actions = actionsText
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const dirty = subject !== brief.subject || body !== savedBody || actionsText !== savedActions;
  const namedGreeting = sent ? null : findNamedSalutation(`${subject}\n${body}`, brief.clientId);

  function refresh() {
    void qc.invalidateQueries({ queryKey: queryKeys.brief(brief.briefId) });
    void qc.invalidateQueries({ queryKey: queryKeys.briefs() });
    void qc.invalidateQueries({ queryKey: ["policy-events"] });
    void qc.invalidateQueries({ queryKey: ["policy-event-impacts"] });
  }

  async function save(): Promise<void> {
    await api(`/briefs/${encodeURIComponent(brief.briefId)}`, {
      method: "PATCH",
      body: { subject, editedBodyMarkdown: body, suggestedActions: actions.slice(0, 5) },
    });
    refresh();
  }

  async function onSave() {
    setSaving(true);
    try {
      await save();
      toast.success("Draft saved.");
    } catch (err) {
      toast.error(`Couldn't save: ${err instanceof Error ? err.message : "save-failed"}`);
    } finally {
      setSaving(false);
    }
  }

  async function onCopy() {
    setCopying(true);
    try {
      if (dirty) await save();
    } catch (err) {
      toast.error(`Couldn't save before copying: ${err instanceof Error ? err.message : "save-failed"}`);
      setCopying(false);
      return;
    }
    const text = buildCopyText({ subject, body, actions, clientId: brief.clientId });
    const out = await copyBrief(text, {
      writeClipboard: (t) => navigator.clipboard.writeText(t),
      markCopied: () => markCopied.mutateAsync(),
    });
    setCopying(false);
    if (out.kind === "copied") toast.success(`Copied. Paste it into your email and replace ${CLIENT_NAME_TOKEN} with your client's name.`);
    else if (out.kind === "copied-unmarked") toast.error("Copied, but Argus couldn't mark the brief handled. Copy again to retry.");
    else {
      setManualError(null);
      setManualText(out.text);
    }
  }

  async function onConfirmManualCopy() {
    setManualError(null);
    const r = await confirmManualCopy(() => markCopied.mutateAsync());
    if (r === "marked") {
      setManualText(null);
      toast.success("Marked as copied.");
    } else setManualError("Argus couldn't mark the brief handled. Try again.");
  }

  async function onSend(e: React.FormEvent) {
    e.preventDefault();
    if (!recipient.trim()) {
      setSendError("Enter the address to send to.");
      return;
    }
    if (dirty) {
      setSendError("Save your edits first, so Argus signs what you see.");
      return;
    }
    setSending(true);
    setSendError(null);
    try {
      const r = await api<{ result: SendResult }>(`/briefs/${encodeURIComponent(brief.briefId)}/send`, {
        method: "POST",
        body: { recipientEmail: recipient.trim() },
      });
      if (r.result.ok) {
        toast.success("Brief sent and signed.");
        setJustSent(true);
        setRecipient("");
        refresh();
      } else {
        setSendError(describeSendError(r.result.error));
      }
    } catch (err) {
      setSendError(err instanceof ApiError ? describeSendError(err.message) : "Send failed");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge kind="brief" status={brief.status} />
          {severity && <StatusBadge kind="severity" status={severity} />}
          <ClientChip clientId={brief.clientId} />
          <span className="font-mono text-[11px] tabular text-ink-3">Drafted {formatRelative(brief.createdAt)}</span>
          <Link href={`/impacts/${encodeURIComponent(brief.assessmentKey)}`} className="font-mono text-[11px] text-ink-2 underline underline-offset-4 decoration-hairline hover:text-ink-1">
            Open assessment
          </Link>
        </div>
        <h1 className="font-display text-[24px] leading-tight text-ink-1">{subject || "Untitled brief"}</h1>
      </header>

      {brief.status === "sent-externally" && (
        <p className="border-l-2 border-ink-3 bg-sunk px-3 py-2 text-[13px] text-ink-1">
          You copied this for your own email{brief.copiedAt ? ` on ${formatDayMonthYear(brief.copiedAt)}` : ""}. Argus didn&rsquo;t sign it, because it never sees what you send.
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <section aria-label="Editor" className="overflow-hidden border border-hairline bg-card">
          <div className="flex items-center justify-between border-b border-hairline px-4 py-2">
            <div className="label">Editor</div>
            {!sent && <div className="text-[11px] text-ink-3">{dirty ? "Unsaved changes" : "Saved"}</div>}
          </div>
          <div className="space-y-4 p-4">
            <div className="space-y-1.5">
              <SectionLabel as="label" htmlFor="subject">Subject</SectionLabel>
              <Input id="subject" value={subject} onChange={(e) => setSubject(e.target.value)} disabled={sent} className="h-9 text-[14px] font-medium" />
            </div>
            <div className="space-y-1.5">
              <SectionLabel as="label" htmlFor="body">Body</SectionLabel>
              <Textarea
                id="body"
                rows={14}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                disabled={sent}
                aria-describedby={namedGreeting ? warningId : undefined}
                className="text-[13px] leading-relaxed"
              />
              {namedGreeting && (
                <p id={warningId} role="status" className="border-l-2 border-brand-ink bg-brand-subtle px-3 py-2 text-[12px] leading-relaxed text-ink-1">
                  &ldquo;{namedGreeting}&rdquo; reads like it names your client. Argus stores what you save here, so keep names out. Write {CLIENT_NAME_TOKEN} and fill it in from your own email.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <SectionLabel as="label" htmlFor="actions">Suggested actions · one per line</SectionLabel>
              <Textarea id="actions" rows={4} value={actionsText} onChange={(e) => setActionsText(e.target.value)} disabled={sent} className="text-[13px] leading-relaxed" />
            </div>
            {!sent && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => void onSave()}
                  disabled={saving || !dirty}
                  className="h-8 rounded-sm border border-control bg-surface px-3 text-[12px] font-medium text-ink-1 transition-colors hover:bg-sunk disabled:opacity-50"
                >
                  {saving ? "Saving" : dirty ? "Save draft" : "Saved"}
                </button>
              </div>
            )}
          </div>
        </section>

        <section aria-label="Preview" className="overflow-hidden border border-hairline bg-card">
          <div className="border-b border-hairline px-4 py-2">
            <div className="label">Preview</div>
          </div>
          <div className="space-y-4 p-4 sm:p-6">
            <div data-tour="brief-draft" className="space-y-4">
              <div className="border-b border-hairline pb-4">
                <div className="label">Subject</div>
                <div className="mt-1 text-[14px] font-medium text-ink-1">{subject || "Untitled"}</div>
              </div>
              <article className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink-1">{body || "The body appears here."}</article>
            </div>
            {actions.length > 0 && (
              <div className="border-t border-hairline pt-4">
                <div className="label mb-2">Suggested actions</div>
                <ul className="space-y-1.5">
                  {actions.map((a, i) => (
                    <li key={i} className="flex gap-2 text-[13px] text-ink-1">
                      <span aria-hidden className="text-ink-3">·</span>
                      <span>{a}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {archive && (archive.sourceUrl || archive.archiveUrl) && (
              <div className="border-t border-hairline pt-4">
                <div className="label mb-2">IRCC page cited</div>
                <CitationChips liveUrl={archive.sourceUrl} liveIsReachable={archive.sourceIsLive} archiveUrl={archive.archiveUrl} archiveFingerprint={brief.ruleHash} />
              </div>
            )}
          </div>
        </section>
      </div>

      {sent ? (
        <section aria-label="Send receipt" className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-2 border border-hairline bg-card px-4 py-4 text-[13px] text-ink-1">
            <p>
              Sent {brief.sentAt ? formatDayMonthYear(brief.sentAt) : ""} · {formatRelative(brief.sentAt)}
              {brief.sentRecipientDomain && (
                <>
                  {" "}
                  to an address at <span className="fingerprint">{brief.sentRecipientDomain}</span>
                </>
              )}
            </p>
            <p className="text-ink-2">Argus signed the exact text it sent. The email footer links your client to this receipt.</p>
            {brief.sentBodyHash && (
              <p className="text-ink-2">
                Public receipt <Fingerprint hash={brief.sentBodyHash} signed chars={12} href={`/verify/${brief.sentBodyHash}`} />
              </p>
            )}
          </div>
          <SignatureReceipt
            kind="brief"
            briefId={brief.briefId}
            fingerprintPreview={brief.sentBodyHash}
            signedAt={brief.sentAt ?? brief.createdAt}
            autoVerify={justSent}
          />
        </section>
      ) : (
        <section aria-label="Send" className="space-y-3 border border-hairline bg-card px-4 py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <div className="min-w-0 sm:min-w-[16rem] sm:flex-1">
              <div className="label">Send it</div>
              <p className="mt-1 text-[12px] text-ink-2">
                Copy it into your own email and swap {CLIENT_NAME_TOKEN} for the name there. Argus never sees the name.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={() => void onCopy()}
                disabled={copying}
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-sm border border-brand-ink bg-brand px-4 text-[13px] font-medium text-on-brand transition-colors hover:bg-brand-hover disabled:opacity-50"
              >
                <ClipboardCopy className="h-3.5 w-3.5" strokeWidth={1.75} />
                {copying ? "Copying" : "Copy for my email"}
              </button>
              <button
                type="button"
                onClick={() => setSendOpen((v) => !v)}
                aria-expanded={sendOpen}
                aria-controls="send-via-argus"
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-sm border border-control bg-surface px-3 text-[13px] font-medium text-ink-1 transition-colors hover:bg-sunk"
              >
                <Send className="h-3.5 w-3.5" strokeWidth={1.75} />
                Send and sign via Argus
              </button>
            </div>
          </div>
          {sendOpen && (
            <form id="send-via-argus" onSubmit={onSend} className="flex flex-wrap items-center gap-2 border-t border-hairline pt-3">
              <p className="basis-full text-[12px] text-ink-2">
                Argus signs the final text, sends it and adds a link your client can use to check it. It keeps a hash of the address, never the address.
              </p>
              <label htmlFor="recipient" className="sr-only">
                Send to
              </label>
              <Input
                id="recipient"
                type="email"
                placeholder="Send to"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                className="h-9 min-w-0 flex-1 text-[13px] sm:max-w-[320px]"
              />
              <button
                type="submit"
                disabled={sending}
                className="inline-flex h-9 items-center gap-1.5 rounded-sm border border-control bg-surface px-3 text-[13px] font-medium text-ink-1 transition-colors hover:bg-sunk disabled:opacity-50"
              >
                {sending ? "Sending" : "Send and sign"}
              </button>
              {sendError && (
                <p role="alert" className="basis-full text-[12px] text-danger-ink">
                  {sendError}
                </p>
              )}
            </form>
          )}
        </section>
      )}

      {manualText !== null && (
        <ManualCopyDialog
          text={manualText}
          confirming={markCopied.isPending}
          error={manualError}
          onConfirm={() => void onConfirmManualCopy()}
          onClose={() => setManualText(null)}
        />
      )}
    </div>
  );
}
