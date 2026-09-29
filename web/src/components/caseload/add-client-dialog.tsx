"use client";

import { useId, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { InlineError } from "@/components/argus/inline-error";
import { SectionLabel } from "@/components/argus/section-label";
import { ApiError } from "@/lib/api";
import { POLICY_DOMAIN_LABELS, type PolicyDomain } from "@/lib/humanize";
import { useCreateProfile } from "@/lib/queries";
import { CLIENT_STATUSES, type ClientStatus, type CreateProfileRequest } from "@/lib/types/profiles";
import { CONSENT_LABEL, PII_WARNING, buttonPrimary, buttonSecondary, describeRowError, fieldClass } from "./copy";
import { clientHref } from "./caseload-table";
import { SIN_SHAPED_ID_MESSAGE, looksLikeSinOrSsn } from "./client-id";

const STATUS_LABELS: Record<ClientStatus, string> = { active: "Active", submitted: "Submitted", closed: "Closed" };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * One client by hand. Case number, program and status, plus the three fields
 * the caseload table shows. Everything else the Analyst reads comes in
 * through a CSV import or a later edit.
 */
export function AddClientDialog({ open, onOpenChange }: Props) {
  const router = useRouter();
  const create = useCreateProfile();
  const ids = {
    clientId: useId(),
    program: useId(),
    status: useId(),
    crs: useId(),
    noc: useId(),
    teer: useId(),
    consent: useId(),
  };

  const [clientId, setClientId] = useState("");
  const [program, setProgram] = useState<PolicyDomain>("express-entry");
  const [status, setStatus] = useState<ClientStatus>("active");
  const [crs, setCrs] = useState("");
  const [noc, setNoc] = useState("");
  const [teer, setTeer] = useState("");
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Checked as they type. The guardrail would block every assessment for this client.
  const sinShaped = looksLikeSinOrSsn(clientId);

  function reset() {
    setClientId("");
    setProgram("express-entry");
    setStatus("active");
    setCrs("");
    setNoc("");
    setTeer("");
    setConsent(false);
    setError(null);
    create.reset();
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (sinShaped) return;
    const body: CreateProfileRequest = { clientId: clientId.trim(), program, status, consentConfirmed: true };
    if (crs.trim()) body.currentCrsScore = Number(crs);
    if (noc.trim()) body.nocCode = noc.trim();
    if (teer.trim()) body.teerLevel = Number(teer);
    try {
      const res = await create.mutateAsync(body);
      toast.success(`${res.client.clientId} added`);
      onOpenChange(false);
      reset();
      router.push(clientHref(res.client.clientId));
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) setError(`${body.clientId} is already in your caseload.`);
      else if (err instanceof ApiError && err.status === 400) {
        const b = err.body as { error?: string; errors?: string[] } | null;
        setError((b?.errors ?? [b?.error ?? "invalid"]).map(describeRowError).join(". "));
      } else setError(err instanceof Error ? err.message : "Request failed");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-2rem)] gap-5 overflow-y-auto rounded-md border border-hairline bg-surface p-6 sm:max-w-md">
        <div className="space-y-1.5 pr-8">
          <DialogTitle className="font-display text-[20px] font-medium leading-tight text-ink-1">Add a client</DialogTitle>
          <DialogDescription className="text-[13px] leading-relaxed text-ink-2">{PII_WARNING}</DialogDescription>
        </div>

        <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
          <div className="space-y-1.5">
            <SectionLabel as="label" htmlFor={ids.clientId}>
              Case number
            </SectionLabel>
            <input
              id={ids.clientId}
              required
              maxLength={40}
              pattern="[A-Za-z0-9._\-]{1,40}"
              autoComplete="off"
              spellCheck={false}
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="2026-014"
              className={`${fieldClass} font-mono`}
              aria-invalid={sinShaped || undefined}
              aria-describedby={`${ids.clientId}-hint`}
            />
            {sinShaped ? (
              <p id={`${ids.clientId}-hint`} role="alert" className="text-[12px] text-danger-ink">
                {SIN_SHAPED_ID_MESSAGE}
              </p>
            ) : (
              <p id={`${ids.clientId}-hint`} className="text-[12px] text-ink-3">
                Letters, digits, dots, dashes and underscores.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <SectionLabel as="label" htmlFor={ids.program}>
                Program
              </SectionLabel>
              <select id={ids.program} value={program} onChange={(e) => setProgram(e.target.value as PolicyDomain)} className={fieldClass}>
                {(Object.keys(POLICY_DOMAIN_LABELS) as PolicyDomain[]).map((p) => (
                  <option key={p} value={p}>
                    {POLICY_DOMAIN_LABELS[p]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <SectionLabel as="label" htmlFor={ids.status}>
                Status
              </SectionLabel>
              <select id={ids.status} value={status} onChange={(e) => setStatus(e.target.value as ClientStatus)} className={fieldClass}>
                {CLIENT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <SectionLabel as="label" htmlFor={ids.crs}>
                CRS
              </SectionLabel>
              <input id={ids.crs} inputMode="numeric" pattern="\d*" value={crs} onChange={(e) => setCrs(e.target.value)} className={`${fieldClass} font-mono`} />
            </div>
            <div className="space-y-1.5">
              <SectionLabel as="label" htmlFor={ids.noc}>
                NOC
              </SectionLabel>
              <input id={ids.noc} inputMode="numeric" pattern="\d{5}" maxLength={5} value={noc} onChange={(e) => setNoc(e.target.value)} className={`${fieldClass} font-mono`} />
            </div>
            <div className="space-y-1.5">
              <SectionLabel as="label" htmlFor={ids.teer}>
                TEER
              </SectionLabel>
              <input id={ids.teer} inputMode="numeric" pattern="[0-5]" maxLength={1} value={teer} onChange={(e) => setTeer(e.target.value)} className={`${fieldClass} font-mono`} />
            </div>
          </div>

          <label htmlFor={ids.consent} className="flex items-start gap-2.5 text-[13px] text-ink-1">
            <input
              id={ids.consent}
              type="checkbox"
              required
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[var(--brand)]"
            />
            <span>{CONSENT_LABEL}</span>
          </label>

          {error && <InlineError message={error} />}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className={buttonSecondary} onClick={() => onOpenChange(false)}>
              Cancel
            </button>
            <button type="submit" className={buttonPrimary} disabled={!consent || !clientId.trim() || sinShaped || create.isPending}>
              {create.isPending ? "Adding" : "Add client"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
