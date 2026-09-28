"use client";

import { buttonPrimary, buttonSecondary } from "@/components/caseload/copy";

type Props = {
  count: number;
  saving: boolean;
  blocked: boolean;
  error: string | null;
  onSave: () => void;
  onDiscard: () => void;
};

/** Pinned to the bottom of the content while the form has unsaved changes. */
export function SaveBar({ count, saving, blocked, error, onSave, onDiscard }: Props) {
  if (count === 0) return null;
  return (
    <div
      role="region"
      aria-label="Unsaved changes"
      className="sticky bottom-0 z-20 -mx-4 border-t border-hairline bg-surface/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0" aria-live="polite">
          <p className="text-[13px] text-ink-1">
            You&rsquo;ve got {count} unsaved {count === 1 ? "change" : "changes"}.
          </p>
          {error && <p className="mt-0.5 text-[12px] text-danger-ink">{error}</p>}
          {!error && blocked && <p className="mt-0.5 text-[12px] text-danger-ink">Fix the highlighted field to save.</p>}
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className={buttonSecondary} onClick={onDiscard} disabled={saving}>
            Discard
          </button>
          <button type="button" className={buttonPrimary} onClick={onSave} disabled={saving || blocked}>
            {saving ? "Saving" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
