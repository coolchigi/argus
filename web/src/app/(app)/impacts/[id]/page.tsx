"use client";

import Link from "next/link";
import { use, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { Impact, ImpactType, Confidence } from "@/lib/argus-types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SignatureReceipt } from "@/components/signature-receipt";
import { AgentLineage } from "@/components/agent-lineage";
import { CitationChips } from "@/components/citation-chips";
import { formatDelta, formatRelative } from "@/lib/format";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

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
        className="inline-flex items-center gap-1 text-[12px] text-ink-secondary hover:text-ink-primary"
      >
        <ArrowLeft className="h-3 w-3" strokeWidth={1.75} />
        Back to assessments
      </Link>

      {impact.isLoading ? (
        <div className="py-16 text-center label">Loading</div>
      ) : !impact.data ? (
        <div className="py-16 text-center text-[13px] text-red">Assessment not found.</div>
      ) : (
        <ImpactBody impact={impact.data} assessmentKey={assessmentKey} />
      )}
    </div>
  );
}

function ImpactBody({ impact, assessmentKey }: { impact: Impact; assessmentKey: string }) {
  return (
    <div className="grid grid-cols-[1fr_320px] gap-10">
      <div className="space-y-8 min-w-0">
        <header className="space-y-2">
          <div className="label">{impact.topic}</div>
          <h1
            className="text-[32px] font-medium tracking-tight text-ink-primary leading-tight"
            style={{ fontFamily: "var(--font-newsreader), serif" }}
          >
            Impact on <span className="client-chip text-[26px] px-3 py-1 align-middle">{impact.clientId}</span>
          </h1>
          <p className="text-[13px] text-ink-secondary tabular">{formatRelative(impact.timestamp)}</p>
        </header>

        <AgentLineage />

        <section className="rounded-md border border-border bg-surface p-6">
          <div className="flex items-start justify-between gap-6">
            <div>
              <div className="label">Impact type</div>
              <div className="mt-1 text-[15px] font-medium text-ink-primary">
                {formatImpactType(impact.impactType)}
              </div>
            </div>
            <HeroDelta delta={impact.numericDelta} type={impact.impactType} />
          </div>

          <div className="mt-6 border-t border-divider pt-5">
            <div className="label mb-2">Summary</div>
            <p className="text-[14px] leading-relaxed text-ink-primary">{impact.narrative}</p>
          </div>

          <div className="mt-5 border-t border-divider pt-5">
            <div className="label mb-2">Recommended action</div>
            <p className="text-[14px] leading-relaxed text-ink-primary">{impact.recommendedAction}</p>
          </div>

          {impact.citationSourceUrl && (
            <div className="mt-5 border-t border-divider pt-5">
              <div className="label mb-2">IRCC page cited</div>
              <CitationChips
                liveUrl={impact.citationSourceUrl}
                archiveFingerprint={impact.ruleHash}
              />
            </div>
          )}
        </section>

        <CorrectionForm assessmentKey={assessmentKey} original={impact} />
      </div>

      <aside className="space-y-5">
        <SignatureReceipt
          assessmentKey={assessmentKey}
          fingerprintPreview={impact.canonicalHash}
          signedAt={impact.timestamp}
        />
      </aside>
    </div>
  );
}

function HeroDelta({ delta, type }: { delta: number | null; type: string }) {
  if (delta === null || type === "none") {
    return (
      <div className="text-right">
        <div className="label">Effect</div>
        <div className="mt-1 text-[15px] font-medium text-ink-secondary">Not affected</div>
      </div>
    );
  }
  const negative = delta < 0;
  return (
    <div className="text-right">
      <div className="label">CRS points</div>
      <div
        className={cn(
          "mt-1 text-[36px] font-medium leading-none tabular tracking-tight",
          negative ? "text-red" : "text-seal",
        )}
      >
        {formatDelta(delta)}
      </div>
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
      toast.error("Add your reasoning so the Auditor can learn from it.");
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
      toast.success("Correction saved. The Auditor will use it next time.");
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
      <div className="rounded-md border border-border bg-surface px-6 py-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="label">File a correction</div>
            <p className="mt-1 text-[13px] text-ink-secondary">
              If this reads wrong, tell us why. Future assessments in the same area apply your reasoning.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="h-9 rounded-sm border border-border bg-surface px-3 text-[13px] font-medium text-ink-primary hover:bg-surface-alt transition-colors"
          >
            Correct this
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border bg-surface p-6">
      <div className="label">File a correction</div>
      <p className="mt-1 text-[13px] text-ink-secondary">
        Tell us the correct interpretation. Your reasoning teaches the Auditor.
      </p>

      <form onSubmit={onSubmit} className="mt-6 space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="impactType" className="label">Impact type</Label>
            <select
              id="impactType"
              className="w-full h-9 rounded-sm border border-input bg-surface px-2.5 text-[13px] text-ink-primary"
              value={impactType}
              onChange={(e) => setImpactType(e.target.value as ImpactType)}
            >
              {IMPACT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {formatImpactType(t)}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="delta" className="label">CRS delta</Label>
            <Input
              id="delta"
              type="number"
              className="h-9 text-[13px] font-mono tabular"
              value={numericDelta}
              onChange={(e) => setNumericDelta(e.target.value)}
              placeholder="leave blank for no delta"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="reasoning" className="label">Your reasoning · required</Label>
          <Textarea
            id="reasoning"
            required
            rows={4}
            className="text-[13px] leading-relaxed"
            value={reasoning}
            onChange={(e) => setReasoning(e.target.value)}
            placeholder="e.g. IRCC transitional guidance exempts profiles active before March 24 2025."
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="narrative" className="label">Corrected summary</Label>
          <Textarea
            id="narrative"
            rows={2}
            className="text-[13px] leading-relaxed"
            value={narrative}
            onChange={(e) => setNarrative(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-[1fr_140px] gap-4 items-end">
          <div className="space-y-1.5">
            <Label htmlFor="action" className="label">Recommended action</Label>
            <Input
              id="action"
              className="h-9 text-[13px]"
              value={action}
              onChange={(e) => setAction(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="conf" className="label">Confidence</Label>
            <select
              id="conf"
              className="w-full h-9 rounded-sm border border-input bg-surface px-2.5 text-[13px] text-ink-primary"
              value={confidence}
              onChange={(e) => setConfidence(e.target.value as Confidence)}
            >
              {CONFIDENCE_LEVELS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={() => setOpen(false)}
            disabled={busy}
            className="h-9 rounded-sm px-3 text-[13px] text-ink-secondary hover:text-ink-primary transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="h-9 rounded-sm bg-primary px-3 text-[13px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {busy ? "Saving" : "Save correction"}
          </button>
        </div>
      </form>
    </div>
  );
}

function formatImpactType(t: string): string {
  const map: Record<string, string> = {
    "crs-delta": "CRS points changed",
    "eligibility-flip": "Eligibility changed",
    "deadline-shift": "Deadline shifted",
    "lmia-implication": "LMIA implication",
    "french-bonus": "French bonus affected",
    "procedural": "Procedural change",
    "none": "No impact",
  };
  return map[t] ?? t;
}
