import Link from "next/link";
import { formatRelative } from "@/lib/format";
import { parseCorrectionKey } from "@/lib/lineage";

/**
 * The corrections the Auditor used as few-shot examples on this assessment,
 * from its recorded step. PERFORMATIVE.md Section 3c. Each one links to the
 * assessment it corrected, where that correction history lives.
 *
 * Renders nothing when the Auditor used none, or for records signed before
 * the Auditor recorded which corrections it read.
 */
export function LearnedFromYou({ correctionKeys }: { correctionKeys: string[] }) {
  const corrections = correctionKeys.flatMap((key) => {
    const parsed = parseCorrectionKey(key);
    return parsed ? [{ key, ...parsed }] : [];
  });
  if (corrections.length === 0) return null;

  const n = corrections.length;
  return (
    <section aria-labelledby="learned-from-you" className="rounded-md border border-border bg-surface px-4 py-3">
      <h2 id="learned-from-you" className="font-mono text-[11px] uppercase tracking-wider text-brand-ink">
        ↺ Learned from you
      </h2>
      <p className="mt-1 text-[13px] text-ink-secondary">
        The Auditor used {n === 1 ? "1 of your corrections" : `${n} of your corrections`} as{" "}
        {n === 1 ? "an example" : "examples"} when it reviewed this assessment.
      </p>
      <ul className="mt-2 space-y-1">
        {corrections.map((c) => (
          <li key={c.key} className="text-[12px]">
            <Link
              href={`/impacts/${encodeURIComponent(c.assessmentKey)}#corrections`}
              className="text-ink-primary underline decoration-ink-3 underline-offset-2 hover:decoration-ink-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              Your correction on {c.clientId}
            </Link>
            <span className="text-ink-2">
              {" · "}
              <time dateTime={c.correctedAt}>{formatRelative(c.correctedAt)}</time>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
