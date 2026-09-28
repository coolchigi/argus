import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type Props = {
  children: ReactNode;
  as?: "h2" | "h3" | "h4" | "div" | "span" | "p" | "label";
  id?: string;
  /** Only used when `as="label"`, to point at the field. */
  htmlFor?: string;
  className?: string;
};

/**
 * Mono, 11px, tracked, uppercase. The small label above a block of content.
 * Use `as="label"` for form fields: shadcn's Label sets text-sm, which beats `.label`.
 */
export function SectionLabel({ children, as: Tag = "div", id, htmlFor, className }: Props) {
  if (Tag === "label") {
    return (
      <label id={id} htmlFor={htmlFor} className={cn("label block", className)}>
        {children}
      </label>
    );
  }
  return (
    <Tag id={id} className={cn("label", className)}>
      {children}
    </Tag>
  );
}
