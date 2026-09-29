"use client";

import { useState } from "react";
import { XCircle } from "lucide-react";
import { InlineError } from "@/components/argus/inline-error";
import { Seal } from "@/components/seal";
import { buttonSecondary } from "@/components/caseload/copy";
import { markSampleVerified } from "@/components/setup/use-setup-progress";
import { api } from "@/lib/api";
import { SAMPLE_RECEIPT_HASH, verifySampleReceipt, type PublicReceipt } from "@/lib/sample-receipt";
import type { MeResponse } from "@/lib/types/me";
import { ContinueButton, StepFrame } from "./step-frame";

type Check = { state: "idle" | "checking" | "invalid" } | { state: "verified"; at: Date } | { state: "error"; detail: string };

/**
 * Step 4. What a signature is, then a real check: fetch the landing page's
 * sample receipt from the public endpoint and verify it here in the browser.
 * Seal-green shows only after the signature checks out.
 */
export function StepSigning({
  me,
  saving,
  error,
  onBack,
  onFinish,
}: {
  me: MeResponse;
  saving: boolean;
  error: string | null;
  onBack: () => void;
  onFinish: () => void;
}) {
  const [check, setCheck] = useState<Check>({ state: "idle" });

  async function runCheck() {
    setCheck({ state: "checking" });
    try {
      const result = await verifySampleReceipt((hash) => api<PublicReceipt>(`/public/verify/${hash}`, { requireAuth: false }));
      if (result === "verified") {
        // Ticks "Verified a sample receipt" in the setup guide.
        markSampleVerified();
        setCheck({ state: "verified", at: new Date() });
      } else setCheck({ state: "invalid" });
    } catch (err) {
      setCheck({ state: "error", detail: err instanceof Error ? err.message : "load-failed" });
    }
  }

  const keyId = me.signing?.keyId ?? null;

  return (
    <StepFrame
      title="How signing works"
      description="Every assessment Argus writes is signed before you see it. Anyone with the receipt link can check that signature in their browser, with no account."
      error={error}
      onBack={onBack}
      actions={
        <ContinueButton saving={saving} onClick={onFinish}>
          Finish setup
        </ContinueButton>
      }
    >
      <ol className="space-y-3 text-[13px] leading-relaxed text-ink-1">
        <li className="grid grid-cols-[28px_1fr] gap-2">
          <span className="font-mono text-[11px] leading-[1.9] text-ink-3">01</span>
          <span>Argus takes a SHA-256 fingerprint of the finished assessment.</span>
        </li>
        <li className="grid grid-cols-[28px_1fr] gap-2">
          <span className="font-mono text-[11px] leading-[1.9] text-ink-3">02</span>
          <span>
            An AWS KMS key signs that fingerprint with ECDSA P-256
            {keyId ? (
              <>
                {" "}
                (key <span className="font-mono text-ink-2">{keyId.slice(0, 8)}</span>)
              </>
            ) : null}
            . The private half never leaves KMS.
          </span>
        </li>
        <li className="grid grid-cols-[28px_1fr] gap-2">
          <span className="font-mono text-[11px] leading-[1.9] text-ink-3">03</span>
          <span>The receipt link checks that signature against the public key, in the reader&apos;s browser. Change one character of the record and the check fails.</span>
        </li>
      </ol>

      <div className="border border-hairline bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="label">Sample receipt</div>
            <div className="mt-1 fingerprint-lg text-ink-1">
              {SAMPLE_RECEIPT_HASH.slice(0, 4)} {SAMPLE_RECEIPT_HASH.slice(4, 8)} {SAMPLE_RECEIPT_HASH.slice(8, 12)} {SAMPLE_RECEIPT_HASH.slice(12, 16)}
            </div>
            <p className="mt-1 text-[12px] text-ink-2">A signed assessment from the demo practice. No client data in it.</p>
          </div>
          {check.state !== "verified" && (
            <button type="button" className={buttonSecondary} onClick={() => void runCheck()} disabled={check.state === "checking"}>
              {check.state === "checking" ? "Verifying" : check.state === "idle" ? "Verify a sample receipt now" : "Verify again"}
            </button>
          )}
        </div>

        <div aria-live="polite" className="mt-4 empty:mt-0">
          {check.state === "verified" && (
            <p className="flex items-center gap-2 border-l-2 border-seal bg-seal-subtle px-3 py-2 text-[13px] font-medium text-seal-ink">
              <Seal className="h-3.5 w-3.5 text-seal" />
              Signature verified in your browser at {check.at.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}.
            </p>
          )}
          {check.state === "invalid" && (
            <p role="alert" className="flex items-center gap-2 border-l-2 border-danger bg-danger-subtle px-3 py-2 text-[13px] text-danger-ink">
              <XCircle aria-hidden className="h-4 w-4" strokeWidth={2} />
              This signature didn&apos;t check out. Tell us before you rely on any receipt.
            </p>
          )}
          {check.state === "error" && (
            <InlineError message="Couldn't load the sample receipt." detail={check.detail} onRetry={() => void runCheck()} />
          )}
        </div>
      </div>
    </StepFrame>
  );
}
