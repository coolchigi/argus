"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Send } from "lucide-react";
import { ApiError, api } from "@/lib/api";
import type { Brief } from "@/lib/argus-types";
import { type BatchRowState, type SendResult, batchStatesFromResults, isDelivered } from "@/lib/briefs";
import { queryKeys, useBriefs } from "@/lib/queries";
import { humanizeTopic } from "@/lib/humanize";
import { formatRelative } from "@/lib/format";
import { StatusBadge } from "@/components/argus/status-badge";
import { InlineError } from "@/components/argus/inline-error";
import { ProgressLine } from "@/components/argus/progress-line";
import { cn } from "@/lib/utils";

/**
 * Two panes: the brief list stays mounted on the left while /briefs/[id]
 * swaps on the right. Below 1024px it's one pane at a time: the list on
 * /briefs, the brief on /briefs/[id].
 */
export function BriefsWorkspace({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const selectedId = pathname.startsWith("/briefs/") ? decodeURIComponent(pathname.slice("/briefs/".length).split("/")[0]) : null;
  const q = useBriefs();
  const qc = useQueryClient();
  const briefs = useMemo(() => q.data?.briefs ?? [], [q.data]);

  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [states, setStates] = useState<Record<string, BatchRowState>>({});
  const [recipient, setRecipient] = useState("");
  const [batchError, setBatchError] = useState<string | null>(null);
  const sending = Object.values(states).some((s) => s.status === "signing");

  const term = search.trim().toLowerCase();
  const rows = briefs.filter(
    (b) =>
      !term ||
      b.subject.toLowerCase().includes(term) ||
      b.clientId.toLowerCase().includes(term) ||
      humanizeTopic(b.topic).toLowerCase().includes(term),
  );

  function toggle(id: string) {
    if (sending) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setStates((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  function clearBatch() {
    setSelected(new Set());
    setStates({});
    setBatchError(null);
  }

  async function sendBatch() {
    const ids = Array.from(selected);
    if (!recipient.trim()) {
      setBatchError("Enter the address to send to.");
      return;
    }
    setBatchError(null);
    // One request signs and sends every brief, so every row is in flight together.
    setStates(Object.fromEntries(ids.map((id) => [id, { status: "signing" } as BatchRowState])));
    try {
      const res = await api<{ results: SendResult[] }>("/briefs/batch-send", {
        method: "POST",
        body: { sends: ids.map((briefId) => ({ briefId, recipientEmail: recipient.trim() })) },
      });
      setStates(batchStatesFromResults(ids, res.results ?? []));
      void qc.invalidateQueries({ queryKey: queryKeys.briefs() });
      for (const id of ids) void qc.invalidateQueries({ queryKey: queryKeys.brief(id) });
      void qc.invalidateQueries({ queryKey: ["policy-events"] });
    } catch (err) {
      setStates(Object.fromEntries(ids.map((id) => [id, { status: "pending" } as BatchRowState])));
      setBatchError(err instanceof ApiError ? `The batch didn't go out (${err.message}). Nothing was sent.` : "The batch didn't go out. Nothing was sent.");
    }
  }

  const list = (
    <nav aria-label="Briefs" className="flex min-h-0 flex-col border border-hairline bg-card">
      <div className="space-y-2 border-b border-hairline p-3">
        <div className="flex items-baseline justify-between gap-2">
          <h1 className="font-display text-[20px] leading-tight text-ink-1">Action briefs</h1>
          {q.data && <span className="font-mono text-[11px] tabular text-ink-3">{briefs.length}</span>}
        </div>
        <label htmlFor="briefs-search" className="sr-only">
          Search briefs
        </label>
        <input
          id="briefs-search"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search subject, client, topic"
          className="h-8 w-full rounded-sm border border-control bg-surface px-2.5 text-[13px] text-ink-1 placeholder:text-ink-3"
        />
      </div>
      {q.error ? (
        <InlineError
          className="m-3"
          message="Couldn't load your briefs."
          detail={q.error instanceof Error ? q.error.message : null}
          retrying={q.isFetching}
          onRetry={() => void q.refetch()}
        />
      ) : q.isPending ? (
        <ul aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <li key={i} className="h-[76px] border-b border-hairline" />
          ))}
        </ul>
      ) : briefs.length === 0 ? (
        <p className="p-4 text-[13px] text-ink-2">No briefs drafted yet.</p>
      ) : rows.length === 0 ? (
        <p className="p-4 text-[13px] text-ink-2">Nothing matches. Clear the search to see every brief.</p>
      ) : (
        <ul className="lg:max-h-[calc(100vh-220px)] lg:overflow-y-auto">
          {rows.map((b) => (
            <BriefRow
              key={b.briefId}
              brief={b}
              active={b.briefId === selectedId}
              checked={selected.has(b.briefId)}
              state={states[b.briefId]}
              onToggle={() => toggle(b.briefId)}
            />
          ))}
        </ul>
      )}
    </nav>
  );

  return (
    <>
    <ProgressLine active={q.isFetching && !q.isPending} fixed label="Refreshing briefs" />
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
      <div className={cn(selectedId ? "hidden lg:block" : "block", "lg:sticky lg:top-6 lg:self-start")}>{list}</div>
      <div className={cn("min-w-0 space-y-6", selectedId ? "block" : "hidden lg:block")}>
        {selected.size > 0 && (
          <BatchPanel
            briefs={briefs.filter((b) => selected.has(b.briefId))}
            states={states}
            recipient={recipient}
            onRecipientChange={setRecipient}
            onSend={() => void sendBatch()}
            onClear={clearBatch}
            sending={sending}
            error={batchError}
          />
        )}
        {children}
      </div>
    </div>
    </>
  );
}

function BriefRow({
  brief: b,
  active,
  checked,
  state,
  onToggle,
}: {
  brief: Brief;
  active: boolean;
  checked: boolean;
  state: BatchRowState | undefined;
  onToggle: () => void;
}) {
  // Only unsent drafts go in a batch. A copied brief is already handled.
  const batchable = !isDelivered(b.status);
  return (
    <li className={cn("relative border-b border-hairline transition-colors last:border-b-0", active ? "bg-brand-subtle/50" : "hover:bg-sunk/60 focus-within:bg-sunk/60")}>
      {active && <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-brand-ink" />}
      <div className="flex gap-2.5 py-3 pl-4 pr-3">
        <div className="pt-0.5">
          {batchable ? (
            <input
              type="checkbox"
              aria-label={`Select the brief for ${b.clientId} to send in a batch`}
              checked={checked}
              onChange={onToggle}
              className="relative z-10 h-3.5 w-3.5 cursor-pointer accent-brand"
            />
          ) : (
            <span aria-hidden className="block h-3.5 w-3.5" />
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <Link
            href={`/briefs/${encodeURIComponent(b.briefId)}`}
            aria-current={active ? "page" : undefined}
            className="block truncate text-[13px] font-medium text-ink-1 after:absolute after:inset-0 after:content-['']"
          >
            {b.subject || "Untitled brief"}
          </Link>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="client-chip">{b.clientId}</span>
            <StatusBadge kind="brief" status={b.status} />
            {b.severity && <StatusBadge kind="severity" status={b.severity} />}
          </div>
          <div className="flex items-center justify-between gap-2 font-mono text-[11px] text-ink-3">
            <span className="truncate">{humanizeTopic(b.topic)}</span>
            <time dateTime={b.sentAt ?? b.createdAt} className="shrink-0 tabular">
              {formatRelative(b.sentAt ?? b.createdAt)}
            </time>
          </div>
          {state && <BatchStateLine state={state} />}
        </div>
      </div>
    </li>
  );
}

const BATCH_LABEL: Record<BatchRowState["status"], string> = {
  pending: "Pending",
  signing: "Signing and sending",
  sent: "Sent",
  failed: "Failed",
};

/** Opacity flip only, 120ms. The words carry the state, the colour backs them up. */
function BatchStateLine({ state }: { state: BatchRowState }) {
  return (
    <p
      key={state.status}
      aria-live="polite"
      className={cn(
        "animate-in fade-in duration-[120ms] font-mono text-[11px]",
        state.status === "failed" ? "text-danger-ink" : state.status === "sent" ? "text-ink-1" : "text-ink-2",
      )}
    >
      {BATCH_LABEL[state.status]}
      {state.error ? `: ${state.error}` : ""}
    </p>
  );
}

function BatchPanel({
  briefs,
  states,
  recipient,
  onRecipientChange,
  onSend,
  onClear,
  sending,
  error,
}: {
  briefs: Brief[];
  states: Record<string, BatchRowState>;
  recipient: string;
  onRecipientChange: (v: string) => void;
  onSend: () => void;
  onClear: () => void;
  sending: boolean;
  error: string | null;
}) {
  const finished = briefs.length > 0 && briefs.every((b) => states[b.briefId]?.status === "sent" || states[b.briefId]?.status === "failed");
  const sentCount = briefs.filter((b) => states[b.briefId]?.status === "sent").length;
  return (
    <section aria-labelledby="batch-heading" className="border border-brand-ink/40 bg-brand-subtle/40">
      <div className="flex flex-wrap items-center gap-3 border-b border-hairline px-4 py-3">
        <h2 id="batch-heading" className="text-[13px] font-medium text-ink-1">
          {finished ? `Sent ${sentCount} of ${briefs.length}` : `${briefs.length} selected to send`}
        </h2>
        <span className="text-[12px] text-ink-2">Every selected brief goes to one address. Argus signs each one as it sends.</span>
      </div>
      <ul className="divide-y divide-hairline">
        {briefs.map((b) => (
          <li key={b.briefId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
            <span className="flex min-w-0 items-center gap-2">
              <span className="client-chip">{b.clientId}</span>
              <span className="truncate text-[13px] text-ink-1">{b.subject}</span>
            </span>
            <BatchStateLine state={states[b.briefId] ?? { status: "pending" }} />
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2 border-t border-hairline px-4 py-3">
        {!finished && (
          <>
            <label htmlFor="batch-recipient" className="sr-only">
              Send to
            </label>
            <input
              id="batch-recipient"
              type="email"
              placeholder="Send to"
              value={recipient}
              onChange={(e) => onRecipientChange(e.target.value)}
              disabled={sending}
              className="h-8 min-w-0 flex-1 rounded-sm border border-control bg-surface px-3 text-[13px] text-ink-1 placeholder:text-ink-3 sm:max-w-[280px]"
            />
            <button
              type="button"
              onClick={onSend}
              disabled={sending}
              className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-brand-ink bg-brand px-3 text-[13px] font-medium text-on-brand transition-colors hover:bg-brand-hover disabled:opacity-50"
            >
              <Send className="h-3 w-3" strokeWidth={1.75} />
              {sending ? "Sending" : `Send and sign ${briefs.length}`}
            </button>
          </>
        )}
        <button type="button" onClick={onClear} disabled={sending} className="h-8 px-2 text-[12px] text-ink-2 transition-colors hover:text-ink-1 disabled:opacity-50">
          {finished ? "Done" : "Clear"}
        </button>
        {error && (
          <p role="alert" className="basis-full text-[12px] text-danger-ink">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
