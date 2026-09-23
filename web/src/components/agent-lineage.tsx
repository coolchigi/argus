"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The five-agent chain, rendered as an inline chip row.
 * Section 8c of the design brief. Human-readable by default;
 * model IDs live behind a "How this was reviewed" disclosure.
 */

type Agent = {
  name: string;
  role: string;
  model: string;
  family: "amazon" | "anthropic" | "aws";
};

const CHAIN: Agent[] = [
  { name: "Sentinel", role: "Watches IRCC pages hourly", model: "us.amazon.nova-micro-v1:0", family: "amazon" },
  { name: "Analyst", role: "Reasons per client", model: "us.amazon.nova-pro-v1:0", family: "amazon" },
  { name: "Auditor", role: "Adversarial review", model: "us.anthropic.claude-haiku-4-5-20251001-v1:0", family: "anthropic" },
  { name: "Anchor", role: "Signs and archives", model: "AWS KMS ECDSA P-256", family: "aws" },
  { name: "Composer", role: "Drafts client email", model: "us.amazon.nova-lite-v1:0", family: "amazon" },
];

export function AgentLineage() {
  const [open, setOpen] = useState(false);
  const crossFamily = CHAIN[1].family !== CHAIN[2].family;

  return (
    <div className="rounded-md border border-border bg-surface">
      <div className="flex items-center gap-1 flex-wrap px-4 py-3">
        {CHAIN.map((agent, i) => (
          <span key={agent.name} className="flex items-center gap-1">
            <span className="text-[12px] font-medium text-ink-primary">{agent.name}</span>
            {i < CHAIN.length - 1 && (
              <span className="text-ink-tertiary text-[12px] mx-1.5" aria-hidden>
                ▸
              </span>
            )}
          </span>
        ))}
        {crossFamily && (
          <span className="ml-3 inline-flex items-center gap-1 rounded-sm bg-seal-subtle px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-seal">
            Cross-family
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between border-t border-border px-4 py-2 text-[11px] text-ink-secondary hover:text-ink-primary transition-colors"
      >
        <span>How this was reviewed</span>
        {open ? (
          <ChevronDown className="h-3 w-3" strokeWidth={1.75} />
        ) : (
          <ChevronRight className="h-3 w-3" strokeWidth={1.75} />
        )}
      </button>
      {open && (
        <ul className="border-t border-border px-4 py-3 space-y-2">
          {CHAIN.map((agent) => (
            <li key={agent.name} className="grid grid-cols-[100px_1fr_auto] gap-3 items-baseline">
              <span className="text-[12px] font-medium text-ink-primary">{agent.name}</span>
              <span className="text-[12px] text-ink-secondary">{agent.role}</span>
              <span className={cn("fingerprint", "text-[11px]")}>{agent.model}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
