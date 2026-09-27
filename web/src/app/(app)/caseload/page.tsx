import { PageHeader } from "@/components/argus/page-header";
import { EmptyState } from "@/components/empty-state";

// Branch-only placeholder so the sidebar link resolves. Replaced before merge (Phase F).
export default function CaseloadPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Client caseload" />
      <EmptyState headline="This screen is being built" body="Your clients, by case number, with what each change means for them, will be listed here." />
    </div>
  );
}
