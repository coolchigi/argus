"use client";

import { Tabs as BaseTabs } from "@base-ui/react/tabs";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** Base UI Tabs with Argus styling. Active tab gets a 2px brand-ink underline. */
export function Tabs({ className, ...props }: Omit<ComponentProps<typeof BaseTabs.Root>, "className"> & { className?: string }) {
  return <BaseTabs.Root className={cn("w-full", className)} {...props} />;
}

export function TabsList({ className, ...props }: Omit<ComponentProps<typeof BaseTabs.List>, "className"> & { className?: string }) {
  return (
    <BaseTabs.List
      className={cn("flex items-end gap-1 border-b border-hairline", className)}
      {...props}
    />
  );
}

export function Tab({ className, ...props }: Omit<ComponentProps<typeof BaseTabs.Tab>, "className"> & { className?: string }) {
  return (
    <BaseTabs.Tab
      className={cn(
        "-mb-px inline-flex h-9 items-center gap-2 border-b-2 border-transparent px-3 text-[13px] text-ink-2 transition-colors hover:text-ink-1 data-[active]:border-brand-ink data-[active]:text-ink-1 data-[active]:font-medium",
        className,
      )}
      {...props}
    />
  );
}

export function TabsPanel({ className, ...props }: Omit<ComponentProps<typeof BaseTabs.Panel>, "className"> & { className?: string }) {
  return <BaseTabs.Panel className={cn("pt-4", className)} {...props} />;
}
