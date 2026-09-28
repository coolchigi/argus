"use client";

import { useId, useMemo, useState } from "react";
import { Plus, Upload } from "lucide-react";
import { FilterBar } from "@/components/argus/filter-bar";
import { InlineError } from "@/components/argus/inline-error";
import { PageHeader } from "@/components/argus/page-header";
import { ProgressLine } from "@/components/argus/progress-line";
import { Switch } from "@/components/argus/switch";
import { AddClientDialog } from "@/components/caseload/add-client-dialog";
import { CaseloadTable } from "@/components/caseload/caseload-table";
import { PII_WARNING, buttonPrimary, buttonSecondary } from "@/components/caseload/copy";
import { ImportDialog } from "@/components/caseload/import-dialog";
import { EmptyState } from "@/components/empty-state";
import { POLICY_DOMAIN_LABELS, humanizePolicyDomain, type PolicyDomain } from "@/lib/humanize";
import { useProfiles } from "@/lib/queries";
import type { ClientSummary } from "@/lib/types/profiles";

type StatusFilter = "all" | "active" | "submitted" | "closed";

const STATUS_FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "submitted", label: "Submitted" },
  { value: "closed", label: "Closed" },
];

function matches(c: ClientSummary, q: string): boolean {
  if (!q) return true;
  const hay = [c.clientId, humanizePolicyDomain(c.program), c.nocCode ?? ""].join(" ").toLowerCase();
  return hay.includes(q);
}

export default function CaseloadPage() {
  const profiles = useProfiles();
  const programId = useId();

  const [search, setSearch] = useState("");
  const [program, setProgram] = useState<"all" | PolicyDomain>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [needsAction, setNeedsAction] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const all = useMemo(() => profiles.data?.clients ?? [], [profiles.data]);
  const needsActionCount = useMemo(() => all.filter((c) => c.unsentBriefs > 0).length, [all]);
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all
      .filter((c) => status === "all" || c.status === status)
      .filter((c) => program === "all" || c.program === program)
      .filter((c) => !needsAction || c.unsentBriefs > 0)
      .filter((c) => matches(c, q));
  }, [all, search, program, status, needsAction]);

  const filtered = search.trim() !== "" || program !== "all" || status !== "all" || needsAction;
  const fresh = profiles.data !== undefined && profiles.data.total === 0;

  const actions = (
    <>
      <button type="button" className={buttonSecondary} onClick={() => setAddOpen(true)}>
        <Plus aria-hidden className="h-3.5 w-3.5" strokeWidth={1.75} />
        Add client
      </button>
      <button type="button" className={buttonPrimary} onClick={() => setImportOpen(true)}>
        <Upload aria-hidden className="h-3.5 w-3.5" strokeWidth={1.75} />
        Import CSV
      </button>
    </>
  );

  const dialogs = (
    <>
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} />
      <AddClientDialog open={addOpen} onOpenChange={setAddOpen} />
    </>
  );

  if (fresh) {
    return (
      <div className="space-y-6">
        <PageHeader title="Client caseload" />
        <EmptyState
          headline="No clients yet."
          body={`Import your caseload and Argus checks every IRCC change against it. ${PII_WARNING}`}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <button type="button" className={buttonPrimary} onClick={() => setImportOpen(true)}>
                <Upload aria-hidden className="h-3.5 w-3.5" strokeWidth={1.75} />
                Import CSV
              </button>
              <button type="button" className={buttonSecondary} onClick={() => setAddOpen(true)}>
                Add one client
              </button>
            </div>
          }
        />
        {dialogs}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <ProgressLine active={profiles.isFetching} fixed label="Loading your caseload" />
      <PageHeader
        title="Client caseload"
        meta={
          profiles.data
            ? `${profiles.data.total} ${profiles.data.total === 1 ? "client" : "clients"}, ${needsActionCount} with briefs to send`
            : "Loading"
        }
        actions={actions}
      />

      {profiles.error ? (
        <InlineError
          message="Couldn't load your caseload."
          detail={profiles.error instanceof Error ? profiles.error.message : null}
          retrying={profiles.isFetching}
          onRetry={() => void profiles.refetch()}
        />
      ) : (
        <div>
          <FilterBar
            className="border border-b-0 border-hairline sm:px-4"
            search={search}
            onSearchChange={setSearch}
            searchLabel="Search clients"
            searchPlaceholder="Case number, program or NOC"
            filters={STATUS_FILTERS}
            filter={status}
            onFilterChange={(v) => setStatus(v as StatusFilter)}
            filterLabel="Client status"
            count={profiles.data ? `${rows.length} of ${all.length}` : undefined}
          >
            <div className="flex items-center gap-2">
              <label htmlFor={programId} className="sr-only">
                Program
              </label>
              <select
                id={programId}
                value={program}
                onChange={(e) => setProgram(e.target.value as "all" | PolicyDomain)}
                className="h-8 rounded-sm border border-control bg-sunk px-2 text-[13px] text-ink-1"
              >
                <option value="all">All programs</option>
                {(Object.keys(POLICY_DOMAIN_LABELS) as PolicyDomain[]).map((p) => (
                  <option key={p} value={p}>
                    {POLICY_DOMAIN_LABELS[p]}
                  </option>
                ))}
              </select>
            </div>
            <Switch checked={needsAction} onCheckedChange={setNeedsAction} label="Needs action" className="items-center gap-2" />
          </FilterBar>
          <CaseloadTable
            clients={rows}
            loading={profiles.isPending}
            empty={
              filtered ? (
                <span>
                  No clients match these filters.{" "}
                  <button
                    type="button"
                    className="text-brand-ink underline underline-offset-4"
                    onClick={() => {
                      setSearch("");
                      setProgram("all");
                      setStatus("all");
                      setNeedsAction(false);
                    }}
                  >
                    Clear filters
                  </button>
                </span>
              ) : (
                "No clients to show."
              )
            }
          />
        </div>
      )}
      {dialogs}
    </div>
  );
}
