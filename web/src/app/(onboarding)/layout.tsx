import type { ReactNode } from "react";
import { OnboardingShell } from "@/components/onboarding/onboarding-shell";

export default function OnboardingLayout({ children }: { children: ReactNode }) {
  return <OnboardingShell>{children}</OnboardingShell>;
}
