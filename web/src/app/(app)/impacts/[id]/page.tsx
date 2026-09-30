"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useId, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { describeCorrectionError } from "@/lib/correction-error";
import {
  changesVerdict,
  serverFieldError,
  validateCorrection,
  type CorrectionErrors,
  type VerdictChoice,
} from "@/lib/correction-form";
import type { Impact, ImpactType, Confidence } from "@/lib/argus-types";
import type { Correction } from "@/lib/types/corrections";
import { briefForAssessment } from "@/lib/assessments";
import { auditorStanceOf, isReview } from "@/lib/assessment-key";
import { currentFor } from "@/lib/current-assessments";
import { reviewedRun } from "@/lib/lineage";
import {
  isNotFound,
  useAssessmentLineage,
  useBriefs,
  useFileCorrection,
  useImpact,
  useImpactCorrections,
  useImpacts,
  usePolicyEvent,
} from "@/lib/queries";
import { Input } from "@/components/ui/input";
import { SectionLabel } from "@/components/argus/section-label";
import { Textarea } from "@/components/ui/textarea";
import { SignatureReceipt } from "@/components/signature-receipt";
import { AgentLineage, useLiveRun } from "@/components/agent-lineage";
import { LearnedFromYou } from "@/components/learned-from-you";
import { CitationChips } from "@/components/citation-chips";
import { formatDelta, formatRelative } from "@/lib/format";
import { humanizeImpactType, humanizeTopic } from "@/lib/humanize";
import { PageHeader } from "@/components/argus/page-header";
import { NumberedSection } from "@/components/argus/numbered-section";
import { InlineError } from "@/components/argus/inline-error";
import { Badge, StatusBadge } from "@/components/argus/status-badge";
import { CorrectionChange } from "@/components/assessments/correction-change";
import { AuditorView, ConsultantReviewLineage, ReviewedByYou, SupersededNotice } from "@/components/assessments/review-blocks";
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
        // Keyed so moving from an assessment to its review starts clean.
        <ImpactBody key={assessmentKey} impact={impact.data} assessmentKey={assessmentKey} />
      )}
    </div>
  );
}

function ImpactBody({ impact, assessmentKey }: { impact: Impact; assessmentKey: string }) {
  const title = humanizeTopic(impact.topic);
  useBreadcrumbLabel(`${impact.clientId} · ${title}`);
  const review = isReview(impact);
  // A review has no run of its own. On a review key the route returns the run
  // behind the assessment it replaced, with reviewOf set. A review copies that
  // row's policyEventId, so the row's value is the right run either way.
  const lineage = useAssessmentLineage(assessmentKey, impact.policyEventId);
  const originalRun = review ? reviewedRun(lineage.data) : null;
  const live = useLiveRun(review && !originalRun ? null : impact.policyEventId, lineage.data);
  const eventId = impact.ruleHash || impact.policyEventId;
  const event = usePolicyEvent(eventId, { enabled: !!eventId });
  const briefs = useBriefs();
  const impacts = useImpacts();
  const corrections = useImpactCorrections(assessmentKey);
  const brief = briefs.data ? briefForAssessment(impact, briefs.data.briefs ?? []) : null;
  const history = corrections.data?.corrections ?? [];
  const corrected = history.length > 0;
  const stance = auditorStanceOf(impact);
  const shownStance = stance && stance.stance !== "agree" ? stance : null;
  const current = impacts.data ? currentFor(impact, impacts.data.allImpacts) : null;
  const replacedBy = current && current.assessmentKey !== assessmentKey && isReview(current) ? current : null;
  const [formOpen, setFormOpen] = useState(false);

  function openReview() {
    setFormOpen(true);
    requestAnimationFrame(() => document.getElementById("corrections")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

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
                {review ? "Reviewed" : "Signed"} {formatDateTime(impact.timestamp)}
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

        {replacedBy && <SupersededNotice review={replacedBy} reviewedAtLabel={formatDateTime(replacedBy.reviewedAt ?? replacedBy.timestamp)} />}

        {review ? (
          <>
            <ReviewedByYou review={impact} reviewedAtLabel={formatDateTime(impact.reviewedAt ?? impact.timestamp)} />
            <ConsultantReviewLineage
              supersedes={originalRun?.originalKey ?? impact.supersedes}
              originalRun={originalRun ? <AgentLineage policyEventId={originalRun.policyEventId} lineage={lineage.data} live={live} /> : undefined}
            />
          </>
        ) : (
          <>
            <AgentLineage policyEventId={impact.policyEventId} lineage={lineage.data} live={live} />
            <LearnedFromYou correctionKeys={lineage.data?.fewShotCorrectionKeys ?? []} />
          </>
        )}

        {shownStance && <AuditorView stance={shownStance} isAffected={impact.isAffected} reviewed={replacedBy !== null} onReview={openReview} />}

        {/* A persistent 2px danger rail once the consultant has corrected this assessment. */}
        <div className={cn("relative space-y-8", corrected && "pl-4")}>
          {corrected && <span aria-hidden className="absolute inset-y-0 left-0 w-[2px] bg-danger" />}
          {corrected && (
            <p className="text-[13px] text-danger-ink">
              You corrected this {review ? "review" : "assessment"}. The signed record below stays as it was signed. Your correction sits beside it.
            </p>
          )}

          <NumberedSection number={1} title="What changes for this client">
            <div className="flex flex-wrap items-start justify-between gap-6">
              <div className="flex flex-wrap gap-8">
                <div>
                  <div className="label">Verdict</div>
                  <div className="mt-1">
                    {impact.isAffected ? <Badge tone="brand">Affected</Badge> : <Badge>Not affected</Badge>}
                  </div>
                </div>
                <div>
                  <div className="label">Impact type</div>
                  <div className="mt-1 text-[15px] font-medium text-ink-1">{humanizeImpactType(impact.impactType)}</div>
                </div>
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
                <CorrectionForm assessmentKey={assessmentKey} original={impact} open={formOpen} onOpenChange={setFormOpen} />
              </div>
            </NumberedSection>
          </div>
        </div>
      </div>

      <aside className="min-w-0 space-y-5">
        <SignatureReceipt assessmentKey={assessmentKey} fingerprintPreview={impact.canonicalHash} signedAt={impact.timestamp} review={review} />
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
            <Badge tone="danger">{c.reviewAssessmentKey ? "Verdict changed" : "Correction"}</Badge>
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
          {c.reviewAssessmentKey && (
            <Link
              href={`/impacts/${encodeURIComponent(c.reviewAssessmentKey)}`}
              className="inline-block text-[12px] text-ink-1 underline underline-offset-4 decoration-hairline hover:decoration-ink-1"
            >
              Open your signed review
            </Link>
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

const VERDICT_OPTIONS: Array<{ value: VerdictChoice; label: string }> = [
  { value: "keep", label: "Keep as is" },
  { value: "affected", label: "Affected" },
  { value: "not-affected", label: "Not affected" },
];

function FieldError({ id, message }: { id: string; message: string | undefined }) {
  if (!message) return null;
  return (
    <p id={id} className="text-[12px] text-danger-ink">
      {message}
    </p>
  );
}

function CorrectionForm({
  assessmentKey,
  original,
  open,
  onOpenChange,
}: {
  assessmentKey: string;
  original: Impact;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const noteId = useId();
  const errId = useId();
  const file = useFileCorrection(assessmentKey);
  const [verdict, setVerdict] = useState<VerdictChoice>("keep");
  const [impactType, setImpactType] = useState<ImpactType>(original.impactType);
  const [numericDelta, setNumericDelta] = useState<string>(original.numericDelta?.toString() ?? "");
  const [narrative, setNarrative] = useState(original.narrative);
  const [action, setAction] = useState(original.recommendedAction);
  const [confidence, setConfidence] = useState<Confidence>(original.confidence);
  const [reasoning, setReasoning] = useState("");
  const [errors, setErrors] = useState<CorrectionErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const busy = file.isPending;
  const flip = changesVerdict({ verdict }, original);

  function chooseVerdict(next: VerdictChoice) {
    setVerdict(next);
    setErrors((e) => ({ ...e, verdict: undefined, narrative: undefined, action: undefined, impactType: undefined }));
    // A client who isn't affected has no impact to describe.
    if (next === "not-affected" && original.isAffected) {
      setImpactType("none");
      setNumericDelta("");
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const { errors: found, body } = validateCorrection(
      { verdict, impactType, numericDelta, narrative, action, confidence, reasoning },
      original,
    );
    setErrors(found);
    setFormError(null);
    if (!body) return;
    try {
      const res = await file.mutateAsync(body);
      setReasoning("");
      onOpenChange(false);
      if (res.review) {
        toast.success("Verdict changed. Your review is signed and is now the current record.");
        router.push(`/impacts/${encodeURIComponent(res.review.assessmentKey)}`);
      } else {
        toast.success("Correction saved. The Auditor will use it next time.");
      }
    } catch (err) {
      const code = err instanceof Error ? err.message : "correction-failed";
      const field = serverFieldError(code);
      if (field) setErrors({ [field.field]: field.message });
      else setFormError(describeCorrectionError(code));
      toast.error(field?.message ?? describeCorrectionError(code));
    }
  }

  if (!open) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-4 border border-hairline bg-card px-4 py-4">
        <p className="min-w-0 flex-1 text-[13px] text-ink-2">
          If this reads wrong, tell Argus why. You can change the verdict too. Future assessments on the same topic or policy area use your reasoning.
        </p>
        <button
          type="button"
          onClick={() => onOpenChange(true)}
          className="h-9 shrink-0 rounded-sm border border-control bg-surface px-3 text-[13px] font-medium text-ink-1 transition-colors hover:bg-sunk"
        >
          Correct this
        </button>
      </div>
    );
  }

  const describedBy = (field: keyof CorrectionErrors) => (errors[field] ? `${noteId} ${errId}-${field}` : noteId);
  const current = original.isAffected ? "affected" : "not-affected";

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5 border border-hairline bg-card p-4 sm:p-6" aria-label="File a correction">
      <p id={noteId} className="border-l-2 border-brand-ink bg-brand-subtle px-3 py-2 text-[13px] leading-relaxed text-ink-1">
        {PII_NOTE}
      </p>

      <fieldset className="space-y-2" aria-describedby={errors.verdict ? `${errId}-verdict` : undefined}>
        <legend className="label mb-1.5">Is this client affected?</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {VERDICT_OPTIONS.map((o) => (
            <label
              key={o.value}
              className={cn(
                "flex h-9 cursor-pointer items-center gap-2 rounded-sm border px-3 text-[13px] transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus",
                verdict === o.value ? "border-brand-ink bg-brand-subtle text-ink-1" : "border-control bg-surface text-ink-2 hover:bg-sunk",
              )}
            >
              <input
                type="radio"
                name="verdict"
                value={o.value}
                checked={verdict === o.value}
                onChange={() => chooseVerdict(o.value)}
                className="accent-brand-ink"
              />
              <span>{o.label}</span>
              {o.value === current && <span className="ml-auto font-mono text-[11px] text-ink-3">current</span>}
            </label>
          ))}
        </div>
        <FieldError id={`${errId}-verdict`} message={errors.verdict} />
        {flip && (
          <p className="text-[12px] leading-relaxed text-ink-2">
            Saving signs your verdict as a new record, and it becomes the current one. The {isReview(original) ? "earlier review" : "assessment Argus signed"} stays in the history, unchanged.
            {verdict === "affected" ? " Argus drafts a brief from your summary." : ""}
          </p>
        )}
      </fieldset>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <SectionLabel as="label" htmlFor="impactType">Impact type</SectionLabel>
          <select
            id="impactType"
            aria-invalid={!!errors.impactType}
            aria-describedby={errors.impactType ? `${errId}-impactType` : undefined}
            className={cn(
              "h-9 w-full rounded-sm border bg-surface px-2.5 text-[13px] text-ink-1",
              errors.impactType ? "border-danger" : "border-control",
            )}
            value={impactType}
            onChange={(e) => {
              setImpactType(e.target.value as ImpactType);
              setErrors((x) => ({ ...x, impactType: undefined }));
            }}
          >
            {IMPACT_TYPES.map((t) => (
              <option key={t} value={t}>
                {humanizeImpactType(t)}
              </option>
            ))}
          </select>
          <FieldError id={`${errId}-impactType`} message={errors.impactType} />
        </div>
        <div className="space-y-1.5">
          <SectionLabel as="label" htmlFor="delta">CRS delta</SectionLabel>
          <Input
            id="delta"
            type="number"
            aria-invalid={!!errors.delta}
            aria-describedby={errors.delta ? `${errId}-delta` : undefined}
            className="h-9 font-mono text-[13px] tabular"
            value={numericDelta}
            onChange={(e) => setNumericDelta(e.target.value)}
            placeholder="Leave blank for no delta"
          />
          <FieldError id={`${errId}-delta`} message={errors.delta} />
        </div>
      </div>

      <div className="space-y-1.5">
        <SectionLabel as="label" htmlFor="reasoning">Your reasoning · required</SectionLabel>
        <Textarea
          id="reasoning"
          rows={4}
          aria-invalid={!!errors.reasoning}
          aria-describedby={describedBy("reasoning")}
          className="text-[13px] leading-relaxed"
          value={reasoning}
          onChange={(e) => {
            setReasoning(e.target.value);
            setErrors((x) => ({ ...x, reasoning: undefined }));
          }}
          placeholder="e.g. IRCC transitional guidance exempts profiles active before March 24 2025."
        />
        <FieldError id={`${errId}-reasoning`} message={errors.reasoning} />
      </div>

      <div className="space-y-1.5">
        <SectionLabel as="label" htmlFor="narrative">Corrected summary{flip ? " · required" : ""}</SectionLabel>
        <Textarea
          id="narrative"
          rows={3}
          aria-invalid={!!errors.narrative}
          aria-describedby={describedBy("narrative")}
          className="text-[13px] leading-relaxed"
          value={narrative}
          onChange={(e) => {
            setNarrative(e.target.value);
            setErrors((x) => ({ ...x, narrative: undefined }));
          }}
        />
        <FieldError id={`${errId}-narrative`} message={errors.narrative} />
      </div>

      <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-[minmax(0,1fr)_140px]">
        <div className="space-y-1.5">
          <SectionLabel as="label" htmlFor="action">Recommended action{flip ? " · required" : ""}</SectionLabel>
          <Input
            id="action"
            aria-invalid={!!errors.action}
            aria-describedby={describedBy("action")}
            className="h-9 text-[13px]"
            value={action}
            onChange={(e) => {
              setAction(e.target.value);
              setErrors((x) => ({ ...x, action: undefined }));
            }}
          />
          <FieldError id={`${errId}-action`} message={errors.action} />
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

      {formError && (
        <p role="alert" className="border-l-2 border-danger bg-danger-subtle px-3 py-2 text-[13px] text-danger-ink">
          {formError}
        </p>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={() => {
            onOpenChange(false);
            setErrors({});
            setFormError(null);
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
          {busy ? "Saving" : flip ? "Sign my verdict" : "Save correction"}
        </button>
      </div>
    </form>
  );
}
