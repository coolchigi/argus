import { Check } from "lucide-react";
import { ONBOARDING_STEPS } from "@/lib/onboarding";
import { cn } from "@/lib/utils";

/**
 * 01 to 04 across the top. The current step gets the amber rail. Steps behind
 * you get a check in ink: seal-green stays reserved for verified signatures.
 */
export function Stepper({ current }: { current: number }) {
  return (
    <ol aria-label="Setup steps" className="grid grid-cols-4 gap-2">
      {ONBOARDING_STEPS.map(({ step, title }) => {
        const state = step < current ? "done" : step === current ? "current" : "todo";
        return (
          <li
            key={step}
            aria-current={state === "current" ? "step" : undefined}
            className={cn("border-t-2 pt-2", state === "current" ? "border-brand" : state === "done" ? "border-ink-3" : "border-hairline")}
          >
            <span className={cn("flex items-center gap-1.5 font-mono text-[11px] tabular", state === "todo" ? "text-ink-3" : "text-ink-2")}>
              {String(step).padStart(2, "0")}
              {state === "done" && <Check aria-label="done" className="h-3 w-3" strokeWidth={2} />}
            </span>
            <span
              className={cn(
                "mt-0.5 block text-[12px] leading-snug",
                state === "current" ? "text-ink-1" : "hidden text-ink-2 sm:block",
              )}
            >
              {title}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
