import { cn } from "@/lib/utils";

/**
 * The Argus seal glyph. Reserved for signature affordances only.
 * See web/design/BRIEF.md Section 11.
 */
export function Seal({ className, filled = true }: { className?: string; filled?: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={cn("inline-block", className)}
      aria-hidden
    >
      {filled ? (
        <>
          <path
            d="M8 1.2 13.6 4.4v7.2L8 14.8 2.4 11.6V4.4L8 1.2Z"
            fill="currentColor"
          />
          <circle cx="8" cy="8" r="2.2" fill="var(--surface)" />
        </>
      ) : (
        <path
          d="M8 1.2 13.6 4.4v7.2L8 14.8 2.4 11.6V4.4L8 1.2Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
        />
      )}
    </svg>
  );
}
