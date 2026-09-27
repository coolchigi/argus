import { cn } from "@/lib/utils";

/**
 * The Argus brand mark. Amber by default through currentColor.
 * The hexagon Seal stays reserved for signatures, so it never stands in for this.
 */
export function EyeMark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      className={cn("inline-block h-5 w-5 shrink-0 text-brand", className)}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <ellipse cx="10" cy="10" rx="9" ry="5.5" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="10" cy="10" r="2.5" fill="currentColor" />
    </svg>
  );
}
