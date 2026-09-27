import { PageHeader } from "@/components/argus/page-header";
import { EmptyState } from "@/components/empty-state";

// Branch-only placeholder so the sidebar link resolves. Replaced before merge (Phase C).
export default function PolicyEventsPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Policy events" />
      <EmptyState headline="This screen is being built" body="Every IRCC change Argus has checked against your caseload will be listed here." />
    </div>
  );
}
