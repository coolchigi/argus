"use client";

import { useState } from "react";
import { CheckCircle2, ChevronDown, ChevronRight, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Seal } from "@/components/seal";
import { api } from "@/lib/api";
import type { AuditSignature } from "@/lib/argus-types";
import { verifyAssessmentSignature } from "@/lib/signature-verify";
import { cn } from "@/lib/utils";

type Props = {
  assessmentKey: string;
  fingerprintPreview?: string;
  signedAt: string;
};

type State =
  | { kind: "idle" }
  | { kind: "verifying" }
  | { kind: "verified"; at: Date; sig: AuditSignature }
  | { kind: "invalid"; sig: AuditSignature; message: string }
  | { kind: "error"; message: string };

/**
 * The Argus signature receipt. Section 8b of the design brief.
 * Plain-English state on the primary surface. Crypto details behind
 * a Signature details disclosure. WebCrypto verifies against the
 * exported KMS public key with no server round-trip.
 */
export function SignatureReceipt({ assessmentKey, fingerprintPreview, signedAt }: Props) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [verifiedFlash, setVerifiedFlash] = useState(false);

  async function onVerify() {
    setState({ kind: "verifying" });
    try {
      const sig = await api<AuditSignature>(
        `/impacts/${encodeURIComponent(assessmentKey)}/audit-signature`,
      );
      const ok = await verifyAssessmentSignature({
        canonicalHashHex: sig.canonicalHash,
        signatureBase64: sig.signatureBase64,
        publicKeyPem: sig.publicKeyPem,
      });
      if (ok) {
        setState({ kind: "verified", at: new Date(), sig });
        setVerifiedFlash(true);
        setTimeout(() => setVerifiedFlash(false), 1200);
      } else {
        setState({
          kind: "invalid",
          sig,
          message:
            "This signature couldn't be verified. Something is wrong here. Please contact Argus support before relying on this assessment.",
        });
      }
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : "verification-failed",
      });
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

  const verified = state.kind === "verified";
  const invalid = state.kind === "invalid";
  const sig = state.kind === "verified" || state.kind === "invalid" ? state.sig : null;
  const shownFingerprint = sig?.canonicalHash
    ? formatFingerprint(sig.canonicalHash)
    : fingerprintPreview
      ? formatFingerprint(fingerprintPreview)
      : "";

  return (
    <div
      className={cn(
        "relative rounded-lg border border-border bg-surface overflow-hidden",
        verified && "ring-1 ring-seal-ring",
      )}
    >
      {/* Seal-bar sweep on success. Section 8d motion. */}
      {verifiedFlash && (
        <span className="absolute inset-x-0 top-0 h-[2px] bg-seal animate-[sealsweep_260ms_ease-out]" />
      )}

      <div className="px-6 pt-6 pb-4">
        <div className="flex items-center gap-2">
          <Seal className={cn("h-3.5 w-3.5", verified ? "text-seal" : invalid ? "text-red" : "text-ink-tertiary")} />
          <span className="label text-ink-primary">
            {verified ? "Signature verified" : invalid ? "Signature invalid" : "Signature receipt"}
          </span>
        </div>

        <div className="mt-6 space-y-4">
          <ReceiptRow label="Status">
            {verified ? (
              <span className="inline-flex items-center gap-1.5 text-seal">
                <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2} />
                <span className="text-[13px] font-medium">Signed, verified in your browser</span>
              </span>
            ) : invalid ? (
              <span className="inline-flex items-center gap-1.5 text-red">
                <XCircle className="h-3.5 w-3.5" strokeWidth={2} />
                <span className="text-[13px] font-medium">Verification failed</span>
              </span>
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
                className="fingerprint-lg text-left hover:text-ink-primary transition-colors"
                title="Copy full hash"
              >
                {shownFingerprint}
              </button>
            </ReceiptRow>
          )}
        </div>

        {invalid && (
          <p className="mt-4 text-[12px] leading-relaxed text-red">{state.message}</p>
        )}
        {state.kind === "error" && (
          <p className="mt-4 text-[12px] leading-relaxed text-red">
            Couldn&rsquo;t reach the signature service. Try again in a moment.
          </p>
        )}
      </div>

      <div className="border-t border-border px-6 py-4">
        <button
          type="button"
          onClick={onVerify}
          disabled={state.kind === "verifying"}
          className={cn(
            "w-full h-9 rounded-sm text-[13px] font-medium transition-colors",
            verified
              ? "border border-border bg-surface text-ink-secondary hover:text-ink-primary"
              : "bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50",
          )}
        >
          {state.kind === "verifying"
            ? "Verifying"
            : verified
              ? `Re-verify (last checked ${formatTime(state.at)})`
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
            {state.kind === "invalid" && (
              <TechRow label="Raw" value={state.message} wrap />
            )}
            {state.kind === "error" && (
              <TechRow label="Error" value={state.message} wrap />
            )}
          </div>
        )}
      </div>

      <style>{`
        @keyframes sealsweep {
          from { transform: scaleX(0); transform-origin: left; }
          to { transform: scaleX(1); transform-origin: left; }
        }
      `}</style>
    </div>
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
