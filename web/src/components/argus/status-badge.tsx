import { cn } from "@/lib/utils";

export type BadgeTone = "neutral" | "brand" | "danger" | "seal";

const TONE: Record<BadgeTone, string> = {
  neutral: "bg-sunk text-ink-2",
  brand: "bg-brand-subtle text-brand-ink",
  danger: "bg-danger-subtle text-danger-ink",
  // Signed or verified only. Nothing else gets seal-green.
  seal: "bg-seal-subtle text-seal-ink",
};

type Spec = { label: string; tone: BadgeTone };

/** Derived states. None of these are stored enums, see PHASE8_PLAN section 1b. */
const STATUS = {
  event: {
    "action-required": { label: "Action required", tone: "brand" },
    reviewing: { label: "Reviewing", tone: "neutral" },
    done: { label: "Done", tone: "neutral" },
    "no-impact": { label: "No impact", tone: "neutral" },
    corrected: { label: "Corrected", tone: "danger" },
  },
  assessment: {
    "action-required": { label: "Action required", tone: "brand" },
    done: { label: "Done", tone: "neutral" },
    corrected: { label: "Corrected", tone: "danger" },
    "no-impact": { label: "No impact", tone: "neutral" },
  },
  brief: {
    draft: { label: "Draft", tone: "neutral" },
    edited: { label: "Edited", tone: "brand" },
    sent: { label: "Sent", tone: "neutral" },
    "sent-externally": { label: "Copied", tone: "neutral" },
    failed: { label: "Failed", tone: "danger" },
  },
  client: {
    active: { label: "Active", tone: "neutral" },
    closed: { label: "Closed", tone: "neutral" },
    "needs-action": { label: "Needs action", tone: "danger" },
  },
  severity: {
    high: { label: "High", tone: "danger" },
    medium: { label: "Medium", tone: "brand" },
    low: { label: "Low", tone: "neutral" },
  },
  signature: {
    signed: { label: "Signed", tone: "seal" },
    verified: { label: "Verified", tone: "seal" },
    invalid: { label: "Signature invalid", tone: "danger" },
    unsigned: { label: "Not signed", tone: "neutral" },
  },
} as const satisfies Record<string, Record<string, Spec>>;

type StatusMap = typeof STATUS;
export type StatusKind = keyof StatusMap;

type Props = {
  [K in StatusKind]: {
    kind: K;
    status: keyof StatusMap[K];
    dot?: boolean;
    className?: string;
  };
}[StatusKind];

/** Mono uppercase pill. Colour comes from the tone, the dot is static. */
export function StatusBadge({ kind, status, dot = false, className }: Props) {
  const spec = (STATUS[kind] as Record<string, Spec>)[status as string];
  if (!spec) return null;
  return <Badge tone={spec.tone} dot={dot} className={className}>{spec.label}</Badge>;
}

export function Badge({
  tone = "neutral",
  dot = false,
  className,
  children,
}: {
  tone?: BadgeTone;
  dot?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm px-1.5 py-0.5 font-mono text-[11px] font-medium uppercase leading-none tracking-[0.08em] whitespace-nowrap",
        TONE[tone],
        className,
      )}
    >
      {dot && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}
