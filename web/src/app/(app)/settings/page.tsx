"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { LogOut } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/auth-context";
import { InlineError } from "@/components/argus/inline-error";
import { PageHeader } from "@/components/argus/page-header";
import { ProgressLine } from "@/components/argus/progress-line";
import { buttonSecondary } from "@/components/caseload/copy";
import { SaveBar } from "@/components/settings/save-bar";
import {
  AppearanceSection,
  DataRetentionSection,
  NotificationsSection,
  PolicyMonitorSection,
  ProfileSection,
  PublicReceiptsSection,
  SettingsSection,
  SigningKeySection,
} from "@/components/settings/sections";
import { useSetupProgress } from "@/components/setup/use-setup-progress";
import { ApiError } from "@/lib/api";
import { useMe, usePatchMe } from "@/lib/queries";
import { changeCount, describeMeError, diffDraft, draftFromMe, validateDraft, type SettingsDraft } from "@/lib/settings-draft";

export default function SettingsPage() {
  const me = useMe();
  const patch = usePatchMe();
  const auth = useAuth();
  const router = useRouter();
  const setup = useSetupProgress();

  const saved = useMemo(() => (me.data ? draftFromMe(me.data) : null), [me.data]);
  const [draft, setDraft] = useState<SettingsDraft | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const lastSaved = useRef<SettingsDraft | null>(null);

  // Take fresh server values, unless the consultant has edits in progress.
  useEffect(() => {
    if (!saved) return;
    setDraft((d) => (d === null || lastSaved.current === null || diffDraft(lastSaved.current, d) === null ? saved : d));
    lastSaved.current = saved;
  }, [saved]);

  const count = saved && draft ? changeCount(saved, draft) : 0;
  const errors = draft ? validateDraft(draft) : {};
  const blocked = Object.keys(errors).length > 0;

  // The browser's own prompt when leaving with unsaved edits.
  useEffect(() => {
    if (count === 0) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [count]);

  function update(p: Partial<SettingsDraft>) {
    setSaveError(null);
    setDraft((d) => (d ? { ...d, ...p } : d));
  }

  function save() {
    if (!saved || !draft || blocked) return;
    const body = diffDraft(saved, draft);
    if (!body) return;
    setSaveError(null);
    patch.mutate(body, {
      onSuccess: (next) => {
        const fresh = draftFromMe(next);
        lastSaved.current = fresh;
        setDraft(fresh);
        toast.success("Settings saved");
      },
      onError: (err) => setSaveError(describeMeError(err instanceof ApiError ? err.message : null)),
    });
  }

  return (
    <div className="max-w-3xl space-y-8">
      <ProgressLine active={me.isFetching} fixed label="Loading your settings" />
      <PageHeader
        title="Settings"
        meta={me.data ? `RCIC ${me.data.consultant.rcicLicense ?? me.data.consultant.rcicId}` : "Loading"}
        actions={
          setup && !setup.complete ? (
            <Link href="/setup" className="text-[13px] text-brand-ink underline underline-offset-4 hover:text-ink-1">
              Setup guide, {setup.done} of {setup.total} done
            </Link>
          ) : undefined
        }
      />

      {me.error ? (
        <InlineError
          message="Couldn't load your settings."
          detail={me.error instanceof Error ? me.error.message : null}
          retrying={me.isFetching}
          onRetry={() => void me.refetch()}
        />
      ) : !me.data || !draft ? (
        <p className="text-[13px] text-ink-3">Loading your settings</p>
      ) : (
        <>
          <ProfileSection me={me.data} draft={draft} errors={errors} onChange={update} />
          <PolicyMonitorSection draft={draft} onChange={update} />
          <NotificationsSection me={me.data} draft={draft} onChange={update} />
          <PublicReceiptsSection me={me.data} draft={draft} onChange={update} />
          <SigningKeySection me={me.data} />
        </>
      )}

      <AppearanceSection />
      <DataRetentionSection />

      <SettingsSection id="sign-out" title="Sign out">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[13px] text-ink-2">Signs you out on this device.</p>
          <button
            type="button"
            className={buttonSecondary}
            onClick={() => {
              auth.signOut();
              router.replace("/login");
            }}
          >
            <LogOut aria-hidden className="h-3.5 w-3.5" strokeWidth={1.5} />
            Sign out
          </button>
        </div>
      </SettingsSection>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline pt-5">
        <Link href="/dashboard" className="text-[13px] text-ink-2 hover:text-ink-1">
          Back to dashboard
        </Link>
        <Link href="/caseload" className="text-[13px] text-brand-ink underline underline-offset-4 hover:text-ink-1">
          Next: review your caseload
        </Link>
      </div>

      <SaveBar
        count={count}
        saving={patch.isPending}
        blocked={blocked}
        error={saveError}
        onSave={save}
        onDiscard={() => {
          setSaveError(null);
          if (saved) setDraft(saved);
        }}
      />
    </div>
  );
}
