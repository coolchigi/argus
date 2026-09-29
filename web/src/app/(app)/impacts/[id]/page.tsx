"use client";

import Link from "next/link";
import { use, useId, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { api } from "@/lib/api";
import { describeCorrectionError } from "@/lib/correction-error";
import type { Impact, ImpactType, Confidence } from "@/lib/argus-types";
import type { Correction } from "@/lib/types/corrections";
import { briefForAssessment } from "@/lib/assessments";
import { isNotFound, queryKeys, useBriefs, useImpact, useImpactCorrections, usePolicyEvent } from "@/lib/queries";
import { Input } from "@/components/ui/input";
import { SectionLabel } from "@/components/argus/section-label";
import { Textarea } from "@/components/ui/textarea";
import { SignatureReceipt } from "@/components/signature-receipt";
import { AgentLineage, useLiveRun } from "@/components/agent-lineage";
import { LearnedFromYou } from "@/components/learned-from-you";
import { useAssessmentLineage } from "@/lib/queries";
import { CitationChips } from "@/components/citation-chips";
import { formatDelta, formatRelative } from "@/lib/format";
import { humanizeImpactType, humanizeTopic } from "@/lib/humanize";
import { PageHeader } from "@/components/argus/page-header";
import { NumberedSection } from "@/components/argus/numbered-section";
import { InlineError } from "@/components/argus/inline-error";
import { Badge, StatusBadge } from "@/components/argus/status-badge";
import { CorrectionChange } from "@/components/assessments/correction-change";
import { formatDayMonthYear } from "@/components/dashboard/derive";
import { useBreadcrumbLabel } from "@/components/nav/breadcrumb-context";
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
  const impact = useImpact(assessmentKey);

  return (
    <div className="space-y-8">
      <Link href="/impacts" className="inline-flex items-center gap-1 text-[12px] text-ink-2 hover:text-ink-1">
        <ArrowLeft className="h-3 w-3" strokeWidth={1.75} />
        Back to assessments
      </Link>

      {impact.isLoading ? (
        <div className="py-16 text-center label">Loading</div>
      ) : impact.error && !isNotFound(impact.error) ? (
        <InlineError
          message="Couldn't load this assessment."
          detail={impact.error instanceof Error ? impact.error.message : null}
          retrying={impact.isFetching}
          onRetry={() => void impact.refetch()}
        />
      ) : !impact.data ? (
        <div className="py-16 text-center text-[13px] text-danger-ink">Assessment not found.</div>
      ) : (
        <ImpactBody impact={impact.data} assessmentKey={assessmentKey} />
      )}
    </div>
  );
}

function ImpactBody({ impact, assessmentKey }: { impact: Impact; assessmentKey: string }) {
  const title = humanizeTopic(impact.topic);
  useBreadcrumbLabel(`${impact.clientId} · ${title}`);
  const lineage = useAssessmentLineage(assessmentKey);
  const live = useLiveRun(impact.policyEventId, lineage.data);
  const eventId = impact.ruleHash || impact.policyEventId;
  const event = usePolicyEvent(eventId, { enabled: !!eventId });
  const briefs = useBriefs();
  const corrections = useImpactCorrections(assessmentKey);
  const brief = briefs.data ? briefForAssessment(impact, briefs.data.briefs ?? []) : null;
  const history = corrections.data?.corrections ?? [];
  const corrected = history.length > 0;

  return (
    // One column below 1024px. The receipt moves under the content instead of
    // squeezing it into a sliver.
    <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-8">
        <PageHeader
          title={`${impact.clientId} · ${title}`}
          meta={
            <>
              <time dateTime={impact.timestamp} className="text-ink-2">
                Signed {formatDateTime(impact.timestamp)}
              </time>
              <span> · {formatRelative(impact.timestamp)}</span>
            </>
          }
          actions={
            brief ? (
              <Link
                href={`/briefs/${encodeURIComponent(brief.briefId)}`}
                className="inline-flex h-9 items-center gap-1.5 rounded-sm border border-control bg-surface px-3 text-[13px] font-medium text-ink-1 transition-colors hover:bg-sunk"
              >
                Open brief
                <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.75} />
              </Link>
            ) : null
          }
        />

        {eventId && (
          <p className="text-[13px] text-ink-2">
            Part of event{" "}
            <Link href={`/policy-events/${encodeURIComponent(eventId)}`} className="font-mono text-[12px] text-ink-1 underline underline-offset-4 decoration-hairline hover:decoration-ink-1">
              {event.data?.event.ref ?? "view the event"}
            </Link>
            {brief && (
              <>
                {" "}
                · brief <StatusBadge kind="brief" status={brief.status} />
              </>
            )}
          </p>
        )}

        <AgentLineage policyEventId={impact.policyEventId} lineage={lineage.data} live={live} />
        <LearnedFromYou correctionKeys={lineage.data?.fewShotCorrectionKeys ?? []} />

        {/* A persistent 2px danger rail once the consultant has corrected this assessment. */}
        <div className={cn("relative space-y-8", corrected && "pl-4")}>
          {corrected && <span aria-hidden className="absolute inset-y-0 left-0 w-[2px] bg-danger" />}
          {corrected && (
            <p className="text-[13px] text-danger-ink">
              You corrected this assessment. The signed record below stays as Argus wrote it. Your correction sits beside it.
            </p>
          )}

          <NumberedSection number={1} title="What changes for this client">
            <div className="flex flex-wrap items-start justify-between gap-6">
              <div>
                <div className="label">Impact type</div>
                <div className="mt-1 text-[15px] font-medium text-ink-1">{humanizeImpactType(impact.impactType)}</div>
              </div>
              <HeroDelta delta={impact.numericDelta} type={impact.impactType} />
            </div>
            <p className="mt-5 max-w-[72ch] text-[14px] leading-relaxed text-ink-1">{impact.narrative}</p>
          </NumberedSection>

          <NumberedSection number={2} title="Recommended action">
            <p className="max-w-[72ch] text-[14px] leading-relaxed text-ink-1">{impact.recommendedAction}</p>
            {impact.citationSourceUrl && (
              <div className="mt-5">
                <div className="label mb-2">IRCC page cited</div>
                <CitationChips liveUrl={impact.citationSourceUrl} archiveFingerprint={impact.ruleHash} />
              </div>
            )}
          </NumberedSection>

          <div id="corrections" className="scroll-mt-6">
          <NumberedSection number={3} title="Corrections">
            {corrections.error ? (
              <InlineError
                message="Couldn't load the corrections on this assessment."
                detail={corrections.error instanceof Error ? corrections.error.message : null}
                retrying={corrections.isFetching}
                onRetry={() => void corrections.refetch()}
              />
            ) : (
              <CorrectionHistory corrections={history} loading={corrections.isPending} />
            )}
            <div className="mt-4">
              <CorrectionForm assessmentKey={assessmentKey} original={impact} />
            </div>
          </NumberedSection>
          </div>
        </div>
      </div>

      <aside className="min-w-0 space-y-5">
        <SignatureReceipt assessmentKey={assessmentKey} fingerprintPreview={impact.canonicalHash} signedAt={impact.timestamp} />
      </aside>
    </div>
  );
}

function CorrectionHistory({ corrections, loading }: { corrections: Correction[]; loading: boolean }) {
  if (loading) return <p className="label">Loading corrections</p>;
  if (corrections.length === 0) {
    return <p className="text-[13px] text-ink-2">No corrections yet. If this reads wrong, correct it below.</p>;
  }
  return (
    <ol className="divide-y divide-hairline border border-hairline bg-card" aria-label="Correction history, newest first">
      {corrections.map((c) => (
        <li key={c.correctionKey} className="space-y-1.5 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="danger">Correction</Badge>
            <time dateTime={c.correctedAt} className="font-mono text-[11px] tabular text-ink-3">
              {formatDateTime(c.correctedAt)}
            </time>
          </div>
          <CorrectionChange c={c} />
          <p className="max-w-[72ch] whitespace-pre-wrap text-[13px] leading-relaxed text-ink-1">{c.correctorReasoning}</p>
          {c.correctedRecommendedAction && c.correctedRecommendedAction !== c.originalRecommendedAction && (
            <p className="text-[12px] text-ink-2">
              <span className="label mr-2">Action</span>
              {c.correctedRecommendedAction}
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}

function HeroDelta({ delta, type }: { delta: number | null; type: string }) {
  if (delta === null || type === "none") {
    return (
      <div className="text-right">
        <div className="label">CRS points</div>
        <div className="mt-1 text-[15px] font-medium text-ink-2">n/a</div>
      </div>
    );
  }
  return (
    <div className="text-right">
      <div className="label">CRS points</div>
      <div className="mt-1 flex items-center justify-end gap-2">
        {delta !== 0 && <Badge tone={delta < 0 ? "danger" : "brand"}>{delta < 0 ? "Down" : "Up"}</Badge>}
        <span className="font-mono text-[20px] font-medium leading-none tabular text-ink-1">{formatDelta(delta)}</span>
      </div>
    </div>
  );
}

/** "21 Sep 2026, 23:02" in the viewer's time zone. */
function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "on an unknown date";
  const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return `${formatDayMonthYear(iso)}, ${time}`;
}

const PII_NOTE =
  "Refer to the client by their file number only. Argus refuses a correction that names a person or includes an email, phone number or address, because the Auditor reads every correction back.";

function CorrectionForm({ assessmentKey, original }: { assessmentKey: string; original: Impact }) {
  const qc = useQueryClient();
  const noteId = useId();
  const [open, setOpen] = useState(false);
  const [impactType, setImpactType] = useState<ImpactType>(original.impactType);
  const [numericDelta, setNumericDelta] = useState<string>(original.numericDelta?.toString() ?? "");
  const [narrative, setNarrative] = useState(original.narrative);
  const [action, setAction] = useState(original.recommendedAction);
  const [confidence, setConfidence] = useState<Confidence>(original.confidence);
  const [reasoning, setReasoning] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!reasoning.trim()) {
      setError("Add your reasoning so the Auditor can learn from it.");
      return;
    }
    setBusy(true);
    setError(null);
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
      void qc.invalidateQueries({ queryKey: queryKeys.impactCorrections(assessmentKey) });
      void qc.invalidateQueries({ queryKey: queryKeys.corrections() });
      void qc.invalidateQueries({ queryKey: ["policy-event-impacts"] });
      void qc.invalidateQueries({ queryKey: ["policy-events"] });
      setOpen(false);
      setReasoning("");
    } catch (err) {
      const message = describeCorrectionError(err instanceof Error ? err.message : "correction-failed");
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-4 border border-hairline bg-card px-4 py-4">
        <p className="min-w-0 flex-1 text-[13px] text-ink-2">
          If this reads wrong, tell Argus why. Future assessments on the same topic or policy area use your reasoning.
        </p>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="h-9 shrink-0 rounded-sm border border-control bg-surface px-3 text-[13px] font-medium text-ink-1 transition-colors hover:bg-sunk"
        >
          Correct this
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5 border border-hairline bg-card p-4 sm:p-6" aria-label="File a correction">
      <p id={noteId} className="border-l-2 border-brand-ink bg-brand-subtle px-3 py-2 text-[13px] leading-relaxed text-ink-1">
        {PII_NOTE}
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <SectionLabel as="label" htmlFor="impactType">Impact type</SectionLabel>
          <select
            id="impactType"
            className="h-9 w-full rounded-sm border border-control bg-surface px-2.5 text-[13px] text-ink-1"
            value={impactType}
            onChange={(e) => setImpactType(e.target.value as ImpactType)}
          >
            {IMPACT_TYPES.map((t) => (
              <option key={t} value={t}>
                {humanizeImpactType(t)}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <SectionLabel as="label" htmlFor="delta">CRS delta</SectionLabel>
          <Input
            id="delta"
            type="number"
            className="h-9 font-mono text-[13px] tabular"
            value={numericDelta}
            onChange={(e) => setNumericDelta(e.target.value)}
            placeholder="Leave blank for no delta"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <SectionLabel as="label" htmlFor="reasoning">Your reasoning · required</SectionLabel>
        <Textarea
          id="reasoning"
          required
          rows={4}
          aria-describedby={noteId}
          className="text-[13px] leading-relaxed"
          value={reasoning}
          onChange={(e) => setReasoning(e.target.value)}
          placeholder="e.g. IRCC transitional guidance exempts profiles active before March 24 2025."
        />
      </div>

      <div className="space-y-1.5">
        <SectionLabel as="label" htmlFor="narrative">Corrected summary</SectionLabel>
        <Textarea id="narrative" rows={3} aria-describedby={noteId} className="text-[13px] leading-relaxed" value={narrative} onChange={(e) => setNarrative(e.target.value)} />
      </div>

      <div className="grid grid-cols-1 items-end gap-4 sm:grid-cols-[minmax(0,1fr)_140px]">
        <div className="space-y-1.5">
          <SectionLabel as="label" htmlFor="action">Recommended action</SectionLabel>
          <Input id="action" aria-describedby={noteId} className="h-9 text-[13px]" value={action} onChange={(e) => setAction(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <SectionLabel as="label" htmlFor="conf">Confidence</SectionLabel>
          <select
            id="conf"
            className="h-9 w-full rounded-sm border border-control bg-surface px-2.5 text-[13px] text-ink-1"
            value={confidence}
            onChange={(e) => setConfidence(e.target.value as Confidence)}
          >
            {CONFIDENCE_LEVELS.map((c) => (
              <option key={c} value={c}>
                {humanizeTopic(c)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <p role="alert" className="border-l-2 border-danger bg-danger-subtle px-3 py-2 text-[13px] text-danger-ink">
          {error}
        </p>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          disabled={busy}
          className="h-9 rounded-sm px-3 text-[13px] text-ink-2 transition-colors hover:text-ink-1"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={busy}
          className="h-9 rounded-sm border border-brand-ink bg-brand px-3 text-[13px] font-medium text-on-brand transition-colors hover:bg-brand-hover disabled:opacity-50"
        >
          {busy ? "Saving" : "Save correction"}
        </button>
      </div>
    </form>
  );
}
