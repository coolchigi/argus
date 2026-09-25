"use client";

import { useTheme } from "@/components/theme-provider";
import { cn } from "@/lib/utils";
import { Sun, Moon, Monitor } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Theme = "light" | "dark" | "system";

type Option = {
  value: Theme;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
};

const OPTIONS: Option[] = [
  { value: "light", icon: Sun, label: "Light" },
  { value: "dark", icon: Moon, label: "Dark" },
  { value: "system", icon: Monitor, label: "System" },
];

// Two shapes for two contexts.
// `menu` lives in the site header (compact, single icon, dropdown).
// `segmented` lives in the app sidebar footer (three explicit options, per BRIEF Section 1a).
export function ThemeToggle({
  variant = "menu",
  className,
}: {
  variant?: "menu" | "segmented";
  className?: string;
}) {
  if (variant === "segmented") return <SegmentedThemeToggle className={className} />;
  return <MenuThemeToggle className={className} />;
}

function MenuThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const TriggerIcon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;
  const currentLabel = OPTIONS.find((o) => o.value === theme)?.label ?? "Theme";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Theme, ${currentLabel}`}
        className={cn(
          "inline-flex h-8 w-8 items-center justify-center rounded-sm text-ink-secondary transition-colors",
          "hover:bg-surface-alt hover:text-ink-primary",
          "focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-border-strong focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
          "data-popup-open:bg-surface-alt data-popup-open:text-ink-primary",
          className,
        )}
      >
        <TriggerIcon className="h-4 w-4" strokeWidth={1.5} aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className="min-w-[160px] rounded-md border border-border bg-surface p-1 text-ink-primary shadow-none ring-0"
      >
        <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as Theme)}>
          {OPTIONS.map((o) => {
            const Icon = o.icon;
            const active = theme === o.value;
            return (
              <DropdownMenuRadioItem
                key={o.value}
                value={o.value}
                className={cn(
                  "flex h-8 items-center gap-2 rounded-[3px] py-0 pl-2 pr-8 text-[13px]",
                  active ? "text-ink-primary" : "text-ink-secondary",
                  "focus:bg-surface-alt focus:text-ink-primary",
                )}
              >
                <Icon className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden />
                <span>{o.label}</span>
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SegmentedThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  return (
    <div
      className={cn(
        "grid grid-cols-3 gap-0.5 rounded-md border border-border bg-surface-sunk p-0.5",
        className,
      )}
      role="radiogroup"
      aria-label="Theme"
    >
      {OPTIONS.map((o) => {
        const Icon = o.icon;
        const active = theme === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={o.label}
            title={o.label}
            onClick={() => setTheme(o.value)}
            className={cn(
              "flex h-7 items-center justify-center rounded-[3px] transition-colors",
              "focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-border-strong focus-visible:ring-offset-1 focus-visible:ring-offset-canvas",
              active
                ? "bg-surface text-ink-primary shadow-[inset_0_0_0_1px_var(--border)]"
                : "text-ink-tertiary hover:text-ink-primary",
            )}
          >
            <Icon className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden />
          </button>
        );
      })}
    </div>
  );
}
