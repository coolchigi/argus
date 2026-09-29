import type { Correction } from "@/lib/types/corrections";
import { humanizeImpactType } from "@/lib/humanize";
import { formatDelta } from "@/lib/format";

/** "Procedural change to Eligibility changed · +0 pts to −12 pts". Only the parts that changed. */
export function CorrectionChange({ c }: { c: Correction }) {
  const typeChanged = c.originalImpactType !== c.correctedImpactType;
  const deltaChanged = (c.originalNumericDelta ?? null) !== (c.correctedNumericDelta ?? null);
  if (!typeChanged && !deltaChanged) return <p className="text-[12px] text-ink-2">Wording or confidence corrected</p>;
  return (
    <p className="text-[12px] text-ink-2">
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
