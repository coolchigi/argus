import type { Correction } from "@/lib/types/corrections";
import { humanizeImpactType } from "@/lib/humanize";
import { formatDelta } from "@/lib/format";

const verdict = (affected: boolean) => (affected ? "Affected" : "Not affected");

/** "Not affected to Affected · Procedural change to Eligibility changed · +0 pts to −12 pts". Only the parts that changed. */
export function CorrectionChange({ c }: { c: Correction }) {
  const verdictChanged =
    typeof c.correctedIsAffected === "boolean" && typeof c.originalIsAffected === "boolean" && c.correctedIsAffected !== c.originalIsAffected;
  const typeChanged = c.originalImpactType !== c.correctedImpactType;
  const deltaChanged = (c.originalNumericDelta ?? null) !== (c.correctedNumericDelta ?? null);
  if (!verdictChanged && !typeChanged && !deltaChanged) return <p className="text-[12px] text-ink-2">Wording or confidence corrected</p>;
  return (
    <p className="text-[12px] text-ink-2">
      {verdictChanged && (
        <>
          <span className="line-through decoration-ink-3">{verdict(c.originalIsAffected as boolean)}</span>
          <span aria-hidden> to </span>
          <span className="sr-only"> changed to </span>
          <span className="font-medium text-ink-1">{verdict(c.correctedIsAffected as boolean)}</span>
        </>
      )}
      {verdictChanged && (typeChanged || deltaChanged) && <span aria-hidden> · </span>}
      {typeChanged && (
        <>
          <span className="line-through decoration-ink-3">{humanizeImpactType(c.originalImpactType)}</span>
          <span aria-hidden> to </span>
          <span className="sr-only"> changed to </span>
          <span className="text-ink-1">{humanizeImpactType(c.correctedImpactType)}</span>
        </>
      )}
      {typeChanged && deltaChanged && <span aria-hidden> · </span>}
      {deltaChanged && (
        <span className="font-mono tabular">
          {formatDelta(c.originalNumericDelta)} to <span className="text-ink-1">{formatDelta(c.correctedNumericDelta)}</span>
        </span>
      )}
    </p>
  );
}
