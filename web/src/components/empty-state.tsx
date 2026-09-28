import type { ReactNode } from "react";
import { EyeMark } from "@/components/argus/eye-mark";

type Props = {
  headline: string;
  body: string;
  action?: ReactNode;
};

/**
 * Plain empty state. Static mark, Plex Serif headline, one line of body.
 * The hexagon stays reserved for signatures, so it isn't used here.
 */
export function EmptyState({ headline, body, action }: Props) {
  return (
    <div className="flex flex-col items-center py-20 text-center">
      <EyeMark className="h-10 w-10 text-ink-3" />
      <h2 className="mt-6 font-display text-[20px] leading-tight text-ink-1">{headline}</h2>
      <p className="mt-2 max-w-[400px] text-[13px] leading-relaxed text-ink-2">{body}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
