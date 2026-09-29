"use client";

import { useId, useState } from "react";
import { Download } from "lucide-react";
import { InlineError } from "@/components/argus/inline-error";
import { PageHeader } from "@/components/argus/page-header";
import { ProgressLine } from "@/components/argus/progress-line";
import { buttonPrimary, fieldClass } from "@/components/caseload/copy";
import { RecordsTable } from "@/components/records/records-table";
import { useExportRecords, useRecords } from "@/components/records/use-records";
import { countKinds, describeCounts, matchingPreset, presetRange, RANGE_PRESETS, rangeError, type DateRange } from "@/lib/records";
import type { ExportResponse } from "@/lib/types/records";
import { cn } from "@/lib/utils";

function startDownload(url: string) {
  // The object carries Content-Disposition: attachment, so the browser saves
  // it and this page stays put.
  const a = document.createElement("a");
  a.href = url;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export default function RecordsPage() {
  const fromId = useId();
  const toId = useId();
  const [range, setRange] = useState<DateRange>(() => presetRange("this-month"));
  const [lastExport, setLastExport] = useState<ExportResponse | null>(null);

  const invalid = rangeError(range);
  const records = useRecords(range, { enabled: invalid === null });
  const exporter = useExportRecords();

  const rows = records.data?.records ?? [];
  const counts = countKinds(rows);
  const preset = matchingPreset(range);
  const showingRange = records.data && records.data.from === range.from && records.data.to === range.to;

  function update(next: Partial<DateRange>) {
    setRange((r) => ({ ...r, ...next }));
    setLastExport(null);
    exporter.reset();
  }

  function download() {
    exporter.mutate(
      { from: range.from, to: range.to, kinds: ["assessments", "briefs"] },
      {
        onSuccess: (res) => {
          setLastExport(res);
          startDownload(res.url);
        },
      },
    );
  }

  const canDownload = invalid === null && showingRange && rows.length > 0 && !exporter.isPending;

  return (
    <div className="space-y-6">
      <ProgressLine active={records.isFetching || exporter.isPending} fixed label="Loading your records" />
      <PageHeader
        title="Records"
        meta={invalid ? "Pick a date range" : records.data ? `${describeCounts(counts)}, ${range.from} to ${range.to} UTC` : "Loading"}
        actions={
          <button type="button" className={buttonPrimary} onClick={download} disabled={!canDownload}>
            <Download aria-hidden className="h-3.5 w-3.5" strokeWidth={1.75} />
            {exporter.isPending ? "Preparing download" : "Download signed records"}
          </button>
        }
      />

      <p className="max-w-prose text-[13px] leading-relaxed text-ink-2">
        Every assessment Argus signed and every brief you sent, with its fingerprint. CICC Client File Management
        Regulation s. 7.2 has you keep these for 6 years after a file closes, so file the download with your own client
        records. It includes a VERIFY.md that shows how to check each signature without Argus. Brief text and recipient
        details stay out of it.
      </p>

      <fieldset className="flex flex-wrap items-end gap-4 border border-hairline bg-card p-4">
        <legend className="sr-only">Date range, in UTC</legend>
        <div>
          <label htmlFor={fromId} className="label mb-1 block">
            From (UTC)
          </label>
          <input
            id={fromId}
            type="date"
            value={range.from}
            max={range.to || undefined}
            onChange={(e) => update({ from: e.target.value })}
            className={cn(fieldClass, "w-[160px] font-mono")}
            aria-invalid={invalid !== null || undefined}
          />
        </div>
        <div>
          <label htmlFor={toId} className="label mb-1 block">
            To (UTC)
          </label>
          <input
            id={toId}
            type="date"
            value={range.to}
            min={range.from || undefined}
            onChange={(e) => update({ to: e.target.value })}
            className={cn(fieldClass, "w-[160px] font-mono")}
            aria-invalid={invalid !== null || undefined}
          />
        </div>
        <div role="group" aria-label="Quick ranges" className="inline-flex gap-1 rounded-sm border border-control p-1">
          {RANGE_PRESETS.map((p) => (
            <button
              key={p.value}
              type="button"
              aria-pressed={preset === p.value}
              onClick={() => update(presetRange(p.value))}
              className={cn(
                "h-7 rounded-[2px] px-3 text-[13px] transition-colors",
                preset === p.value ? "bg-brand-subtle text-ink-1" : "text-ink-2 hover:bg-sunk hover:text-ink-1",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        {invalid && (
          <p role="alert" className="basis-full text-[12px] text-danger-ink">
            {invalid}
          </p>
        )}
      </fieldset>

      {exporter.error && (
        <InlineError
          message="Couldn't build the download. Your records are safe. Try again."
          detail={exporter.error instanceof Error ? exporter.error.message : null}
          retrying={exporter.isPending}
          onRetry={download}
        />
      )}
      {lastExport && (
        <p role="status" className="border-l-2 border-brand bg-brand-subtle px-4 py-3 text-[13px] text-ink-1">
          Downloading {lastExport.fileName} with {describeCounts(lastExport.counts)}. If it didn&rsquo;t start,{" "}
          <a href={lastExport.url} rel="noopener" className="text-brand-ink underline underline-offset-4 hover:text-ink-1">
            use this link
          </a>
          . It works until {formatTime(lastExport.expiresAt)}.
        </p>
      )}

      {records.error ? (
        <InlineError
          message="Couldn't load your records."
          detail={records.error instanceof Error ? records.error.message : null}
          retrying={records.isFetching}
          onRetry={() => void records.refetch()}
        />
      ) : (
        <RecordsTable
          records={invalid ? [] : rows}
          loading={invalid === null && records.isPending}
          empty={invalid ? "Pick a date range to see your records." : "No signed assessments or sent briefs in this range."}
        />
      )}
    </div>
  );
}
