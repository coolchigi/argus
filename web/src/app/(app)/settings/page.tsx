import { PageHeader } from "@/components/argus/page-header";
import { EmptyState } from "@/components/empty-state";

// Branch-only placeholder so the sidebar link resolves. Replaced before merge (Phase E).
export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Settings" />
      <EmptyState headline="This screen is being built" body="Practice details, program areas, alerts and your signing key will live here." />
    </div>
  );
}
