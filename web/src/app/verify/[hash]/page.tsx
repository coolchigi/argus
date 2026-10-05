"use client";

import { use, useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { env } from "@/lib/env";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { verifyAssessmentSignature } from "@/lib/signature-verify";
import { markSampleVerified } from "@/components/setup/use-setup-progress";
import { VERIFY_TIMELINE, prefersReducedMotion } from "@/lib/motion";
import { CheckCircle2, XCircle, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { humanizeSignatureAlgorithm, humanizeTopic } from "@/lib/humanize";
import { checkItYourselfSnippet } from "@/lib/receipt-snippet";
import { JWKS_PATH } from "@/lib/sample-receipt";
import { receiptRecord, type PublicVerify, type ReceiptRecord } from "@/lib/types/public";

type Stage = "loading" | "loaded" | "verifying" | "sealBar" | "settled" | "invalid" | "notfound" | "error";

const KIND_COPY: Record<ReceiptRecord, { title: string; label: string; noun: string; covers: string }> = {
  assessment: {
    title: "Assessment receipt",
    label: "Assessment",
    noun: "assessment",
    covers:
      "The fingerprint is a SHA-256 hash of the full signed assessment: the IRCC rule it cites, the finding, the recommended action and the time it was signed.",
  },
  "consultant-review": {
    title: "Consultant review receipt",
    label: "Consultant review",
    noun: "review",
    covers:
      "The fingerprint is a SHA-256 hash of the consultant's signed review: their verdict and reasoning, the IRCC rule it cites, the fingerprint of the assessment it replaces and the time it was signed.",
  },
  brief: {
    title: "Brief receipt",
    label: "Sent brief",
    noun: "brief",
    covers:
      "The fingerprint is a SHA-256 hash of the brief exactly as it was sent: subject, body, suggested actions, a hash of the recipient address, the sender and the send time.",
  },
};

export default function PublicVerifyPage({ params }: { params: Promise<{ hash: string }> }) {
  const { hash } = use(params);
  const [stage, setStage] = useState<Stage>("loading");
  const [data, setData] = useState<PublicVerify | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [verifiedAt, setVerifiedAt] = useState<Date | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await api<PublicVerify>(`/public/verify/${hash}`, { requireAuth: false });
        setData(res);
        setStage("loaded");
      } catch (err) {
        const status = (err as { status?: number }).status;
        if (status === 404) setStage("notfound");
        else {
          setErrorMessage(err instanceof Error ? err.message : "load-failed");
          setStage("error");
        }
      }
    })();
  }, [hash]);

  async function onVerify() {
    if (!data) return;
    setStage("verifying");
    try {
      const ok = await verifyAssessmentSignature({
        canonicalHashHex: data.canonicalHash,
        signatureBase64: data.signatureBase64,
        publicKeyPem: data.publicKeyPem,
      });
      if (!ok) {
        setStage("invalid");
        return;
      }
      // Ticks "Verified a sample receipt" in the setup guide.
      markSampleVerified();
      const t = prefersReducedMotion() ? { sealBar: 60, settled: 300 } : {
        sealBar: VERIFY_TIMELINE.sealBarStart,
        settled: VERIFY_TIMELINE.totalDuration,
      };
      window.setTimeout(() => setStage("sealBar"), t.sealBar);
      window.setTimeout(() => {
        setStage("settled");
        setVerifiedAt(new Date());
      }, t.settled);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "verify-failed");
      setStage("error");
    }
  }

  const verifiedGlow = stage === "sealBar" || stage === "settled";
  const copy = KIND_COPY[data ? receiptRecord(data) : "assessment"];

  return (
    <div className="relative min-h-screen flex flex-col bg-canvas">
      <span
        aria-hidden
        data-print="hide"
        className={cn(
          "fixed inset-x-0 top-0 h-[2px] origin-left bg-seal transition-transform duration-[260ms] ease-[cubic-bezier(0.2,0.9,0.3,1)]",
          verifiedGlow ? "scale-x-100" : "scale-x-0",
        )}
      />
      <SiteHeader />

      <main id="main" className="flex-1 mx-auto w-full max-w-[560px] px-4 pt-16 pb-16 sm:px-6 print:pt-0">
        {stage === "loading" && (
          <div className="py-16 text-center label">Loading receipt</div>
        )}

        {stage === "notfound" && (
          <div className="rounded-lg border border-border bg-surface px-8 py-12 text-center">
            <div className="label">Not found</div>
            <p className="mt-4 text-[14px] text-ink-primary">
              No receipt matches this fingerprint.
            </p>
            <p className="mt-2 text-[13px] text-ink-secondary">
              Check the URL, or ask the consultant who sent you the link to resend it.
            </p>
          </div>
        )}

        {stage === "error" && (
          <div className="rounded-lg border border-border bg-surface px-8 py-12 text-center">
            <div className="label text-red">Error</div>
            <p className="mt-4 text-[13px] text-ink-primary">
              Couldn&rsquo;t load the receipt. Try again in a moment.
            </p>
            {errorMessage && <p className="mt-2 text-[11px] fingerprint">{errorMessage}</p>}
          </div>
        )}

        {data && stage !== "loading" && stage !== "notfound" && (
          <div className="space-y-8" data-tour="verify-result">
            <div className="text-center">
              <h1 className="label">{stage === "settled" ? `${copy.title}, verified` : copy.title}</h1>
              <div className="mt-2 fingerprint-lg text-ink-primary">
                {formatFingerprint(data.canonicalHash)}
              </div>
              <p className="mt-3 text-[13px] text-ink-secondary">
                {stage === "settled"
                  ? `Signed on ${formatDate(data.signedAt)}. Unchanged since.`
                  : `Signed on ${formatDate(data.signedAt)}.`}
              </p>
              {data.consultant && (
                <p className="mt-1 text-[13px] text-ink-primary">
                  Signed for {data.consultant.displayName}, RCIC {data.consultant.rcicLicense}
                </p>
              )}
            </div>

            <div className="rounded-lg border border-border bg-surface px-5 py-6 space-y-5 sm:px-8 sm:py-8">
              <ReceiptField label="Record" value={copy.label} />
              {data.topic && <ReceiptField label="Topic" value={humanizeTopic(data.topic)} />}
              <ReceiptField label="Signed at" value={formatDateTime(data.signedAt)} tabular />
              <ReceiptField label="Algorithm" value={humanizeSignatureAlgorithm(data.signatureAlgorithm)} />
              <ReceiptField label="Signing key" value={`Key ID ${data.signingKeyId}`} mono />
              <div className="grid grid-cols-[120px_1fr] gap-4 items-baseline">
                <span className="label">Public key</span>
                <a
                  href={JWKS_PATH}
                  className="fingerprint text-ink-primary break-all underline underline-offset-4 decoration-hairline hover:decoration-ink-3"
                >
                  {JWKS_PATH}
                </a>
              </div>
            </div>

            {/* A printout keeps the result once there is one, and drops a bare button. */}
            <div
              className="rounded-lg border border-border bg-surface px-5 py-6 sm:px-8"
              data-print={stage === "settled" || stage === "invalid" ? undefined : "hide"}
            >
              {stage === "settled" && verifiedAt ? (
                <div className="flex items-center gap-2 justify-center py-2">
                  <CheckCircle2 className="h-4 w-4 text-seal" strokeWidth={2} />
                  <span className="text-[14px] font-medium text-seal">
                    Verified locally at {formatTime(verifiedAt)}
                  </span>
                </div>
              ) : stage === "invalid" ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 justify-center">
                    <XCircle className="h-4 w-4 text-red" strokeWidth={2} />
                    <span className="text-[14px] font-medium text-red">Signature invalid</span>
                  </div>
                  <p className="text-[12px] leading-relaxed text-red text-center">
                    This signature couldn&rsquo;t be verified. Something is wrong here. Please contact the
                    consultant who sent you this link before relying on the {copy.noun}.
                  </p>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={onVerify}
                  disabled={stage === "verifying" || stage === "sealBar"}
                  className="w-full h-11 rounded-sm bg-primary text-primary-foreground text-[13px] font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  {stage === "verifying" || stage === "sealBar" ? "Verifying" : "Verify in your browser"}
                </button>
              )}
            </div>

            <div className="text-center space-y-3">
              <button
                type="button"
                data-print="hide"
                onClick={() => copyText(data.canonicalHash, "Full hash copied")}
                className="inline-flex items-center gap-1.5 text-[11px] text-ink-tertiary hover:text-ink-primary"
              >
                <Copy className="h-3 w-3" strokeWidth={1.5} />
                Copy full hash
              </button>
              <p className="text-[11px] leading-relaxed text-ink-tertiary max-w-[400px] mx-auto">
                Argus never stores client personal information. Client identity in this receipt is an opaque
                reference chosen by the consultant.
              </p>
            </div>

            <BelowTheFold data={data} covers={copy.covers} />
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}

function BelowTheFold({ data, covers }: { data: PublicVerify; covers: string }) {
  const jwksUrl = typeof window === "undefined" ? JWKS_PATH : `${window.location.origin}${JWKS_PATH}`;
  const snippet = checkItYourselfSnippet({ apiUrl: env.apiUrl, jwksUrl, hash: data.canonicalHash });
  return (
    <div className="space-y-8 border-t border-hairline pt-8 text-[13px] leading-relaxed text-ink-secondary">
      <section aria-labelledby="how-heading" className="space-y-3">
        <h2 id="how-heading" className="font-display text-[20px] leading-tight text-ink-primary">
          How verification works
        </h2>
        <p>
          When Argus signs a record, it hashes the record with SHA-256 and asks AWS KMS to sign that hash with an
          ECDSA P-256 key. The private half of the key never leaves KMS. {covers} Change one character and the
          fingerprint changes, and no Argus signature matches it.
        </p>
        <p>
          Verify in your browser checks that the public key is the one Argus signs with, then checks the signature
          over the fingerprint. It runs on your device. Argus publishes the key at{" "}
          <a href={JWKS_PATH} className="font-mono text-ink-primary underline underline-offset-4 decoration-hairline">
            {JWKS_PATH}
          </a>{" "}
          so you can check it without this page.
        </p>
      </section>

      <section aria-labelledby="retention-heading" className="space-y-3">
        <h2 id="retention-heading" className="font-display text-[20px] leading-tight text-ink-primary">
          Why this receipt stays up
        </h2>
        <p>
          The CICC Client File Management Regulation (s. 7.2) has licensed consultants keep client file records
          for 6 years after a file closes. Argus keeps signed records with no expiry by default, and the consultant
          can export them at any time. See the{" "}
          <a href="https://college-ic.ca/" className="text-ink-primary underline underline-offset-4 decoration-hairline" rel="noreferrer" target="_blank">
            College of Immigration and Citizenship Consultants
          </a>
          .
        </p>
      </section>

      <details className="group rounded-lg border border-border bg-surface" data-print="hide">
        <summary className="cursor-pointer select-none px-5 py-3 text-[13px] font-medium text-ink-primary">
          Check it yourself
        </summary>
        <div className="space-y-3 border-t border-hairline px-5 py-4">
          <p>
            This script fetches the receipt and the published key, then checks the signature outside Argus. KMS
            signed the 32-byte SHA-256 digest itself, so the check runs on the digest as is (prehash off). Tools
            that hash their input first, like WebCrypto&rsquo;s ECDSA verify, will report every Argus signature as
            invalid.
          </p>
          <pre className="max-h-[360px] overflow-auto rounded-sm bg-sunk p-3 font-mono text-[11px] leading-relaxed text-ink-primary">
            <code>{snippet}</code>
          </pre>
          <button
            type="button"
            onClick={() => copyText(snippet, "Script copied")}
            className="inline-flex items-center gap-1.5 text-[12px] text-ink-secondary hover:text-ink-primary"
          >
            <Copy className="h-3 w-3" strokeWidth={1.5} />
            Copy script
          </button>
        </div>
      </details>
    </div>
  );
}

async function copyText(text: string, done: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(done);
  } catch {
    toast.error("Couldn't access clipboard");
  }
}

function ReceiptField({
  label,
  value,
  mono,
  tabular,
}: {
  label: string;
  value: string;
  mono?: boolean;
  tabular?: boolean;
}) {
  const content = mono ? (
    <span className="fingerprint text-ink-primary break-all">{value}</span>
  ) : (
    <span className={cn("text-[13px] text-ink-primary", tabular && "tabular")}>{value}</span>
  );
  return (
    <div className="grid grid-cols-[120px_1fr] gap-4 items-baseline">
      <span className="label">{label}</span>
      <div>{content}</div>
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

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
