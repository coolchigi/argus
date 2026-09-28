"use client";

import { cn } from "@/lib/utils";

type Props = {
  /** What failed, in plain words. "Couldn't load your assessments." */
  message: string;
  /** Technical detail, shown small in mono. */
  detail?: string | null;
  onRetry?: () => void;
  retrying?: boolean;
  className?: string;
};

/** Per-section error with Retry. The rest of the page keeps working. */
export function InlineError({ message, detail, onRetry, retrying = false, className }: Props) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 border-l-2 border-danger bg-danger-subtle px-4 py-3",
        className,
      )}
    >
      <div className="min-w-0">
        <p className="text-[13px] text-danger-ink">{message}</p>
        {detail && <p className="mt-0.5 font-mono text-[11px] text-ink-2 break-all">{detail}</p>}
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          className="h-7 rounded-sm border border-control bg-surface px-3 text-[12px] text-ink-1 transition-colors hover:bg-sunk disabled:opacity-50"
        >
          {retrying ? "Retrying" : "Retry"}
        </button>
      )}
    </div>
  );
}
