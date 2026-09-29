"use client";

import { useId, useMemo, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { InlineError } from "@/components/argus/inline-error";
import { SectionLabel } from "@/components/argus/section-label";
import { useBulkImport } from "@/lib/queries";
import type { BulkResponse, BulkRow } from "@/lib/types/profiles";
import {
  CONSENT_LABEL,
  PII_WARNING,
  buttonPrimary,
  buttonSecondary,
  describeFileError,
  describeRowError,
  fileErrorFrom,
} from "./copy";
import { MAX_IMPORT_ROWS, TEMPLATE_CSV, parseImport } from "./csv";

const MAX_FILE_BYTES = 1_000_000;

type FileError = { error: string; columns?: string[]; count?: number; received?: number; max?: number; rows?: number[] };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** The caseload page's import. Each opening starts from a clean panel. */
export function ImportDialog({ open, onOpenChange }: Props) {
  const [session, setSession] = useState(0);
  const close = () => {
    setSession((n) => n + 1);
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] gap-5 overflow-y-auto rounded-md border border-hairline bg-surface p-6 sm:max-w-2xl">
        <div className="space-y-1.5 pr-8">
          <DialogTitle className="font-display text-[20px] font-medium leading-tight text-ink-1">Import clients</DialogTitle>
          <DialogDescription className="text-[13px] leading-relaxed text-ink-2">
            <ImportRequirements />
          </DialogDescription>
        </div>
        <ImportPanel key={session} onDone={close} onCancel={close} />
      </DialogContent>
    </Dialog>
  );
}

/** What the CSV needs, with the template link. */
export function ImportRequirements() {
  const templateHref = useMemo(() => `data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE_CSV)}`, []);
  return (
    <>
      A CSV with one row per client. Required columns: client_id, program, status and consent_confirmed. Up to {MAX_IMPORT_ROWS} rows.{" "}
      <a href={templateHref} download="argus-caseload-template.csv" className="text-brand-ink underline underline-offset-4">
        Download a template
      </a>
    </>
  );
}

type PanelProps = {
  /** "Done" after a commit. */
  onDone: () => void;
  /** "Cancel" on the preview. */
  onCancel: () => void;
  doneLabel?: string;
};

/**
 * Pick a CSV, check it in the browser, dry-run it on the server, show what
 * would happen row by row, then commit once consent is confirmed. Nothing is
 * written until the consultant presses Import. The caseload dialog wraps it,
 * and onboarding step 3 shows it inline.
 */
export function ImportPanel({ onDone, onCancel, doneLabel = "Done" }: PanelProps) {
  const fileId = useId();
  const consentId = useId();
  const updateId = useId();
  const bulk = useBulkImport();

  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<BulkRow[] | null>(null);
  const [fileError, setFileError] = useState<FileError | null>(null);
  const [preview, setPreview] = useState<BulkResponse | null>(null);
  const [allowUpdate, setAllowUpdate] = useState(false);
  const [consent, setConsent] = useState(false);
  const [result, setResult] = useState<BulkResponse | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);

  function reset() {
    setFileName(null);
    setRows(null);
    setFileError(null);
    setPreview(null);
    setAllowUpdate(false);
    setConsent(false);
    setResult(null);
    setRequestError(null);
    bulk.reset();
  }

  async function runDryRun(nextRows: BulkRow[], update: boolean) {
    setPreview(null);
    setRequestError(null);
    try {
      const res = await bulk.mutateAsync({ rows: nextRows, dryRun: true, update });
      setPreview(res);
    } catch (err) {
      const fe = fileErrorFrom(err);
      if (fe) setFileError(fe);
      else setRequestError(err instanceof Error ? err.message : "Request failed");
    }
  }

  async function onFile(file: File | undefined) {
    reset();
    if (!file) return;
    setFileName(file.name);
    if (file.size > MAX_FILE_BYTES) {
      setFileError({ error: "too-large" });
      return;
    }
    const parsed = parseImport(await file.text());
    if (!parsed.ok) {
      // Refused in the browser. Nothing from this file was sent.
      setFileError(parsed);
      return;
    }
    setRows(parsed.rows);
    await runDryRun(parsed.rows, false);
  }

  async function commit() {
    if (!rows) return;
    setRequestError(null);
    try {
      const res = await bulk.mutateAsync({ rows, dryRun: false, update: allowUpdate });
      setResult(res);
      const n = res.created + res.updated;
      toast.success(`${n} ${n === 1 ? "client" : "clients"} imported`);
    } catch (err) {
      const fe = fileErrorFrom(err);
      if (fe) setFileError(fe);
      else setRequestError(err instanceof Error ? err.message : "Request failed");
    }
  }

  const ready = preview ? preview.created + preview.updated : 0;
  const existingRejected = useMemo(
    () => (preview?.rejected ?? []).filter((r) => r.errors.includes("client-exists")).length,
    [preview],
  );

  return (
    <div className="grid gap-5">
      <p className="border-l-2 border-brand-ink bg-brand-subtle px-3 py-2 text-[13px] text-ink-1">{PII_WARNING}</p>

      {result ? (
        <div className="space-y-4">
          <p className="text-[14px] text-ink-1">
            {result.created > 0 && `${result.created} added. `}
            {result.updated > 0 && `${result.updated} updated. `}
            {result.rejected.length > 0
              ? `${result.rejected.length} ${result.rejected.length === 1 ? "row was" : "rows were"} skipped.`
              : "Every row went in."}
          </p>
          {result.rejected.length > 0 && <RejectedTable rows={result.rejected} />}
          <div className="flex justify-end gap-2">
            <button type="button" className={buttonSecondary} onClick={reset}>
              Import another file
            </button>
            <button type="button" className={buttonPrimary} onClick={onDone}>
              {doneLabel}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="space-y-1.5">
            <SectionLabel as="label" htmlFor={fileId}>
              CSV file
            </SectionLabel>
            <input
              id={fileId}
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                const file = e.target.files?.[0];
                // Clear it so picking the same file again after a fix still fires.
                e.target.value = "";
                void onFile(file);
              }}
              className="block w-full text-[13px] text-ink-2 file:mr-3 file:h-9 file:cursor-pointer file:rounded-sm file:border file:border-control file:bg-sunk file:px-3 file:text-[13px] file:text-ink-1 hover:file:bg-surface"
            />
            {fileName && (
              <p className="font-mono text-[11px] text-ink-3" role="status">
                {fileName}
                {!fileError && bulk.isPending && !preview ? `, checking ${rows?.length ?? 0} rows` : ""}
              </p>
            )}
          </div>

          {fileError && (
            <InlineError
              message={
                fileError.error === "too-large"
                  ? "We didn't import this file. It's over 1 MB, which is far more than 500 rows should need."
                  : describeFileError(fileError)
              }
            />
          )}
          {requestError && <InlineError message="Couldn't check this file." detail={requestError} onRetry={rows ? () => void runDryRun(rows, allowUpdate) : undefined} />}

          {preview && rows && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-px border border-hairline bg-hairline">
                <Count label="Ready to add" value={preview.created} />
                <Count label="Ready to update" value={preview.updated} />
                <Count label="With problems" value={preview.rejected.length} danger={preview.rejected.length > 0} />
              </div>

              {(existingRejected > 0 || allowUpdate) && (
                <label htmlFor={updateId} className="flex items-start gap-2.5 text-[13px] text-ink-1">
                  <input
                    id={updateId}
                    type="checkbox"
                    checked={allowUpdate}
                    onChange={(e) => {
                      setAllowUpdate(e.target.checked);
                      void runDryRun(rows, e.target.checked);
                    }}
                    className="mt-0.5 h-4 w-4 accent-[var(--brand)]"
                  />
                  <span>
                    Update clients already in your caseload with the values in this file.
                    <span className="block text-[12px] text-ink-2">Left unticked, those rows are skipped and nothing about them changes.</span>
                  </span>
                </label>
              )}

              {preview.rejected.length > 0 && <RejectedTable rows={preview.rejected} />}

              <label htmlFor={consentId} className="flex items-start gap-2.5 border-t border-hairline pt-4 text-[13px] text-ink-1">
                <input
                  id={consentId}
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-[var(--brand)]"
                />
                <span>{CONSENT_LABEL}</span>
              </label>

              <div className="flex flex-wrap items-center justify-end gap-2">
                <button type="button" className={buttonSecondary} onClick={onCancel}>
                  Cancel
                </button>
                <button type="button" className={buttonPrimary} disabled={!consent || ready === 0 || bulk.isPending} onClick={() => void commit()}>
                  {bulk.isPending ? "Importing" : `Import ${ready} ${ready === 1 ? "client" : "clients"}`}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Count({ label, value, danger = false }: { label: string; value: number; danger?: boolean }) {
  return (
    <div className="bg-card px-4 py-3">
      <div className="label">{label}</div>
      <div className={`mt-1 font-display text-[24px] leading-none tabular ${danger ? "text-danger-ink" : "text-ink-1"}`}>{value}</div>
    </div>
  );
}

function RejectedTable({ rows }: { rows: BulkResponse["rejected"] }) {
  return (
    <div className="max-h-64 overflow-y-auto border border-hairline">
      <table className="w-full border-collapse text-[13px]">
        <caption className="sr-only">Rows that won&apos;t be imported</caption>
        <thead className="sticky top-0 bg-surface">
          <tr className="border-b border-hairline">
            <th scope="col" className="px-3 py-2 text-left font-mono text-[11px] font-normal uppercase tracking-[0.12em] text-ink-3">
              Row
            </th>
            <th scope="col" className="px-3 py-2 text-left font-mono text-[11px] font-normal uppercase tracking-[0.12em] text-ink-3">
              Case number
            </th>
            <th scope="col" className="px-3 py-2 text-left font-mono text-[11px] font-normal uppercase tracking-[0.12em] text-ink-3">
              Problem
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.row} className="border-b border-hairline last:border-0 even:bg-sunk">
              {/* Header is line 1 of the file, so data row n sits on line n + 1. */}
              <td className="px-3 py-2 align-top font-mono tabular text-ink-2">{r.row + 1}</td>
              <td className="px-3 py-2 align-top font-mono text-ink-1">{r.clientId ?? <span className="text-ink-3">Hidden</span>}</td>
              <td className="px-3 py-2 align-top text-danger-ink">
                {r.errors.map((e) => (
                  <div key={e}>{describeRowError(e)}</div>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
