// Date ranges and links for the records ledger. The API takes inclusive UTC
// dates (YYYY-MM-DD), so every range here is built in UTC too.

import type { LedgerEntry } from "./types/records";

export type DateRange = { from: string; to: string };

export type RangePreset = "this-month" | "last-month" | "this-year";

export const RANGE_PRESETS: Array<{ value: RangePreset; label: string }> = [
  { value: "this-month", label: "This month" },
  { value: "last-month", label: "Last month" },
  { value: "this-year", label: "This year" },
];

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function presetRange(preset: RangePreset, now: Date = new Date()): DateRange {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  switch (preset) {
    case "this-month":
      return { from: ymd(new Date(Date.UTC(y, m, 1))), to: ymd(now) };
    case "last-month":
      return { from: ymd(new Date(Date.UTC(y, m - 1, 1))), to: ymd(new Date(Date.UTC(y, m, 0))) };
    case "this-year":
      return { from: ymd(new Date(Date.UTC(y, 0, 1))), to: ymd(now) };
  }
}

/** The preset a range matches, so its button shows as selected. */
export function matchingPreset(range: DateRange, now: Date = new Date()): RangePreset | null {
  for (const { value } of RANGE_PRESETS) {
    const p = presetRange(value, now);
    if (p.from === range.from && p.to === range.to) return value;
  }
  return null;
}

function isDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && ymd(d) === s;
}

/** Null when the range is usable, else a message for the consultant. */
export function rangeError(range: DateRange): string | null {
  if (!isDate(range.from) || !isDate(range.to)) return "Pick a start and end date.";
  if (range.from > range.to) return "The start date is after the end date.";
  return null;
}

/** Where a ledger row opens inside Argus. */
export function recordHref(r: LedgerEntry): string {
  return r.kind === "assessment" ? `/impacts/${encodeURIComponent(r.id)}` : `/briefs/${encodeURIComponent(r.id)}`;
}

/**
 * The public receipt only resolves assessment hashes (it looks them up by
 * canonicalHash on ImpactAssessments), so briefs get no receipt link.
 */
export function receiptHref(r: LedgerEntry): string | undefined {
  return r.kind === "assessment" && r.signed ? `/verify/${r.canonicalHash}` : undefined;
}

/** What a ledger row is, in the words the Records page and receipts use. */
export function recordLabel(r: Pick<LedgerEntry, "kind" | "recordKind">): string {
  if (r.kind === "brief") return "Sent brief";
  return r.recordKind === "consultant-review" ? "Consultant review" : "Assessment";
}

/** `assessments` counts every signed assessment record, consultant reviews included, as the export does. */
export function countKinds(records: LedgerEntry[]): { assessments: number; consultantReviews: number; briefs: number } {
  let assessments = 0;
  let consultantReviews = 0;
  for (const r of records) {
    if (r.kind !== "assessment") continue;
    assessments += 1;
    if (r.recordKind === "consultant-review") consultantReviews += 1;
  }
  return { assessments, consultantReviews, briefs: records.length - assessments };
}

export function describeCounts(c: { assessments: number; consultantReviews?: number; briefs: number }): string {
  const reviews = c.consultantReviews ?? 0;
  const a = `${c.assessments} signed ${c.assessments === 1 ? "assessment" : "assessments"}`;
  const r = reviews > 0 ? ` (${reviews} ${reviews === 1 ? "is your review" : "are your reviews"})` : "";
  const b = `${c.briefs} sent ${c.briefs === 1 ? "brief" : "briefs"}`;
  return `${a}${r}, ${b}`;
}
