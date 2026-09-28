import { PageHeader } from "@/components/argus/page-header";
import { EmptyState } from "@/components/empty-state";

// Branch-only placeholder so the sidebar link resolves. Replaced before merge (Phase D).
export default function SetupPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Setup guide" />
      <EmptyState headline="This screen is being built" body="A short checklist to get Argus watching IRCC for your caseload will live here." />
    </div>
  );
}
