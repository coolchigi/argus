"use client";

import { useState } from "react";
import { ImportPanel, ImportRequirements } from "@/components/caseload/import-dialog";
import type { MeResponse } from "@/lib/types/me";
import { ContinueButton, LaterButton, StepFrame } from "./step-frame";

/**
 * Step 3. The caseload page's import, inline. "I'll do this later" moves on
 * without writing anything. A consultant who already has clients just sees
 * the count.
 */
export function StepCaseload({
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
  onContinue: () => void;
}) {
  // Cancel on the preview starts the panel over from "pick a file".
  const [attempt, setAttempt] = useState(0);
  const clients = me.setup.clientCount;

  return (
    <StepFrame
      title="Import caseload"
      description={
        <>
          <p>
            {clients > 0
              ? `You have ${clients} ${clients === 1 ? "client" : "clients"} in your caseload already. Import more here, or carry on.`
              : "Argus matches each policy change against your clients by case number and program."}
          </p>
          <p className="mt-2 text-[13px]">
            <ImportRequirements />
          </p>
        </>
      }
      error={error}
      onBack={onBack}
      actions={
        clients > 0 ? (
          <ContinueButton saving={saving} onClick={onContinue} />
        ) : (
          <LaterButton saving={saving} onClick={onContinue}>
            I&apos;ll do this later
          </LaterButton>
        )
      }
    >
      <div className="border border-hairline bg-card p-5">
        <ImportPanel key={attempt} doneLabel="Continue" onDone={onContinue} onCancel={() => setAttempt((n) => n + 1)} />
      </div>
    </StepFrame>
  );
}
