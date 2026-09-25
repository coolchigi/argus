"use client";

import { useTheme } from "@/components/theme-provider";
import { cn } from "@/lib/utils";
import { Sun, Moon, Monitor } from "lucide-react";

type ThemeOption = {
  value: "light" | "dark" | "system";
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
};

const OPTIONS: ThemeOption[] = [
  { value: "light", icon: Sun, label: "Light" },
  { value: "dark", icon: Moon, label: "Dark" },
  { value: "system", icon: Monitor, label: "System" },
];

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  return (
    <div
      className={cn(
        "grid grid-cols-3 gap-0.5 rounded-sm border border-border p-0.5",
        className,
      )}
      role="group"
      aria-label="Theme"
    >
      {OPTIONS.map((o) => {
        const Icon = o.icon;
        const active = theme === o.value;
        return (
          <button
            key={o.value}
            type="button"
            title={o.label}
            aria-label={o.label}
            aria-pressed={active}
            onClick={() => setTheme(o.value)}
            className={cn(
              "flex h-6 items-center justify-center rounded-[3px] transition-colors",
              active ? "bg-surface-alt text-ink-primary" : "text-ink-tertiary hover:text-ink-primary",
            )}
          >
            <Icon className="h-3 w-3" strokeWidth={1.75} />
          </button>
        );
      })}
    </div>
  );
}
