import { Badge } from "@/components/argus/status-badge";
import type { ActionReason } from "@/lib/argus-types";
import { ACTION_REASON_LABEL, ACTION_REASON_TONE, isAuditorFlag } from "@/lib/assessments";

/**
 * The badge for a reason that asks the consultant to settle the verdict:
 * "Auditor disagrees" or "Auditor unsure". Nothing for any other reason.
 */
export function AuditorFlagBadge({ reason, count }: { reason: ActionReason | null | undefined; count?: number }) {
  if (!isAuditorFlag(reason)) return null;
  return (
    <Badge tone={ACTION_REASON_TONE[reason]}>
      {ACTION_REASON_LABEL[reason]}
      {count !== undefined && count > 1 ? ` · ${count}` : ""}
    </Badge>
  );
}
