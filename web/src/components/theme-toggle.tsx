"use client";

import { useTheme, type Theme } from "@/components/theme-provider";
import { cn } from "@/lib/utils";
import { Sun, Moon, Monitor } from "lucide-react";

type ThemeOption = {
  value: Theme;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
};

const OPTIONS: ThemeOption[] = [
  { value: "light", icon: Sun, label: "Light theme" },
  { value: "dark", icon: Moon, label: "Dark theme" },
  { value: "system", icon: Monitor, label: "Match system theme" },
];

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  return (
    <div
      className={cn("inline-grid grid-cols-3 gap-0.5 rounded-sm border border-hairline p-0.5", className)}
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
              "flex h-6 min-w-7 items-center justify-center rounded-[2px] transition-colors",
              active ? "bg-sunk text-ink-1" : "text-ink-3 hover:text-ink-1",
            )}
          >
            <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
        );
      })}
    </div>
  );
}
