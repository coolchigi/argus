"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { ClientChip } from "@/components/argus/client-chip";
import { Fingerprint } from "@/components/argus/fingerprint";
import { Badge, StatusBadge } from "@/components/argus/status-badge";
import { formatDayMonthYear } from "@/components/dashboard/derive";
import {
  sealSummary,
  verifyRow,
  type RowVerifyState,
  type SignatureMaterial,
  type SignedRow,
} from "@/components/policy-events/derive";
import { Seal } from "@/components/seal";
import { api } from "@/lib/api";
import type { AuditSignature } from "@/lib/argus-types";
import { VERIFY_TIMELINE, prefersReducedMotion } from "@/lib/motion";
import { verifyAssessmentSignature } from "@/lib/signature-verify";
import { cn } from "@/lib/utils";

/** How many signatures are fetched at once. Enough to be quick, few enough to stay polite to the API. */
const CONCURRENCY = 4;

function fetchAuditSignature(assessmentKey: string): Promise<SignatureMaterial> {
  return api<AuditSignature>(`/impacts/${encodeURIComponent(assessmentKey)}/audit-signature`);
}

function RowState({ state }: { state: RowVerifyState }) {
  if (state === "verified") return <StatusBadge kind="signature" status="verified" />;
  if (state === "invalid") return <StatusBadge kind="signature" status="invalid" />;
  if (state === "error") return <Badge>Couldn&rsquo;t check</Badge>;
  if (state === "verifying") return <span className="font-mono text-[11px] text-ink-3">Checking</span>;
  return <StatusBadge kind="signature" status="signed" />;
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/**
 * §5. Every current assessment's fingerprint, linked to its public receipt,
 * plus one button that checks every signature in this browser. One seal for
 * the whole event: green only when all of them verify.
 */
export function SignedRecords({
  rows,
  unsignedCount,
  fetchSignature = fetchAuditSignature,
}: {
  rows: SignedRow[];
  /** Current assessments with no fingerprint yet. */
  unsignedCount: number;
  /** Where each row's signature comes from. Defaults to GET /impacts/{key}/audit-signature. */
  fetchSignature?: (assessmentKey: string) => Promise<SignatureMaterial>;
}) {
  const [states, setStates] = useState<Record<string, RowVerifyState>>({});
  const [verifiedAt, setVerifiedAt] = useState<Date | null>(null);
  const [sealShown, setSealShown] = useState(false);
  const runId = useRef(0);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      runId.current += 1;
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, []);

  const rowStates = useMemo(() => rows.map((r) => states[r.assessmentKey] ?? "idle"), [rows, states]);
  const summary = sealSummary(rowStates);

  async function verifyAll() {
    const run = ++runId.current;
    if (timer.current) window.clearTimeout(timer.current);
    setSealShown(false);
    setVerifiedAt(null);
    setStates(Object.fromEntries(rows.map((r) => [r.assessmentKey, "verifying" as const])));

    const results: RowVerifyState[] = [];
    let next = 0;
    async function worker() {
      while (next < rows.length) {
        const row = rows[next++];
        const result = await verifyRow(row, fetchSignature, verifyAssessmentSignature);
        if (run !== runId.current) return;
        results.push(result);
        setStates((prev) => ({ ...prev, [row.assessmentKey]: result }));
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rows.length) }, worker));
    if (run !== runId.current) return;

    if (results.length === rows.length && results.every((r) => r === "verified")) {
      setVerifiedAt(new Date());
      // The seal bar lands on the same beat as the single-receipt sequence.
      const delay = prefersReducedMotion() ? 0 : VERIFY_TIMELINE.sealBarStart;
      timer.current = window.setTimeout(() => setSealShown(true), delay);
    }
  }

  if (rows.length === 0) {
    return (
      <p className="border border-hairline bg-card px-4 py-6 text-[13px] text-ink-2">
        {unsignedCount > 0
          ? `None of the ${unsignedCount} assessments for this change are signed yet.`
          : "No signed records for this change yet."}
      </p>
    );
  }

  const verified = summary.state === "verified" && sealShown;
  const busy = summary.state === "verifying";
  const done = summary.total - summary.pending;

  let message: React.ReactNode;
  if (summary.state === "idle") {
    message = (
      <span className="text-ink-2">
        {rows.length} signed {rows.length === 1 ? "record" : "records"}. Your browser can check each signature against
        Argus&rsquo;s public key.
      </span>
    );
  } else if (busy) {
    message = (
      <span className="text-ink-2">
        Checking signatures, {done} of {summary.total} done
      </span>
    );
  } else if (summary.state === "invalid") {
    message = (
      <span className="inline-flex items-start gap-1.5 text-danger-ink">
        <XCircle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
        {summary.invalid} of {summary.total} {summary.total === 1 ? "signature" : "signatures"} failed verification.
        Contact Argus support before relying on {summary.invalid === 1 ? "that record" : "those records"}.
      </span>
    );
  } else if (summary.state === "incomplete") {
    message = (
      <span className="text-ink-1">
        {summary.verified} of {summary.total} verified. {summary.errored} couldn&rsquo;t be checked, so try again.
      </span>
    );
  } else if (verified) {
    message = (
      <span className="inline-flex items-center gap-1.5 text-seal-ink">
        <CheckCircle2 aria-hidden className="h-3.5 w-3.5" strokeWidth={2} />
        All {summary.total} {summary.total === 1 ? "signature" : "signatures"} verified in your browser
      </span>
    );
  } else {
    message = (
      <span className="text-ink-2">
        Checking signatures, {summary.total} of {summary.total} done
      </span>
    );
  }

  return (
    <div className={cn("relative overflow-hidden border border-hairline bg-card", verified && "ring-1 ring-seal")}>
      <span
        aria-hidden
        className={cn(
          "absolute inset-x-0 top-0 h-[2px] origin-left bg-seal transition-transform duration-[260ms] ease-[cubic-bezier(0.2,0.9,0.3,1)]",
          verified ? "scale-x-100" : "scale-x-0",
        )}
      />

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline px-4 py-3">
        <div className="flex min-w-0 items-start gap-2">
          <Seal className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", verified ? "text-seal" : "text-ink-3")} />
          <p role="status" aria-live="polite" className="text-[13px] leading-snug">
            {message}
          </p>
        </div>
        <button
          type="button"
          onClick={verifyAll}
          disabled={busy}
          className={cn(
            "h-8 shrink-0 rounded-sm px-3 text-[13px] font-medium transition-colors disabled:opacity-60",
            verified
              ? "border border-control bg-surface text-ink-2 hover:text-ink-1"
              : "border border-brand-ink bg-brand text-on-brand hover:bg-brand-hover",
          )}
        >
          {busy
            ? "Verifying"
            : verified && verifiedAt
              ? `Verified locally at ${formatTime(verifiedAt)}`
              : summary.state === "idle"
                ? "Verify all in your browser"
                : "Verify again"}
        </button>
      </div>

      <ul>
        {rows.map((r, i) => (
          <li
            key={r.assessmentKey}
            className={cn(
              "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 border-b border-hairline px-4 py-2.5 last:border-0 sm:grid-cols-[minmax(120px,auto)_minmax(0,1fr)_auto_auto]",
              i % 2 === 1 && "bg-sunk",
            )}
          >
            <ClientChip clientId={r.clientId} className="justify-self-start whitespace-nowrap" />
            <Fingerprint hash={r.canonicalHash} signed chars={16} href={`/verify/${r.canonicalHash}`} className="order-3 col-span-2 sm:order-none sm:col-span-1" />
            <time dateTime={r.signedAt} className="hidden font-mono text-[11px] text-ink-3 tabular sm:block">
              Signed {formatDayMonthYear(r.signedAt)}
            </time>
            <span className="justify-self-end">
              <RowState state={rowStates[i]} />
            </span>
          </li>
        ))}
      </ul>

      {unsignedCount > 0 && (
        <p className="border-t border-hairline px-4 py-2.5 text-[12px] text-ink-2">
          {unsignedCount} {unsignedCount === 1 ? "assessment isn't" : "assessments aren't"} signed yet, so{" "}
          {unsignedCount === 1 ? "it isn't" : "they aren't"} listed here.
        </p>
      )}
    </div>
  );
}
