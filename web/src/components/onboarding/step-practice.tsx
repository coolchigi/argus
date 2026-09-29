"use client";

import { useId, useState } from "react";
import { SectionLabel } from "@/components/argus/section-label";
import { fieldClass } from "@/components/caseload/copy";
import { PROVINCE_LABELS, validateDraft } from "@/lib/settings-draft";
import { FIRM_MAX_LENGTH, PROVINCES, type MeResponse, type PatchMeRequest, type Province } from "@/lib/types/me";
import { cn } from "@/lib/utils";
import { ContinueButton, StepFrame } from "./step-frame";

/** Step 1. Licence from sign-up, read-only. Firm and province are theirs to set. */
export function StepPractice({
  me,
  saving,
  error,
  onContinue,
}: {
  me: MeResponse;
  saving: boolean;
  error: string | null;
  onContinue: (patch: PatchMeRequest) => void;
}) {
  const firmId = useId();
  const firmHelpId = useId();
  const provinceId = useId();
  const [firm, setFirm] = useState(me.consultant.firm ?? "");
  const [province, setProvince] = useState<Province | "">(me.consultant.province ?? "");
  const [touched, setTouched] = useState(false);

  // Settings' own rules, plus both fields filled: the setup guide counts
  // practice details as done only with firm and province.
  const errors = validateDraft({ firm, province, policyDomains: me.preferences.policyDomains, realtimeAlerts: me.preferences.realtimeAlerts });
  const firmError = errors.firm ?? (touched && firm.trim() === "" ? "Add your firm's name." : undefined);
  const provinceError = errors.province ?? (touched && province === "" ? "Pick the province or territory you practise in." : undefined);
  const ready = firm.trim() !== "" && province !== "" && !errors.firm && !errors.province;

  const license = me.consultant.rcicLicense ?? me.consultant.rcicId;

  return (
    <StepFrame
      title="Your practice"
      description="Your licence number comes from sign-up. Add your firm and province. You can change both later in Settings."
      error={error}
      actions={
        <ContinueButton
          saving={saving}
          onClick={() => {
            setTouched(true);
            if (ready) onContinue({ firm: firm.trim(), province: province as Province });
          }}
        />
      }
    >
      <div className="space-y-5 border border-hairline bg-card p-5">
        <dl>
          <dt className="label mb-1">CICC licence</dt>
          <dd className="font-mono text-[13px] text-ink-1">{license}</dd>
        </dl>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <SectionLabel as="label" htmlFor={firmId} className="mb-1">
              Firm
            </SectionLabel>
            <input
              id={firmId}
              type="text"
              autoComplete="organization"
              value={firm}
              onChange={(e) => setFirm(e.target.value)}
              aria-invalid={firmError ? true : undefined}
              aria-describedby={firmHelpId}
              className={cn(fieldClass, firmError && "border-danger")}
              placeholder="Your practice's name"
            />
            <p id={firmHelpId} className={cn("mt-1 text-[12px]", firmError ? "text-danger-ink" : "text-ink-3")}>
              {firmError ?? `${firm.trim().length} of ${FIRM_MAX_LENGTH} characters`}
            </p>
          </div>
          <div>
            <SectionLabel as="label" htmlFor={provinceId} className="mb-1">
              Province or territory
            </SectionLabel>
            <select
              id={provinceId}
              value={province}
              onChange={(e) => setProvince(e.target.value as Province | "")}
              aria-invalid={provinceError ? true : undefined}
              className={cn(fieldClass, "px-2", provinceError && "border-danger")}
            >
              <option value="">Choose one</option>
              {PROVINCES.map((p) => (
                <option key={p} value={p}>
                  {PROVINCE_LABELS[p]}
                </option>
              ))}
            </select>
            {provinceError && <p className="mt-1 text-[12px] text-danger-ink">{provinceError}</p>}
          </div>
        </div>
      </div>
    </StepFrame>
  );
}
