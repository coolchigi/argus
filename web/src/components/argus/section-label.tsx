import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type Props = {
  children: ReactNode;
  as?: "h2" | "h3" | "h4" | "div" | "span" | "p";
  id?: string;
  className?: string;
};

/** Mono, 11px, tracked, uppercase. The small label above a block of content. */
export function SectionLabel({ children, as: Tag = "div", id, className }: Props) {
  return (
    <Tag id={id} className={cn("label", className)}>
      {children}
    </Tag>
  );
}
