"use client";

import { useId, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { InlineError } from "@/components/argus/inline-error";
import { SectionLabel } from "@/components/argus/section-label";
import { ApiError } from "@/lib/api";
import { POLICY_DOMAIN_LABELS, type PolicyDomain } from "@/lib/humanize";
import { usePatchProfile } from "@/lib/queries";
import type { ClientProfile } from "@/lib/types/profiles";
import { PII_WARNING, buttonPrimary, buttonSecondary, describeRowError, fieldClass } from "./copy";
import { ProfileFieldInput } from "./profile-field-input";
import { PROFILE_FIELDS, buildPatch, fieldsFor, toDraft, type EditableAttr } from "./profile-fields";

type Props = {
  client: ClientProfile;
  onClose: () => void;
};

/**
 * Edit a client's program and scoring details. Mount it only while open, so
 * each opening starts from the saved profile. Sends only what changed.
 */
export function EditProfileDialog({ client, onClose }: Props) {
  const patch = usePatchProfile(client.clientId);
  const baseId = useId();
  const [program, setProgram] = useState<PolicyDomain>(client.program ?? "general");
  const [drafts, setDrafts] = useState<Partial<Record<EditableAttr, string>>>(() =>
    Object.fromEntries(PROFILE_FIELDS.map((f) => [f.attr, toDraft(client[f.attr])])),
  );
  const [error, setError] = useState<string | null>(null);
  const fields = useMemo(() => fieldsFor(program, client), [program, client]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const body = buildPatch(fields, client, drafts);
    if (program !== client.program) body.program = program;
    if (Object.keys(body).length === 0) {
      onClose();
      return;
    }
    try {
      await patch.mutateAsync(body);
      toast.success(`${client.clientId} updated`);
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        const b = err.body as { error?: string; errors?: string[] } | null;
        setError((b?.errors ?? [b?.error ?? "invalid"]).map(describeRowError).join(". "));
      } else setError(err instanceof Error ? err.message : "Request failed");
    }
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] gap-5 overflow-y-auto rounded-md border border-hairline bg-surface p-6 sm:max-w-lg">
        <div className="space-y-1.5 pr-8">
          <DialogTitle className="font-display text-[20px] font-medium leading-tight text-ink-1">
            Edit <span className="font-mono">{client.clientId}</span>
          </DialogTitle>
          <DialogDescription className="text-[13px] leading-relaxed text-ink-2">
            {PII_WARNING} Leave a field blank if you don&apos;t know it.
          </DialogDescription>
        </div>

        <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
          <div className="space-y-1.5">
            <SectionLabel as="label" htmlFor={`${baseId}-program`}>
              Program
            </SectionLabel>
            <select id={`${baseId}-program`} value={program} onChange={(e) => setProgram(e.target.value as PolicyDomain)} className={fieldClass}>
              {(Object.keys(POLICY_DOMAIN_LABELS) as PolicyDomain[]).map((p) => (
                <option key={p} value={p}>
                  {POLICY_DOMAIN_LABELS[p]}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {fields.map((f) => (
              <ProfileFieldInput
                key={f.attr}
                id={`${baseId}-${f.attr}`}
                field={f}
                value={drafts[f.attr] ?? ""}
                onChange={(v) => setDrafts((d) => ({ ...d, [f.attr]: v }))}
              />
            ))}
          </div>

          {error && <InlineError message={error} />}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className={buttonSecondary} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className={buttonPrimary} disabled={patch.isPending}>
              {patch.isPending ? "Saving" : "Save"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
