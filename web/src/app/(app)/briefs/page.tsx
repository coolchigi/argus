"use client";

import { useBriefs } from "@/lib/queries";
import { EmptyState } from "@/components/empty-state";

/** The right pane before a brief is picked. The list is in layout.tsx. */
export default function BriefsPage() {
  const q = useBriefs();
  if (q.data && (q.data.briefs ?? []).length === 0) {
    return (
      <EmptyState
        headline="No briefs drafted yet."
        body="Composer writes one for every affected client after a policy change. When Sentinel catches something, drafts appear here for you to edit and send."
      />
    );
  }
  return (
    <EmptyState
      headline="Pick a brief."
      body="Choose one on the left to edit it, copy it into your own email, or send and sign it through Argus. Tick several drafts to send them in one batch."
    />
  );
}
