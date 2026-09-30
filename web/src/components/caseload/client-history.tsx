"use client";

import Link from "next/link";
import { Fingerprint } from "@/components/argus/fingerprint";
import { Badge, StatusBadge } from "@/components/argus/status-badge";
import { formatDayMonthYear } from "@/components/dashboard/derive";
import { formatDelta } from "@/lib/format";
import { humanizeImpactType, humanizeTopic } from "@/lib/humanize";
import type { ClientAssessment, ClientBrief } from "@/lib/types/profiles";
import { AuditorFlagBadge } from "@/components/argus/auditor-flag-badge";

function impactHref(assessmentKey: string) {
  return `/impacts/${encodeURIComponent(assessmentKey)}`;
}

function assessmentStatus(a: ClientAssessment): "action-required" | "done" | "no-impact" {
  if (!a.isAffected) return "no-impact";
  return a.needsBrief ? "action-required" : "done";
}

/** "Reassessed, 3 runs. The earlier run said not affected." Reviews read as yours, not as runs. */
function historyNote(a: ClientAssessment): string | null {
  const previous = a.priorAssessments[0];
  if (a.recordKind === "consultant-review") {
    const replaced = a.priorAssessments.find((p) => p.assessmentKey === a.supersedes);
    return replaced ? `You changed the verdict. It said ${replaced.isAffected ? "affected" : "not affected"}.` : "You changed the verdict.";
  }
  if (a.runs <= 1) return null;
  const was = previous && previous.isAffected !== a.isAffected ? `The earlier run said ${previous.isAffected ? "affected" : "not affected"}.` : "Same verdict as before.";
  return `Reassessed, ${a.runs} runs. ${was}`;
}

/** One row per policy change: the client's current assessment, with a note when it was reassessed. */
export function AssessmentList({ assessments }: { assessments: ClientAssessment[] }) {
  if (assessments.length === 0) {
    return <p className="text-[13px] text-ink-2">No policy change has touched this client yet. Argus checks every new IRCC change against their profile.</p>;
  }
  return (
    <ul className="divide-y divide-hairline border border-hairline bg-card">
      {assessments.map((a) => (
        <li key={a.assessmentKey} className="relative px-4 py-3.5 transition-colors hover:bg-brand-subtle/40 focus-within:bg-brand-subtle/40">
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
            <div className="min-w-0 space-y-1">
              <Link
                href={impactHref(a.assessmentKey)}
                className="text-[14px] font-medium text-ink-1 after:absolute after:inset-0 after:content-[''] hover:underline underline-offset-4"
              >
                {humanizeTopic(a.topic)}
              </Link>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-ink-3">
                <span>{humanizeImpactType(a.impactType)}</span>
                {a.numericDelta !== null && <span className={a.numericDelta < 0 ? "text-danger-ink" : "text-ink-2"}>{formatDelta(a.numericDelta)}</span>}
                <span>
                  {a.recordKind === "consultant-review" ? "Reviewed" : "Assessed"} {formatDayMonthYear(a.signedAt)}
                </span>
                {historyNote(a) && <span>{historyNote(a)}</span>}
              </div>
              {a.isAffected && a.recommendedAction && <p className="max-w-prose text-[13px] text-ink-2">{a.recommendedAction}</p>}
            </div>
            <div className="relative z-10 flex shrink-0 flex-col items-end gap-1.5">
              <AuditorFlagBadge reason={a.actionReason} />
              {a.recordKind === "consultant-review" && <Badge>Reviewed by you</Badge>}
              <StatusBadge kind="assessment" status={assessmentStatus(a)} />
              {a.canonicalHash && <Fingerprint hash={a.canonicalHash} signed={a.signed} href={`/verify/${a.canonicalHash}`} />}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

const BRIEF_STATUSES = new Set(["draft", "edited", "sent", "sent-externally"]);

export function BriefList({ briefs }: { briefs: ClientBrief[] }) {
  if (briefs.length === 0) {
    return <p className="text-[13px] text-ink-2">No briefs yet. Argus drafts one when a change affects this client.</p>;
  }
  return (
    <ul className="divide-y divide-hairline border border-hairline bg-card">
      {briefs.map((b) => (
        <li key={b.briefId} className="relative flex flex-wrap items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-brand-subtle/40 focus-within:bg-brand-subtle/40">
          <div className="min-w-0">
            <Link
              href={`/briefs/${encodeURIComponent(b.briefId)}`}
              className="text-[13px] text-ink-1 after:absolute after:inset-0 after:content-[''] hover:underline underline-offset-4"
            >
              {humanizeTopic(b.topic)}
            </Link>
            <div className="font-mono text-[11px] text-ink-3">
              {b.sentAt ? `Sent ${formatDayMonthYear(b.sentAt)}` : b.createdAt ? `Drafted ${formatDayMonthYear(b.createdAt)}` : "Not dated"}
              {!b.onCurrentAssessment && " · written for an earlier run"}
            </div>
          </div>
          {BRIEF_STATUSES.has(b.status) ? (
            <StatusBadge kind="brief" status={b.status as "draft" | "edited" | "sent" | "sent-externally"} />
          ) : (
            <Badge tone="neutral">{b.status || "Unknown"}</Badge>
          )}
        </li>
      ))}
    </ul>
  );
}
