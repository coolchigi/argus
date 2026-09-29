import type { PublicStats } from "./types/public.ts";

/**
 * The landing page's activity line, or null when there's nothing to show.
 * The line only appears when at least one assessment was signed in the last
 * 7 days, so the page never advertises a zero.
 */
export function statsLine(stats: PublicStats | null | undefined): string | null {
  if (!stats) return null;
  const signed = whole(stats.assessmentsSigned7d);
  const sent = whole(stats.briefsSent7d);
  if (signed === 0) return null;
  const a = `${signed.toLocaleString("en-CA")} ${signed === 1 ? "assessment" : "assessments"} signed`;
  if (sent === 0) return `${a} in the last 7 days`;
  return `${a} and ${sent.toLocaleString("en-CA")} ${sent === 1 ? "brief" : "briefs"} sent in the last 7 days`;
}

function whole(n: unknown): number {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}
