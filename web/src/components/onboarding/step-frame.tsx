import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { InlineError } from "@/components/argus/inline-error";
import { buttonPrimary, buttonSecondary } from "@/components/caseload/copy";

/** Heading, body and the Back / Continue row every step shares. */
export function StepFrame({
  title,
  description,
  children,
  error,
  onBack,
  actions,
}: {
  title: string;
  description: ReactNode;
  children: ReactNode;
  /** A failed save, in plain words. */
  error?: string | null;
  onBack?: () => void;
  /** The step's forward buttons, right-aligned. */
  actions: ReactNode;
}) {
  return (
    <section aria-labelledby="onboarding-step-title" className="space-y-6">
      <div className="space-y-2">
        <h1 id="onboarding-step-title" tabIndex={-1} className="font-display text-[28px] leading-tight text-ink-1 outline-none">
          {title}
        </h1>
        <div className="max-w-prose text-[14px] leading-relaxed text-ink-2">{description}</div>
      </div>
      {children}
      {error && <InlineError message={error} />}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline pt-5">
        {onBack ? (
          <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-[13px] text-ink-2 hover:text-ink-1">
            <ArrowLeft aria-hidden className="h-3.5 w-3.5" strokeWidth={1.75} />
            Back
          </button>
        ) : (
          <span />
        )}
        <div className="flex flex-wrap items-center justify-end gap-2">{actions}</div>
      </div>
    </section>
  );
}

export function ContinueButton({
  onClick,
  disabled,
  saving,
  children = "Continue",
}: {
  onClick: () => void;
  disabled?: boolean;
  saving: boolean;
  children?: ReactNode;
}) {
  return (
    <button type="button" className={buttonPrimary} onClick={onClick} disabled={disabled || saving}>
      {saving ? "Saving" : children}
    </button>
  );
}

export function LaterButton({ onClick, saving, children }: { onClick: () => void; saving: boolean; children: ReactNode }) {
  return (
    <button type="button" className={buttonSecondary} onClick={onClick} disabled={saving}>
      {children}
    </button>
  );
}
