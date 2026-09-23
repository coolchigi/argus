"use client";

import Link from "next/link";
import { use, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { AuditSignature, Impact, ImpactType, Confidence } from "@/lib/argus-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatDelta, formatRelative } from "@/lib/format";
import { ArrowLeft, CheckCircle2, ShieldCheck, XCircle, ExternalLink } from "lucide-react";
import { verifyAssessmentSignature } from "@/lib/signature-verify";

const IMPACT_TYPES: ImpactType[] = [
  "crs-delta",
  "eligibility-flip",
  "deadline-shift",
  "lmia-implication",
  "french-bonus",
  "procedural",
  "none",
];

const CONFIDENCE_LEVELS: Confidence[] = ["low", "medium", "high"];

export default function ImpactDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const assessmentKey = decodeURIComponent(id);
  const impact = useQuery({
    queryKey: ["impact", assessmentKey],
    queryFn: () => api<Impact>(`/impacts/${encodeURIComponent(assessmentKey)}`),
  });

  return (
    <div className="space-y-8">
      <Link
        href="/impacts"
        className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3 w-3" strokeWidth={1.75} /> Back to assessments
      </Link>

      {impact.isLoading ? (
        <div className="py-16 text-center text-[11px] text-muted-foreground">Loading…</div>
      ) : !impact.data ? (
        <div className="py-16 text-center text-[11px] text-destructive">Assessment not found.</div>
      ) : (
        <ImpactBody impact={impact.data} assessmentKey={assessmentKey} />
      )}
    </div>
  );
}

function ImpactBody({ impact, assessmentKey }: { impact: Impact; assessmentKey: string }) {
  return (
    <div className="grid grid-cols-[1fr_320px] gap-8">
      <div className="space-y-6 min-w-0">
        <header className="space-y-1">
          <div className="label">{impact.topic}</div>
          <div className="flex items-baseline gap-3">
            <h1 className="text-xl font-semibold tracking-tight tabular">{impact.clientId}</h1>
            <span className="text-[11px] text-muted-foreground tabular">
              {formatRelative(impact.timestamp)}
            </span>
          </div>
        </header>

        <div className="border border-border bg-card rounded-md p-6">
          <div className="flex items-start justify-between">
            <div>
              <div className="label">Assessment</div>
              <div className="mt-1 text-[13px] text-muted-foreground">{impact.impactType}</div>
            </div>
            <HeroDelta delta={impact.numericDelta} type={impact.impactType} />
          </div>
          <div className="mt-6 border-t border-border pt-4">
            <p className="text-[13px] leading-relaxed">{impact.narrative}</p>
          </div>
          <div className="mt-4 border-t border-border pt-4">
            <div className="label">Recommended action</div>
            <p className="mt-1 text-[13px]">{impact.recommendedAction}</p>
          </div>
          {impact.citationSourceUrl && (
            <div className="mt-4 border-t border-border pt-4">
              <div className="label">Source</div>
              <a
                href={impact.citationSourceUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-flex items-center gap-1 text-[12px] text-foreground hover:underline break-all"
              >
                {impact.citationSourceUrl}
                <ExternalLink className="h-3 w-3 flex-shrink-0 text-muted-foreground" strokeWidth={1.75} />
              </a>
            </div>
          )}
        </div>

        <CorrectionForm assessmentKey={assessmentKey} original={impact} />
      </div>

      <div className="space-y-4">
        <SignaturePanel assessmentKey={assessmentKey} />
        <div className="border border-border bg-card rounded-md p-4">
          <div className="label">Rule hash</div>
          <div className="hash mt-2">{impact.ruleHash}</div>
        </div>
      </div>
    </div>
  );
}

function HeroDelta({ delta, type }: { delta: number | null; type: string }) {
  if (delta === null || type === "none") {
    return (
      <span className="rounded-sm bg-muted px-2 py-1 text-[11px] uppercase tracking-wider text-muted-foreground">
        no delta
      </span>
    );
  }
  const negative = delta < 0;
  return (
    <div className="text-right">
      <div
        className={
          "text-3xl font-semibold tabular tracking-tight " +
          (negative ? "text-destructive" : "text-brand")
        }
      >
        {formatDelta(delta)}
      </div>
    </div>
  );
}

function SignaturePanel({ assessmentKey }: { assessmentKey: string }) {
  const [state, setState] = useState<"idle" | "verifying" | "valid" | "invalid" | "error">("idle");
  const [details, setDetails] = useState<AuditSignature | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function onVerify() {
    setState("verifying");
    setErrorMessage(null);
    try {
      const sig = await api<AuditSignature>(`/impacts/${encodeURIComponent(assessmentKey)}/audit-signature`);
      setDetails(sig);
      const ok = await verifyAssessmentSignature({
        canonicalHashHex: sig.canonicalHash,
        signatureBase64: sig.signatureBase64,
        publicKeyPem: sig.publicKeyPem,
      });
      setState(ok ? "valid" : "invalid");
    } catch (err) {
      setState("error");
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="border border-border bg-card rounded-md p-4">
      <div className="flex items-center gap-1.5">
        <ShieldCheck className="h-3.5 w-3.5 text-brand" strokeWidth={1.75} />
        <span className="label">Audit signature</span>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
        ECDSA P-256 over SHA-256 of the canonicalized payload. Verifiable offline.
      </p>

      {details && (
        <div className="mt-3 space-y-1.5">
          <Row label="Algorithm" value={details.signatureAlgorithm} />
          <Row label="Key" value={details.signingKeyId} mono />
          <Row label="Hash" value={details.canonicalHash} mono />
        </div>
      )}

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={onVerify}
          disabled={state === "verifying"}
          className="h-7 rounded-sm border border-border bg-background px-2.5 text-[11px] font-medium hover:bg-accent disabled:opacity-50"
        >
          {state === "verifying" ? "Verifying…" : state === "valid" ? "Re-verify" : "Verify"}
        </button>
        {state === "valid" && (
          <span className="inline-flex items-center gap-1 text-[11px] text-brand">
            <CheckCircle2 className="h-3 w-3" strokeWidth={2} /> Valid
          </span>
        )}
        {state === "invalid" && (
          <span className="inline-flex items-center gap-1 text-[11px] text-destructive">
            <XCircle className="h-3 w-3" strokeWidth={2} /> Invalid
          </span>
        )}
      </div>
      {state === "error" && <p className="mt-2 text-[11px] text-destructive">{errorMessage}</p>}
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[60px_1fr] gap-2 text-[11px]">
      <span className="text-muted-foreground">{label}</span>
      <span className={mono ? "hash" : ""}>{value}</span>
    </div>
  );
}

function CorrectionForm({ assessmentKey, original }: { assessmentKey: string; original: Impact }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [impactType, setImpactType] = useState<ImpactType>(original.impactType);
  const [numericDelta, setNumericDelta] = useState<string>(original.numericDelta?.toString() ?? "");
  const [narrative, setNarrative] = useState(original.narrative);
  const [action, setAction] = useState(original.recommendedAction);
  const [confidence, setConfidence] = useState<Confidence>(original.confidence);
  const [reasoning, setReasoning] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!reasoning.trim()) {
      toast.error("Consultant reasoning is required so the Auditor can learn from it.");
      return;
    }
    setBusy(true);
    try {
      await api(`/impacts/${encodeURIComponent(assessmentKey)}/correction`, {
        method: "POST",
        body: {
          correctorReasoning: reasoning.trim(),
          correctedImpactType: impactType,
          correctedNumericDelta: numericDelta.trim() === "" ? null : Number(numericDelta),
          correctedNarrative: narrative.trim(),
          correctedRecommendedAction: action.trim(),
          correctedConfidence: confidence,
        },
      });
      toast.success("Correction saved. Auditor will use it as a few-shot next run.");
      qc.invalidateQueries({ queryKey: ["impact", assessmentKey] });
      setOpen(false);
      setReasoning("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "correction-failed");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="border border-border bg-card rounded-md p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="label">Correct this</div>
            <p className="mt-1 text-[12px] text-muted-foreground">
              File a correction and the Auditor learns from your reasoning on the next run.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="h-7 rounded-sm border border-border bg-background px-2.5 text-[11px] font-medium hover:bg-accent"
          >
            File correction
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="border border-border bg-card rounded-md p-6">
      <div className="label">File correction</div>
      <p className="mt-1 text-[12px] text-muted-foreground">
        Explain WHY. The Auditor learns from your reasoning, not just the number.
      </p>

      <form onSubmit={onSubmit} className="mt-5 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="impactType" className="label">Impact type</Label>
            <select
              id="impactType"
              className="w-full h-8 rounded-sm border border-input bg-transparent px-2 text-[12px]"
              value={impactType}
              onChange={(e) => setImpactType(e.target.value as ImpactType)}
            >
              {IMPACT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="delta" className="label">Numeric delta</Label>
            <Input
              id="delta"
              type="number"
              className="h-8 text-[12px]"
              value={numericDelta}
              onChange={(e) => setNumericDelta(e.target.value)}
              placeholder="blank for none"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="reasoning" className="label">Your reasoning (required)</Label>
          <Textarea
            id="reasoning"
            required
            rows={3}
            className="text-[12px]"
            value={reasoning}
            onChange={(e) => setReasoning(e.target.value)}
            placeholder="e.g. IRCC transitional guidance exempts profiles active before March 24 2025."
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="narrative" className="label">Corrected narrative</Label>
          <Textarea
            id="narrative"
            rows={2}
            className="text-[12px]"
            value={narrative}
            onChange={(e) => setNarrative(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-[1fr_120px] gap-3 items-end">
          <div className="space-y-1.5">
            <Label htmlFor="action" className="label">Recommended action</Label>
            <Input id="action" className="h-8 text-[12px]" value={action} onChange={(e) => setAction(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="conf" className="label">Confidence</Label>
            <select
              id="conf"
              className="w-full h-8 rounded-sm border border-input bg-transparent px-2 text-[12px]"
              value={confidence}
              onChange={(e) => setConfidence(e.target.value as Confidence)}
            >
              {CONFIDENCE_LEVELS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={busy}>
            {busy ? "Saving…" : "Save correction"}
          </Button>
        </div>
      </form>
    </div>
  );
}
