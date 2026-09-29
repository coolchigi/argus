import type { Brief, Impact } from "@/lib/argus-types";
import { countActionRequired, deriveAssessmentRows } from "../../lib/assessments.ts";
import { ruleClientKey, sentRuleClientKeys } from "../../lib/current-assessments.ts";
import type { PolicyEvent } from "@/lib/types/policy-events";

/** The banner only looks back this far. PHASE8_PLAN section 4, Q8. */
export const BANNER_WINDOW_DAYS = 14;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "22 Sep", in the viewer's time zone. */
export function formatDayMonth(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "an unknown date";
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** "22 Sep 2026". */
export function formatDayMonthYear(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "Not set";
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** "14:07" for today, "22 Sep" otherwise. */
export function formatFeedTime(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const sameDay =
    d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  if (sameDay) return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return formatDayMonth(iso);
}

/**
 * Action-required events detected in the last 14 days that the consultant
 * hasn't dismissed, newest first. The first one is the banner, the rest are "+N more".
 */
export function bannerEvents(events: PolicyEvent[], dismissed: ReadonlySet<string>, now: Date = new Date()): PolicyEvent[] {
  const cutoff = now.getTime() - BANNER_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  return events
    .filter((e) => e.status === "action-required")
    .filter((e) => {
      const t = new Date(e.detectedAt).getTime();
      return Number.isFinite(t) && t >= cutoff;
    })
    .filter((e) => !dismissed.has(e.eventId))
    .sort((a, b) => b.detectedAt.localeCompare(a.detectedAt));
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/**
 * The sentence after "IRCC changed X on D." It has to stay true when an event
 * has affected clients but no brief rows yet (briefsUnsent 0, briefsSent 0),
 * which happens on real data.
 */
export function bannerImpactSentence(e: PolicyEvent): string {
  const disagrees = e.auditorDisagrees ?? 0;
  const dissent = disagrees > 0 ? ` The Auditor disagrees with ${disagrees} ${plural(disagrees, "verdict", "verdicts")}.` : "";
  return `${briefSentence(e)}${dissent}`;
}

function briefSentence(e: PolicyEvent): string {
  const affected = e.affectedCount;
  const clients = `${affected} of your ${plural(affected, "clients is", "clients are")} affected`;
  if (e.briefsUnsent > 0) {
    return `${clients} and ${e.briefsUnsent} ${plural(e.briefsUnsent, "brief hasn't", "briefs haven't")} gone out yet.`;
  }
  // No unsent brief rows. Count the affected clients still without a sent brief.
  const waiting = e.awaitingBrief;
  if (waiting === 0) return `${clients}.`;
  if (waiting === affected) return `${clients} and still ${plural(affected, "needs", "need")} a brief.`;
  return `${clients} and ${waiting} still ${plural(waiting, "needs", "need")} a brief.`;
}

export type DashboardStats = {
  /** Distinct clientIds with at least one affected assessment. */
  clientsAffected: number;
  /** Of those, clients with at least one affected assessment that has no sent brief. */
  clientsWaiting: number;
  /** Current verdicts that need the consultant. Same number as the Assessments nav badge. */
  actionRequired: number;
  /** The part of actionRequired that's there because the Auditor disagrees. */
  auditorDisagrees: number;
  /** Affected assessments with no sent brief. */
  briefsToSend: number;
  /** Brief rows that exist but aren't sent, summed over events. */
  briefsDrafted: number;
  eventsThisMonth: number;
  correctionsFiled: number;
};

export function dashboardStats(input: {
  events: PolicyEvent[];
  detectedThisMonth: number;
  impacts: Impact[];
  briefs: Brief[];
}): DashboardStats {
  // input.impacts is one current assessment per (rule, client). A brief sent on any run covers the client.
  const sent = sentRuleClientKeys(input.briefs);
  const affected = input.impacts.filter((i) => i.isAffected);
  const unsentAffected = affected.filter((i) => !sent.has(ruleClientKey(i)));
  const rows = deriveAssessmentRows(input.impacts, input.briefs, []);
  return {
    clientsAffected: new Set(affected.map((i) => i.clientId)).size,
    clientsWaiting: new Set(unsentAffected.map((i) => i.clientId)).size,
    actionRequired: countActionRequired(input.impacts, input.briefs),
    auditorDisagrees: rows.filter((r) => r.actionReason === "auditor-disagrees").length,
    briefsToSend: unsentAffected.length,
    briefsDrafted: input.events.reduce((n, e) => n + e.briefsUnsent, 0),
    eventsThisMonth: input.detectedThisMonth,
    correctionsFiled: input.events.reduce((n, e) => n + e.correctionsFiled, 0),
  };
}
