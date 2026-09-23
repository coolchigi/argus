"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronRight, Copy, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Seal } from "@/components/seal";
import { api } from "@/lib/api";
import type { AuditSignature } from "@/lib/argus-types";
import { verifyAssessmentSignature } from "@/lib/signature-verify";
import { VERIFY_TIMELINE, prefersReducedMotion } from "@/lib/motion";
import { cn } from "@/lib/utils";

type Props = {
  assessmentKey: string;
  fingerprintPreview?: string;
  signedAt: string;
  /**
   * When true, the receipt fetches and verifies on mount instead of waiting
   * for a click. Used on the public /verify page and the marketing hero.
   */
  autoVerify?: boolean;
  /** Called with the fetched signature material once loaded. */
  onLoaded?: (sig: AuditSignature) => void;
};

type Stage =
  | "idle"
  | "verifying"
  | "sealBar"
  | "headerFlip"
  | "buttonFlip"
  | "fingerprintUnderline"
  | "settled"
  | "invalid"
  | "error";

type LoadedState = {
  sig: AuditSignature | null;
  verifiedAt: Date | null;
  message: string | null;
};

const REDUCED_STAGE_TIMING = {
  sealBar: 60,
  headerFlip: 120,
  buttonFlip: 180,
  underline: 240,
  settled: 300,
};

/**
 * Signature receipt. Section 8b + 3a of the design brief.
 *
 * Plain-English primary state, crypto details behind a disclosure. On verify,
 * runs the choreographed 1160ms sequence per PERFORMATIVE.md Section 3a
 * (bar sweep, header cross-fade with 60ms follow-through, button transition
 * at 140ms overlap-lag, fingerprint underline sweep at 960ms).
 */
export function SignatureReceipt({
  assessmentKey,
  fingerprintPreview,
  signedAt,
  autoVerify = false,
  onLoaded,
}: Props) {
  const [stage, setStage] = useState<Stage>("idle");
  const [loaded, setLoaded] = useState<LoadedState>({ sig: null, verifiedAt: null, message: null });
  const [detailsOpen, setDetailsOpen] = useState(false);
  const timers = useRef<number[]>([]);
  const autoStarted = useRef(false);

  useEffect(() => {
    return () => {
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [];
    };
  }, []);

  useEffect(() => {
    if (autoVerify && !autoStarted.current) {
      autoStarted.current = true;
      void onVerify();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoVerify]);

  function schedule(fn: () => void, delay: number) {
    const id = window.setTimeout(fn, delay);
    timers.current.push(id);
  }

  async function onVerify() {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    setStage("verifying");
    try {
      const sig = await api<AuditSignature>(
        `/impacts/${encodeURIComponent(assessmentKey)}/audit-signature`,
      );
      onLoaded?.(sig);
      const ok = await verifyAssessmentSignature({
        canonicalHashHex: sig.canonicalHash,
        signatureBase64: sig.signatureBase64,
        publicKeyPem: sig.publicKeyPem,
      });
      if (!ok) {
        setLoaded({
          sig,
          verifiedAt: null,
          message:
            "This signature couldn't be verified. Something is wrong here. Please contact Argus support before relying on this assessment.",
        });
        setStage("invalid");
        return;
      }

      const now = new Date();
      setLoaded({ sig, verifiedAt: now, message: null });

      const t = prefersReducedMotion() ? REDUCED_STAGE_TIMING : {
        sealBar: VERIFY_TIMELINE.sealBarStart,
        headerFlip: VERIFY_TIMELINE.headerRewriteStart,
        buttonFlip: VERIFY_TIMELINE.buttonRewriteStart,
        underline: VERIFY_TIMELINE.fingerprintUnderlineStart,
        settled: VERIFY_TIMELINE.totalDuration,
      };
      schedule(() => setStage("sealBar"), t.sealBar);
      schedule(() => setStage("headerFlip"), t.headerFlip);
      schedule(() => setStage("buttonFlip"), t.buttonFlip);
      schedule(() => setStage("fingerprintUnderline"), t.underline);
      schedule(() => setStage("settled"), t.settled);
    } catch (err) {
      setLoaded({
        sig: null,
        verifiedAt: null,
        message: err instanceof Error ? err.message : "verification-failed",
      });
      setStage("error");
    }
  }

  async function copyFingerprint(fp: string) {
    try {
      await navigator.clipboard.writeText(fp);
      toast.success("Fingerprint copied");
    } catch {
      toast.error("Couldn't access clipboard");
    }
  }

  const isVerified = stage === "settled" || stage === "fingerprintUnderline" || stage === "buttonFlip" || stage === "headerFlip" || stage === "sealBar";
  const isInvalid = stage === "invalid";
  const isError = stage === "error";
  const isVerifying = stage === "verifying";
  const showHeaderVerified = stage === "headerFlip" || stage === "buttonFlip" || stage === "fingerprintUnderline" || stage === "settled";
  const showButtonVerified = stage === "buttonFlip" || stage === "fingerprintUnderline" || stage === "settled";
  const showUnderline = stage === "fingerprintUnderline" || stage === "settled";
  const showBarSweep = stage === "sealBar" || stage === "headerFlip" || stage === "buttonFlip" || stage === "fingerprintUnderline" || stage === "settled";
  const sig = loaded.sig;

  const shownFingerprint = sig?.canonicalHash
    ? formatFingerprint(sig.canonicalHash)
    : fingerprintPreview
      ? formatFingerprint(fingerprintPreview)
      : "";

  return (
    <div
      className={cn(
        "relative rounded-lg border border-border bg-surface overflow-hidden transition-shadow",
        isVerified && "ring-1 ring-seal-ring",
      )}
    >
      {/* Seal bar sweep. Persists after the moment as a 2px accent on top of the card. */}
      <span
        aria-hidden
        className={cn(
          "absolute inset-x-0 top-0 h-[2px] origin-left bg-seal transition-transform duration-[260ms] ease-[cubic-bezier(0.2,0.9,0.3,1)]",
          showBarSweep ? "scale-x-100" : "scale-x-0",
        )}
      />

      <div className="px-6 pt-6 pb-4">
        <div className="flex items-center gap-2 h-4">
          <Seal
            className={cn(
              "h-3.5 w-3.5 transition-colors duration-[140ms]",
              showHeaderVerified ? "text-seal" : isInvalid ? "text-red" : "text-ink-tertiary",
            )}
          />
          <span
            className={cn(
              "label transition-opacity duration-[140ms]",
              showHeaderVerified ? "text-seal" : isInvalid ? "text-red" : "text-ink-secondary",
            )}
          >
            {showHeaderVerified ? "Signature verified" : isInvalid ? "Signature invalid" : "Signature receipt"}
          </span>
        </div>

        <div className="mt-6 space-y-4">
          <ReceiptRow label="Status">
            {showHeaderVerified ? (
              <span className="inline-flex items-center gap-1.5 text-seal">
                <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2} />
                <span className="text-[13px] font-medium">Signed, verified in your browser</span>
              </span>
            ) : isInvalid ? (
              <span className="inline-flex items-center gap-1.5 text-red">
                <XCircle className="h-3.5 w-3.5" strokeWidth={2} />
                <span className="text-[13px] font-medium">Verification failed</span>
              </span>
            ) : isVerifying ? (
              <VerifyingCaret />
            ) : (
              <span className="text-[13px] text-ink-primary">Signed by Argus</span>
            )}
          </ReceiptRow>

          <ReceiptRow label="Signed at">
            <span className="text-[13px] text-ink-primary tabular">{formatDateTime(signedAt)}</span>
          </ReceiptRow>

          {shownFingerprint && (
            <ReceiptRow label="Fingerprint">
              <button
                type="button"
                onClick={() => copyFingerprint(sig?.canonicalHash ?? fingerprintPreview ?? "")}
                className="group relative text-left"
                title="Copy full hash"
              >
                <span className="fingerprint-lg text-ink-primary">{shownFingerprint}</span>
                <span
                  aria-hidden
                  className={cn(
                    "absolute -bottom-0.5 left-0 h-px origin-left bg-seal transition-transform duration-[200ms] ease-[cubic-bezier(0.2,0.9,0.3,1)]",
                    showUnderline ? "scale-x-100" : "scale-x-0",
                  )}
                  style={{ width: "100%" }}
                />
                <Copy className="ml-2 inline-block h-3 w-3 text-ink-tertiary opacity-0 transition-opacity group-hover:opacity-100" strokeWidth={1.5} />
              </button>
            </ReceiptRow>
          )}
        </div>

        {isInvalid && loaded.message && (
          <p className="mt-4 text-[12px] leading-relaxed text-red">{loaded.message}</p>
        )}
        {isError && (
          <p className="mt-4 text-[12px] leading-relaxed text-red">
            Couldn&rsquo;t reach the signature service. Try again in a moment.
          </p>
        )}
      </div>

      <div className="border-t border-border px-6 py-4">
        <button
          type="button"
          onClick={onVerify}
          disabled={isVerifying}
          className={cn(
            "w-full h-9 rounded-sm text-[13px] font-medium transition-all duration-[120ms]",
            showButtonVerified
              ? "border border-border bg-surface text-ink-secondary hover:text-ink-primary"
              : "bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50",
          )}
        >
          {isVerifying
            ? "Verifying"
            : showButtonVerified && loaded.verifiedAt
              ? `Verified locally at ${formatTime(loaded.verifiedAt)}`
              : "Verify in your browser"}
        </button>
      </div>

      <div className="border-t border-border">
        <button
          type="button"
          onClick={() => setDetailsOpen((v) => !v)}
          className="w-full flex items-center justify-between px-6 py-3 text-[12px] text-ink-secondary hover:text-ink-primary transition-colors"
        >
          <span>Signature details</span>
          {detailsOpen ? (
            <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.75} />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.75} />
          )}
        </button>
        {detailsOpen && (
          <div className="px-6 pb-5 space-y-3 border-t border-border pt-4">
            <TechRow label="Algorithm" value={sig?.signatureAlgorithm ?? "ECDSA_SHA_256"} />
            <TechRow label="Curve" value={sig?.verification?.curve ?? "P-256"} />
            <TechRow label="Key id" value={sig?.signingKeyId ?? "loaded on verify"} mono />
            <TechRow label="Full hash" value={sig?.canonicalHash ?? "loaded on verify"} mono wrap />
            <TechRow
              label="Public key"
              value={sig?.publicKeyPem ? "PEM available in this session" : "loaded on verify"}
            />
            {isInvalid && loaded.message && <TechRow label="Raw" value={loaded.message} wrap />}
            {isError && loaded.message && <TechRow label="Error" value={loaded.message} wrap />}
          </div>
        )}
      </div>
    </div>
  );
}

function VerifyingCaret() {
  const [dots, setDots] = useState(1);
  useEffect(() => {
    const id = window.setInterval(() => setDots((d) => (d % 3) + 1), 200);
    return () => window.clearInterval(id);
  }, []);
  return (
    <span className="inline-flex items-center gap-1.5 text-ink-secondary">
      <span className="text-[13px] font-medium">Verifying</span>
      <span className="fingerprint text-ink-tertiary w-4 inline-block">
        {".".repeat(dots)}
      </span>
    </span>
  );
}

function ReceiptRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[100px_1fr] gap-4 items-baseline">
      <span className="label">{label}</span>
      <div>{children}</div>
    </div>
  );
}

function TechRow({
  label,
  value,
  mono,
  wrap,
}: {
  label: string;
  value: string;
  mono?: boolean;
  wrap?: boolean;
}) {
  return (
    <div className="grid grid-cols-[80px_1fr] gap-3 items-baseline">
      <span className="label">{label}</span>
      <span
        className={cn(
          "text-[12px]",
          mono ? "fingerprint" : "text-ink-primary",
          wrap ? "break-all" : "truncate",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function formatFingerprint(hex: string): string {
  const clean = hex.slice(0, 24);
  const groups: string[] = [];
  for (let i = 0; i < clean.length; i += 4) groups.push(clean.slice(i, i + 4));
  return groups.join(" ");
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
