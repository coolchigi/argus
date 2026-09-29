"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ApiError } from "@/lib/api";
import { LAST_STEP, clampStep, startStep } from "@/lib/onboarding";
import { usePatchMe } from "@/lib/queries";
import { describeMeError } from "@/lib/settings-draft";
import type { MeResponse, PatchMeRequest } from "@/lib/types/me";
import { StepAreas } from "./step-areas";
import { StepCaseload } from "./step-caseload";
import { StepPractice } from "./step-practice";
import { StepSigning } from "./step-signing";
import { Stepper } from "./stepper";

/**
 * Steps 01 to 04. Every move forward saves the step's answers and the new
 * step number in one PATCH /me, so a refresh resumes where the consultant
 * was. Nothing advances until the save lands.
 */
export function OnboardingWizard({ me }: { me: MeResponse }) {
  const router = useRouter();
  const patch = usePatchMe();
  const [step, setStep] = useState(() => startStep(me));
  const [error, setError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const firstRender = useRef(true);

  // Move focus to the new step's heading so keyboard and screen reader users land on it.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    document.getElementById("onboarding-step-title")?.focus();
  }, [step]);

  async function save(body: PatchMeRequest): Promise<boolean> {
    setError(null);
    try {
      await patch.mutateAsync(body);
      return true;
    } catch (err) {
      setError(describeMeError(err instanceof ApiError ? err.message : null));
      return false;
    }
  }

  async function advance(extra: PatchMeRequest = {}) {
    const next = clampStep(step + 1);
    if (await save({ ...extra, onboarding: { step: next } })) setStep(next);
  }

  function back() {
    const prev = clampStep(step - 1);
    setError(null);
    setStep(prev);
    // Best effort. If it fails, a refresh resumes one step later, which is harmless.
    patch.mutate({ onboarding: { step: prev } });
  }

  async function leave(body: PatchMeRequest) {
    setLeaving(true);
    if (await save(body)) router.replace("/dashboard");
    else setLeaving(false);
  }

  const saving = patch.isPending || leaving;
  const common = { me, saving, error };

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="label">Set up Argus</div>
        <button
          type="button"
          onClick={() => void leave({ onboarding: { skip: true, step } })}
          disabled={saving}
          className="text-[13px] text-ink-2 underline-offset-4 hover:text-ink-1 hover:underline disabled:opacity-50"
        >
          Skip setup for now
        </button>
      </div>
      <Stepper current={step} />

      {step === 1 && <StepPractice {...common} onContinue={(p) => void advance(p)} />}
      {step === 2 && <StepAreas {...common} onBack={back} onContinue={(p) => void advance(p)} />}
      {step === 3 && <StepCaseload {...common} onBack={back} onContinue={() => void advance()} />}
      {step === LAST_STEP && <StepSigning {...common} onBack={back} onFinish={() => void leave({ onboarding: { complete: true } })} />}
    </div>
  );
}
