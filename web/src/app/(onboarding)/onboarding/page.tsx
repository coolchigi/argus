"use client";

import Link from "next/link";
import { InlineError } from "@/components/argus/inline-error";
import { ProgressLine } from "@/components/argus/progress-line";
import { OnboardingWizard } from "@/components/onboarding/wizard";
import { useMe } from "@/lib/queries";

export default function OnboardingPage() {
  const me = useMe();

  if (me.error) {
    return (
      <InlineError
        message="Couldn't load your account."
        detail={me.error instanceof Error ? me.error.message : null}
        retrying={me.isFetching}
        onRetry={() => void me.refetch()}
      />
    );
  }

  if (!me.data) {
    return (
      <div className="py-16 text-center">
        <ProgressLine active fixed label="Loading your setup" />
        <div className="label">Loading</div>
      </div>
    );
  }

  // PATCH /me answers 404 without a row, so the wizard couldn't save a thing.
  if (!me.data.setup.provisioned) {
    return (
      <div className="space-y-4">
        <p className="text-[14px] text-ink-1">Argus hasn&apos;t finished creating your account. Sign out and back in, then try again.</p>
        <Link href="/dashboard" className="text-[13px] text-ink-2 underline underline-offset-4 hover:text-ink-1">
          Go to your dashboard
        </Link>
      </div>
    );
  }

  return <OnboardingWizard me={me.data} />;
}
