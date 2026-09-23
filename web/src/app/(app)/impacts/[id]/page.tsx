"use client";

import Link from "next/link";
import { use, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { AuditSignature, Impact, ImpactType, Confidence } from "@/lib/argus-types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { formatDelta, formatRelative } from "@/lib/format";
import { ArrowLeft, CheckCircle2, ShieldCheck, XCircle } from "lucide-react";
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
    <div className="space-y-6">
      <Link
        href="/impacts"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3 w-3" /> Back to impacts
      </Link>

      {impact.isLoading ? (
        <div className="py-16 text-center text-sm text-muted-foreground">Loading assessment...</div>
      ) : !impact.data ? (
        <div className="py-16 text-center text-sm text-destructive">Assessment not found.</div>
      ) : (
        <ImpactBody impact={impact.data} assessmentKey={assessmentKey} />
      )}
    </div>
  );
}

function ImpactBody({ impact, assessmentKey }: { impact: Impact; assessmentKey: string }) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
      <div className="space-y-6 min-w-0">
        <header>
          <div className="flex items-baseline gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{impact.clientId}</h1>
            <span className="text-sm text-muted-foreground">·</span>
            <span className="text-sm text-muted-foreground">{impact.topic}</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground tabular">{formatRelative(impact.timestamp)}</p>
        </header>

        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Assessment</div>
              <div className="mt-1 text-sm font-medium">{impact.impactType}</div>
            </div>
            <DeltaChip delta={impact.numericDelta} type={impact.impactType} />
          </div>
          <Separator className="my-4" />
          <p className="text-sm leading-relaxed">{impact.narrative}</p>
          <div className="mt-4 rounded-md bg-muted/50 p-3">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Recommended action</div>
            <p className="mt-1 text-sm">{impact.recommendedAction}</p>
          </div>
          {impact.citationSourceUrl && (
            <div className="mt-4 text-xs">
              <span className="text-muted-foreground">Source: </span>
              <a
                href={impact.citationSourceUrl}
                target="_blank"
                rel="noreferrer"
                className="text-primary underline underline-offset-2"
              >
                {impact.citationSourceUrl}
              </a>
            </div>
          )}
        </Card>

        <CorrectionForm assessmentKey={assessmentKey} original={impact} />
      </div>

      <div className="space-y-6">
        <SignaturePanel assessmentKey={assessmentKey} />
        <Card className="p-4">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Rule hash</div>
          <div className="hash mt-1">{impact.ruleHash}</div>
        </Card>
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
    <Card className="p-5">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">Audit signature</h3>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        ECDSA P-256 over SHA-256 of the canonicalized assessment. Verifiable offline against the KMS public key.
      </p>

      {details && (
        <div className="mt-4 space-y-2 text-xs">
          <Row label="Algorithm" value={details.signatureAlgorithm} />
          <Row label="Signing key" value={details.signingKeyId} mono />
          <Row label="Canonical hash" value={details.canonicalHash} mono truncate />
        </div>
      )}

      <div className="mt-4 flex items-center gap-2">
        <Button size="sm" variant={state === "valid" ? "secondary" : "default"} onClick={onVerify} disabled={state === "verifying"}>
          {state === "verifying" ? "Verifying..." : state === "valid" ? "Verified" : "Verify signature"}
        </Button>
        {state === "valid" && (
          <span className="inline-flex items-center gap-1 text-xs text-primary">
            <CheckCircle2 className="h-3.5 w-3.5" /> Valid
          </span>
        )}
        {state === "invalid" && (
          <span className="inline-flex items-center gap-1 text-xs text-destructive">
            <XCircle className="h-3.5 w-3.5" /> Invalid
          </span>
        )}
      </div>
      {state === "error" && (
        <p className="mt-2 text-xs text-destructive">{errorMessage}</p>
      )}
    </Card>
  );
}

function Row({ label, value, mono, truncate }: { label: string; value: string; mono?: boolean; truncate?: boolean }) {
  return (
    <div className="grid grid-cols-[100px_1fr] gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={(mono ? "hash " : "") + (truncate ? "truncate" : "")}>{value}</span>
    </div>
  );
}

function DeltaChip({ delta, type }: { delta: number | null; type: string }) {
  if (delta === null || type === "none") {
    return <span className="text-xs text-muted-foreground">no numeric delta</span>;
  }
  const negative = delta < 0;
  return (
    <span
      className={
        "rounded-md px-3 py-1 text-lg tabular font-semibold " +
        (negative ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary")
      }
    >
      {formatDelta(delta)}
    </span>
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
      toast.success("Correction saved. Auditor will use it as a few-shot on the next run.");
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
      <Card className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold">This assessment is wrong?</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              File a correction. Future assessments in the same domain will apply your reasoning.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
            Correct this
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-5">
      <h3 className="text-sm font-semibold">Correct this assessment</h3>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Explain WHY. The Auditor learns from your reasoning, not just the corrected number.
      </p>

      <form onSubmit={onSubmit} className="mt-4 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="impactType" className="text-xs">Impact type</Label>
            <select
              id="impactType"
              className="w-full h-9 rounded-md border border-input bg-transparent px-3 text-sm"
              value={impactType}
              onChange={(e) => setImpactType(e.target.value as ImpactType)}
            >
              {IMPACT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="delta" className="text-xs">Numeric delta (leave blank for none)</Label>
            <Input
              id="delta"
              type="number"
              value={numericDelta}
              onChange={(e) => setNumericDelta(e.target.value)}
              placeholder="e.g. -50"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="reasoning" className="text-xs">Your reasoning (required)</Label>
          <Textarea
            id="reasoning"
            required
            rows={3}
            value={reasoning}
            onChange={(e) => setReasoning(e.target.value)}
            placeholder="e.g. IRCC transitional guidance exempts profiles active before March 24 2025 for 90 days."
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="narrative" className="text-xs">Corrected narrative</Label>
          <Textarea
            id="narrative"
            rows={2}
            value={narrative}
            onChange={(e) => setNarrative(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-[1fr_auto] gap-3 items-end">
          <div className="space-y-1.5">
            <Label htmlFor="action" className="text-xs">Recommended action</Label>
            <Input id="action" value={action} onChange={(e) => setAction(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="conf" className="text-xs">Confidence</Label>
            <select
              id="conf"
              className="w-24 h-9 rounded-md border border-input bg-transparent px-3 text-sm"
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
            {busy ? "Saving..." : "Save correction"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
