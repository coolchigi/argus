"use client";

import Link from "next/link";
import { Fragment, useState } from "react";
import { ArrowRight, ChevronDown } from "lucide-react";
import { ClientChip } from "@/components/argus/client-chip";
import { Fingerprint } from "@/components/argus/fingerprint";
import { Badge, StatusBadge } from "@/components/argus/status-badge";
import { formatDayMonthYear } from "@/components/dashboard/derive";
import { clientActionReason, clientBriefState, clientNeedsAction } from "@/components/policy-events/derive";
import { ACTION_REASON_LABEL } from "@/lib/assessments";
import { formatDelta } from "@/lib/format";
import { humanizeImpactType, humanizeTopic } from "@/lib/humanize";
import type { PolicyEventImpact } from "@/lib/types/policy-events";
import { cn } from "@/lib/utils";

const HEADERS = ["Client", "Verdict", "Impact", "Recommended action", "Brief"] as const;

function detailsId(c: PolicyEventImpact): string {
  return `client-details-${c.clientId.replace(/[^A-Za-z0-9_-]/g, "_")}`;
}

function BriefCell({ c }: { c: PolicyEventImpact }) {
  const state = clientBriefState(c);
  if (state === "not-needed") return <span className="text-[12px] text-ink-3">Not needed</span>;
  if (state === "missing") return <Badge tone="brand">Needs a brief</Badge>;
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <StatusBadge kind="brief" status={state} />
      {state === "sent" && c.brief?.sentAt && (
        <time dateTime={c.brief.sentAt} className="font-mono text-[11px] text-ink-3 tabular">
          {formatDayMonthYear(c.brief.sentAt)}
        </time>
      )}
    </span>
  );
}

function Details({ c }: { c: PolicyEventImpact }) {
  const assessmentHref = `/impacts/${encodeURIComponent(c.assessmentKey)}`;
  const review = c.recordKind === "consultant-review";
  const stance = c.auditorStance && c.auditorStance.stance !== "agree" ? c.auditorStance : null;
  return (
    <div className="space-y-4">
      {review && (
        <p className="border-l-2 border-brand-ink bg-brand-subtle px-3 py-2 text-[12px] leading-relaxed text-ink-1">
          You reviewed this verdict{c.reviewedAt ? ` on ${formatDayMonthYear(c.reviewedAt)}` : ""}. Your signed review is the current record.
          {c.supersedes && (
            <>
              {" "}
              <Link href={`/impacts/${encodeURIComponent(c.supersedes)}`} className="underline underline-offset-4 hover:text-ink-1">
                Open the original assessment
              </Link>
              , which stays on record.
            </>
          )}
        </p>
      )}
      {stance && (
        <div className={cn("border-l-2 px-3 py-2", stance.stance === "disagree" ? "border-danger bg-danger-subtle" : "border-brand-ink bg-brand-subtle")}>
          <div className={cn("label mb-1", stance.stance === "disagree" ? "text-danger-ink" : "text-brand-ink")}>
            {stance.stance === "disagree" ? "The Auditor disagrees" : "The Auditor isn't sure"}
          </div>
          <p className="max-w-[68ch] text-[12px] leading-relaxed text-ink-1">{stance.reason || "No reason recorded."}</p>
        </div>
      )}
      <div>
        <div className="label mb-1.5">What changes for this client</div>
        <p className="max-w-[68ch] text-[13px] leading-relaxed text-ink-1">{c.narrative || "No narrative recorded."}</p>
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
        <Meta label="Confidence">{humanizeTopic(c.confidence)}</Meta>
        <Meta label="Program">{c.program ? humanizeTopic(c.program) : "Not set"}</Meta>
        <Meta label="Current CRS">
          <span className="font-mono tabular">{c.currentCrsScore ?? "Not set"}</span>
        </Meta>
        <Meta label="Assessed">
          <time dateTime={c.signedAt} className="font-mono tabular">
            {formatDayMonthYear(c.signedAt)}
          </time>
        </Meta>
      </dl>

      {c.priorAssessments.length > 0 && (
        <div>
          <div className="label mb-1.5">Earlier assessments of this change</div>
          <ul className="space-y-1.5">
            {c.priorAssessments.map((p) => (
              <li key={p.assessmentKey} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-2">
                <time dateTime={p.signedAt} className="font-mono tabular">
                  {formatDayMonthYear(p.signedAt)}
                </time>
                <span>{p.isAffected ? "Affected" : "Not affected"}</span>
                {p.recordKind === "consultant-review" && <span className="text-ink-1">Your review</span>}
                {p.correctionsFiled > 0 && <StatusBadge kind="assessment" status="corrected" />}
                {p.canonicalHash && <Fingerprint hash={p.canonicalHash} signed chars={8} href={`/verify/${p.canonicalHash}`} />}
                <Link
                  href={`/impacts/${encodeURIComponent(p.assessmentKey)}`}
                  className="text-ink-2 underline underline-offset-4 hover:text-ink-1"
                >
                  Open<span className="sr-only"> earlier assessment from {formatDayMonthYear(p.signedAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Link
          href={assessmentHref}
          className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-control bg-surface px-3 text-[12px] text-ink-1 transition-colors hover:bg-sunk"
        >
          {review ? "Open your review" : "Open assessment"}
          <ArrowRight aria-hidden className="h-3 w-3" strokeWidth={1.75} />
        </Link>
        {c.brief && (
          <Link
            href={`/briefs/${encodeURIComponent(c.brief.briefId)}`}
            className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-control bg-surface px-3 text-[12px] text-ink-1 transition-colors hover:bg-sunk"
          >
            Open brief
            <ArrowRight aria-hidden className="h-3 w-3" strokeWidth={1.75} />
          </Link>
        )}
      </div>
    </div>
  );
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="label mb-0.5">{label}</dt>
      <dd className="text-[12px] text-ink-1">{children}</dd>
    </div>
  );
}

/**
 * One row per client, current assessment only. A row opens in place to show
 * the narrative, earlier runs and links to the assessment and the brief.
 */
export function ClientImpactTable({ clients, empty }: { clients: PolicyEventImpact[]; empty: React.ReactNode }) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());

  function toggle(clientId: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(clientId)) next.delete(clientId);
      else next.add(clientId);
      return next;
    });
  }

  return (
    // relative keeps the sr-only labels inside the scroller, or they widen the page on phones.
    <div className="relative overflow-x-auto border border-hairline bg-card">
      <table className="w-full border-collapse text-[13px]">
        <caption className="sr-only">Clients assessed against this change</caption>
        <thead className="bg-surface">
          <tr className="border-b border-hairline">
            {HEADERS.map((h) => (
              <th
                key={h}
                scope="col"
                className={cn(
                  "px-4 py-2.5 text-left font-mono text-[11px] font-normal uppercase tracking-[0.12em] text-ink-3",
                  h === "Recommended action" && "hidden md:table-cell",
                )}
              >
                {h}
              </th>
            ))}
            <th scope="col" className="w-10 px-2 py-2.5">
              <span className="sr-only">Details</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {clients.length === 0 ? (
            <tr>
              <td colSpan={HEADERS.length + 1} className="px-4 py-12 text-center text-[13px] text-ink-2">
                {empty}
              </td>
            </tr>
          ) : (
            clients.map((c, i) => {
              const isOpen = open.has(c.clientId);
              const again = c.priorAssessments.length;
              const zebra = i % 2 === 1 ? "bg-sunk" : undefined;
              return (
                <Fragment key={c.clientId}>
                  <tr className={cn("border-b border-hairline", zebra)}>
                    <td className="px-4 py-3 align-top">
                      <ClientChip clientId={c.clientId} needsAction={clientNeedsAction(c)} className="whitespace-nowrap" />
                      {again > 0 && (
                        <span className="mt-1 block font-mono text-[11px] text-ink-3">
                          <span aria-hidden>↳ </span>Reassessed {again}x
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <span className="inline-flex flex-wrap gap-1">
                        {c.isAffected ? <Badge tone="brand">Affected</Badge> : <Badge>Not affected</Badge>}
                        {clientActionReason(c) === "auditor-disagrees" && <Badge tone="danger">{ACTION_REASON_LABEL["auditor-disagrees"]}</Badge>}
                        {c.recordKind === "consultant-review" && <Badge>Reviewed by you</Badge>}
                        {c.correctionsFiled > 0 && <StatusBadge kind="assessment" status="corrected" />}
                      </span>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <span className="block text-ink-1">{humanizeImpactType(c.impactType)}</span>
                      {c.numericDelta !== null && (
                        <span className="font-mono text-[12px] text-ink-2 tabular">{formatDelta(c.numericDelta)}</span>
                      )}
                    </td>
                    <td className="hidden max-w-[320px] px-4 py-3 align-top text-[12px] leading-relaxed text-ink-2 md:table-cell">
                      {c.isAffected ? c.recommendedAction || "None given" : <span className="text-ink-3">None needed</span>}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <BriefCell c={c} />
                    </td>
                    <td className="px-2 py-2 align-top">
                      <button
                        type="button"
                        onClick={() => toggle(c.clientId)}
                        aria-expanded={isOpen}
                        aria-controls={isOpen ? detailsId(c) : undefined}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-ink-2 transition-colors hover:bg-sunk hover:text-ink-1"
                      >
                        <ChevronDown
                          aria-hidden
                          className={cn("h-4 w-4", isOpen && "rotate-180")}
                          strokeWidth={1.75}
                        />
                        <span className="sr-only">
                          {isOpen ? "Hide" : "Show"} details for client {c.clientId}
                        </span>
                      </button>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr id={detailsId(c)} className="border-b border-hairline bg-surface">
                      <td colSpan={HEADERS.length + 1} className="px-4 py-4">
                        <div className="mb-3 text-[12px] text-ink-2 md:hidden">
                          <span className="label mr-2">Recommended action</span>
                          {c.recommendedAction || "None given"}
                        </div>
                        <Details c={c} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
