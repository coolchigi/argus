"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { InlineError } from "@/components/argus/inline-error";
import { PageHeader } from "@/components/argus/page-header";
import { ProgressLine } from "@/components/argus/progress-line";
import { buttonPrimary } from "@/components/caseload/copy";
import { Checklist, CompleteSummary } from "@/components/setup/checklist";
import { useSetupProgress } from "@/components/setup/use-setup-progress";
import { useMe } from "@/lib/queries";

export default function SetupPage() {
  const me = useMe();
  const setup = useSetupProgress();
  const next = setup?.items.find((i) => !i.done) ?? null;

  return (
    <div className="max-w-3xl space-y-6">
      <ProgressLine active={me.isFetching} fixed label="Loading your setup" />
      <PageHeader
        title="Setup guide"
        meta={setup ? (setup.complete ? "Setup complete" : `${setup.done} of ${setup.total} done`) : "Loading"}
      />
      <p className="max-w-prose text-[13px] leading-relaxed text-ink-2">
        What Argus needs before it can watch IRCC for your caseload. Each step links straight to where you finish it.
      </p>

      {me.error ? (
        <InlineError
          message="Couldn't load your setup."
          detail={me.error instanceof Error ? me.error.message : null}
          retrying={me.isFetching}
          onRetry={() => void me.refetch()}
        />
      ) : !me.data || !setup ? (
        <PlaceholderRows />
      ) : setup.complete ? (
        <CompleteSummary me={me.data} items={setup.items} />
      ) : (
        <Checklist me={me.data} items={setup.items} />
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline pt-5">
        <Link href="/dashboard" className="text-[13px] text-ink-2 hover:text-ink-1">
          Back to dashboard
        </Link>
        {setup && (setup.complete || !next) ? (
          <Link href="/dashboard" className={buttonPrimary}>
            Go to your dashboard
            <ArrowRight aria-hidden className="h-3.5 w-3.5" strokeWidth={1.75} />
          </Link>
        ) : next ? (
          <span className="text-[13px] text-ink-2">
            Next: <span className="text-ink-1">{next.title}</span>
          </span>
        ) : null}
      </div>
    </div>
  );
}

function PlaceholderRows() {
  return (
    <ol aria-hidden className="divide-y divide-hairline border border-hairline bg-card">
      {[0, 1, 2, 3, 4].map((i) => (
        <li key={i} className="flex items-start gap-4 px-5 py-4">
          <span className="mt-0.5 h-4 w-4 rounded-full bg-sunk" />
          <div className="flex-1 space-y-2">
            <div className="h-3.5 w-40 bg-sunk" />
            <div className="h-3 w-64 max-w-full bg-sunk" />
          </div>
        </li>
      ))}
    </ol>
  );
}
