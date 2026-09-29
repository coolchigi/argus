"use client";

import { useState } from "react";
import { Switch } from "@/components/argus/switch";
import { POLICY_DOMAIN_LABELS } from "@/lib/humanize";
import { DOMAIN_DESCRIPTIONS } from "@/lib/settings-draft";
import { MONITORED_DOMAINS, type MeResponse, type MonitoredDomain, type PatchMeRequest } from "@/lib/types/me";
import { ContinueButton, StepFrame } from "./step-frame";

/**
 * Step 2. Every area starts from what /me says (all on for a new account).
 * Continue saves all 6, so the setup guide counts the areas as chosen even
 * when the consultant keeps the defaults.
 */
export function StepAreas({
  me,
  saving,
  error,
  onBack,
  onContinue,
}: {
  me: MeResponse;
  saving: boolean;
  error: string | null;
  onBack: () => void;
  onContinue: (patch: PatchMeRequest) => void;
}) {
  const [domains, setDomains] = useState<Record<MonitoredDomain, boolean>>({ ...me.preferences.policyDomains });
  const on = MONITORED_DOMAINS.filter((d) => domains[d]).length;

  return (
    <StepFrame
      title="What to watch"
      description={`Pick the IRCC program areas Argus checks against your caseload. ${on} of ${MONITORED_DOMAINS.length} are on. You can change these later in Settings.`}
      error={error}
      onBack={onBack}
      actions={<ContinueButton saving={saving} onClick={() => onContinue({ preferences: { policyDomains: domains } })} />}
    >
      <ul className="divide-y divide-hairline border border-hairline bg-card">
        {MONITORED_DOMAINS.map((d) => (
          <li key={d} className="px-5 py-3.5">
            <Switch
              checked={domains[d]}
              onCheckedChange={(checked) => setDomains((prev) => ({ ...prev, [d]: checked }))}
              label={POLICY_DOMAIN_LABELS[d]}
              description={DOMAIN_DESCRIPTIONS[d]}
              className="items-center"
            />
          </li>
        ))}
      </ul>
      {on === 0 ? (
        <p className="border-l-2 border-brand-ink bg-brand-subtle px-3 py-2 text-[13px] text-ink-1">
          With every area off, Argus won&apos;t assess any policy change for your clients.
        </p>
      ) : (
        <p className="text-[12px] text-ink-3">Changes IRCC files under general or other still reach clients in the areas you keep on.</p>
      )}
    </StepFrame>
  );
}
