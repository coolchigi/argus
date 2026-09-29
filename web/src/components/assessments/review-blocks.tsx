import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { AuditorStance, Impact } from "@/lib/argus-types";
import { Badge } from "@/components/argus/status-badge";
import { cn } from "@/lib/utils";

// ADR-0004 on the assessment page: the Auditor's signed stance, the
// consultant's signed review, and the link between a review and the agent
// row it replaced. Brand and danger only. Seal-green stays for verified.

const verdict = (affected: boolean) => (affected ? "affected" : "not affected");

function impactHref(assessmentKey: string): string {
  return `/impacts/${encodeURIComponent(assessmentKey)}`;
}

/** The Auditor's view when it disagrees or isn't sure. An agree stance shows nothing. */
export function AuditorView({
  stance,
  isAffected,
  reviewed,
  onReview,
}: {
  stance: AuditorStance;
  isAffected: boolean;
  /** The consultant already reviewed this verdict, so there's nothing to act on here. */
  reviewed: boolean;
  onReview: () => void;
}) {
  const disagree = stance.stance === "disagree";
  return (
    <section
      aria-labelledby="auditor-view-heading"
      className={cn("border-l-2 px-4 py-3", disagree ? "border-danger bg-danger-subtle" : "border-brand-ink bg-brand-subtle")}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="auditor-view-heading" className={cn("label", disagree ? "text-danger-ink" : "text-brand-ink")}>
          Auditor&apos;s view
        </h2>
        <Badge tone={disagree ? "danger" : "brand"}>{disagree ? "Disagrees" : "Not sure"}</Badge>
      </div>
      <p className="mt-2 text-[13px] font-medium text-ink-1">
        {disagree
          ? `The Auditor thinks this client is ${verdict(!isAffected)}.`
          : `The Auditor couldn't confirm this client is ${verdict(isAffected)}.`}
      </p>
      <p className="mt-1 max-w-[72ch] text-[13px] leading-relaxed text-ink-1">{stance.reason || "No reason recorded."}</p>
      <p className="mt-2 text-[12px] text-ink-2">
        Signed with this assessment. The verdict below is the Analyst&apos;s. You decide which one stands.
      </p>
      {!reviewed && (
        <button
          type="button"
          onClick={onReview}
          className="mt-3 h-8 rounded-sm border border-control bg-surface px-3 text-[12px] font-medium text-ink-1 transition-colors hover:bg-sunk"
        >
          Review the verdict
        </button>
      )}
    </section>
  );
}

/** On a consultant review: who, when, why, and the record it replaced. */
export function ReviewedByYou({ review, reviewedAtLabel }: { review: Impact; reviewedAtLabel: string }) {
  return (
    <section aria-labelledby="reviewed-heading" className="border-l-2 border-brand-ink bg-brand-subtle px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="reviewed-heading" className="label text-brand-ink">
          Reviewed by you
        </h2>
        <time dateTime={review.reviewedAt ?? review.timestamp} className="font-mono text-[11px] tabular text-ink-2">
          {reviewedAtLabel}
        </time>
      </div>
      <p className="mt-2 text-[13px] font-medium text-ink-1">You changed the verdict to {verdict(review.isAffected)}.</p>
      {review.reviewReasoning && (
        <p className="mt-1 max-w-[72ch] whitespace-pre-wrap text-[13px] leading-relaxed text-ink-1">{review.reviewReasoning}</p>
      )}
      <p className="mt-2 text-[12px] text-ink-2">
        This is the current verdict. Argus signed it with the same key it signs assessments with, and a later run of the same rule won&apos;t replace it.
      </p>
      {review.supersedes && (
        <Link
          href={impactHref(review.supersedes)}
          className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-sm border border-control bg-surface px-3 text-[12px] text-ink-1 transition-colors hover:bg-sunk"
        >
          Open the original assessment
          <ArrowRight aria-hidden className="h-3 w-3" strokeWidth={1.75} />
        </Link>
      )}
    </section>
  );
}

/**
 * Where the agent chain sits on an agent row. A review isn't a pipeline run,
 * so it names the consultant and points at the original's chain instead.
 */
export function ConsultantReviewLineage({ supersedes }: { supersedes: string | undefined }) {
  return (
    <div className="rounded-md border border-border bg-surface">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3">
        <span className="text-[12px] font-medium text-ink-primary">Consultant review</span>
        <span className="text-[12px] text-ink-secondary">You set the verdict. Argus signed it with its signing key.</span>
      </div>
      <p className="border-t border-border px-4 py-2 text-[11px] text-ink-2">
        No agent produced this record.{" "}
        {supersedes ? (
          <Link href={impactHref(supersedes)} className="text-ink-1 underline underline-offset-4 decoration-hairline hover:decoration-ink-1">
            See how Argus reviewed the original
          </Link>
        ) : (
          "The original assessment holds the agent chain."
        )}
      </p>
    </div>
  );
}

/** On an agent row a consultant review replaced. */
export function SupersededNotice({ review, reviewedAtLabel }: { review: Impact; reviewedAtLabel: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border border-hairline bg-card px-4 py-3">
      <p className="min-w-0 flex-1 text-[13px] leading-relaxed text-ink-1">
        You changed this verdict to {verdict(review.isAffected)} on {reviewedAtLabel}. Your review is the current record. This assessment stays in the history as Argus signed it.
      </p>
      <Link
        href={impactHref(review.assessmentKey)}
        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-sm border border-control bg-surface px-3 text-[12px] font-medium text-ink-1 transition-colors hover:bg-sunk"
      >
        Open your review
        <ArrowRight aria-hidden className="h-3 w-3" strokeWidth={1.75} />
      </Link>
    </div>
  );
}
