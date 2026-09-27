"use client";

import { Switch as BaseSwitch } from "@base-ui/react/switch";
import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type Props = {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** Visible label. If you leave it out, pass `aria-label`. */
  label?: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  "aria-label"?: string;
  className?: string;
};

/**
 * Base UI Switch. Track off is sunk with a 3:1 control border. Track on is brand
 * amber. Seal-green is never used here.
 */
export function Switch({
  checked,
  onCheckedChange,
  label,
  description,
  disabled,
  "aria-label": ariaLabel,
  className,
}: Props) {
  const labelId = useId();
  const descId = useId();
  const control = (
    <BaseSwitch.Root
      checked={checked}
      onCheckedChange={(next) => onCheckedChange(next)}
      disabled={disabled}
      aria-label={label ? undefined : ariaLabel}
      aria-labelledby={label ? labelId : undefined}
      aria-describedby={description ? descId : undefined}
      className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-control bg-sunk p-0.5 transition-colors data-[checked]:border-brand-ink data-[checked]:bg-brand data-[disabled]:opacity-50"
    >
      <BaseSwitch.Thumb className="block h-3.5 w-3.5 rounded-full bg-ink-2 transition-transform data-[checked]:translate-x-4 data-[checked]:bg-on-brand" />
    </BaseSwitch.Root>
  );
  if (!label) return <span className={className}>{control}</span>;
  return (
    <div className={cn("flex items-start justify-between gap-4", className)}>
      <div className="min-w-0">
        <div id={labelId} className="text-[13px] text-ink-1">
          {label}
        </div>
        {description && (
          <div id={descId} className="mt-0.5 text-[12px] text-ink-2">
            {description}
          </div>
        )}
      </div>
      {control}
    </div>
  );
}
