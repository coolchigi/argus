"use client";

import { use, useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Seal } from "@/components/seal";
import { verifyAssessmentSignature } from "@/lib/signature-verify";
import { VERIFY_TIMELINE, prefersReducedMotion } from "@/lib/motion";
import { CheckCircle2, XCircle, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

type PublicVerify = {
  fingerprint: string;
  topic: string;
  signedAt: string;
  signatureAlgorithm: string;
  canonicalHash: string;
  signatureBase64: string;
  signingKeyId: string;
  publicKeyPem: string;
};

type Stage = "loading" | "loaded" | "verifying" | "sealBar" | "settled" | "invalid" | "notfound" | "error";

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

  return (
    <div
      className={cn(
        "relative min-h-screen bg-canvas transition-colors",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "fixed inset-x-0 top-0 h-[2px] origin-left bg-seal transition-transform duration-[260ms] ease-[cubic-bezier(0.2,0.9,0.3,1)]",
          verifiedGlow ? "scale-x-100" : "scale-x-0",
        )}
      />

      <div className="mx-auto max-w-[560px] px-6 pt-24 pb-16">
        <header className="flex flex-col items-center gap-2 mb-10">
          <Seal className={cn("h-8 w-8 transition-colors", verifiedGlow ? "text-seal" : "text-ink-tertiary")} />
          <h1
            className="text-[20px] font-medium tracking-tight text-ink-primary"
            style={{ fontFamily: "var(--font-newsreader), serif" }}
          >
            argus
          </h1>
        </header>

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
          <div className="space-y-8">
            <div className="text-center">
              <div className="label">Signature receipt</div>
              <div className="mt-2 fingerprint-lg text-ink-primary">
                {formatFingerprint(data.canonicalHash)}
              </div>
            </div>

            <div className="rounded-lg border border-border bg-surface px-8 py-8 space-y-5">
              <ReceiptField label="Topic" value={data.topic} />
              <ReceiptField label="Signed at" value={formatDateTime(data.signedAt)} tabular />
              <ReceiptField label="Algorithm" value={data.signatureAlgorithm} />
              <ReceiptField label="Signing key" value={data.signingKeyId} mono />
              <ReceiptField
                label="Public keys"
                value="argus.ca/.well-known/jwks.json"
                link="/.well-known/jwks.json"
              />
            </div>

            <div className="rounded-lg border border-border bg-surface px-8 py-6">
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
                    consultant who sent you this link before relying on the assessment.
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
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(data.canonicalHash);
                    toast.success("Full hash copied");
                  } catch {
                    toast.error("Couldn't access clipboard");
                  }
                }}
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
          </div>
        )}
      </div>
    </div>
  );
}

function ReceiptField({
  label,
  value,
  mono,
  tabular,
  link,
}: {
  label: string;
  value: string;
  mono?: boolean;
  tabular?: boolean;
  link?: string;
}) {
  const content = mono ? (
    <span className="fingerprint text-ink-primary break-all">{value}</span>
  ) : link ? (
    <a href={link} className="text-[13px] text-ink-primary hover:underline underline-offset-4 decoration-border break-all">
      {value}
    </a>
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

function formatTime(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
