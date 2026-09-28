"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Check } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/auth-context";
import { buttonPrimary, buttonSecondary } from "@/components/caseload/copy";
import { describeMeError } from "@/lib/settings-draft";
import { usePatchMe } from "@/lib/queries";
import { ApiError } from "@/lib/api";
import type { MeResponse } from "@/lib/types/me";
import type { SetupItem } from "@/lib/setup-progress";
import { cn } from "@/lib/utils";

/** The landing page's sample receipt. A real signed assessment on the demo tenant. */
export const SAMPLE_RECEIPT_HASH = "8be968886f7d6f6d9b1b0c1185f00f8e08032546dee5d8f3a1f00c0037c07d7b";

const linkButton = "text-[13px] text-brand-ink underline underline-offset-4 hover:text-ink-1";

type Props = {
  me: MeResponse;
  items: SetupItem[];
};

/** One row per setup item. Each pending row carries the action that finishes it. */
export function Checklist({ me, items }: Props) {
  return (
    <ol className="divide-y divide-hairline border border-hairline bg-card">
      {items.map((item) => (
        <li key={item.id} className="flex flex-wrap items-start gap-x-4 gap-y-3 px-5 py-4">
          <StatusMark done={item.done} />
          <div className="min-w-0 flex-1">
            <div className={cn("text-[14px]", item.done ? "text-ink-2" : "font-medium text-ink-1")}>
              {item.title}
              <span className="sr-only">{item.done ? ", done" : ", to do"}</span>
            </div>
            <p className="mt-0.5 text-[13px] text-ink-2">{item.detail}</p>
          </div>
          <div className="flex w-full flex-wrap items-center gap-3 pl-8 sm:w-auto sm:pl-0">
            <ItemAction item={item} me={me} />
          </div>
        </li>
      ))}
    </ol>
  );
}

function StatusMark({ done }: { done: boolean }) {
  if (done) {
    return (
      <span aria-hidden className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-control text-ink-2">
        <Check className="h-3 w-3" strokeWidth={2.25} />
      </span>
    );
  }
  return (
    <span aria-hidden className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
      <span className="h-2 w-2 rounded-full bg-brand" />
    </span>
  );
}

function ItemAction({ item, me }: { item: SetupItem; me: MeResponse }) {
  switch (item.id) {
    case "account":
      return item.done ? null : <SignOutAgain />;
    case "practice":
      return (
        <Link href="/settings#practice" className={item.done ? linkButton : buttonPrimary}>
          {item.done ? "Edit" : "Add details"}
        </Link>
      );
    case "areas":
      return item.done ? (
        <Link href="/settings#policy-monitor" className={linkButton}>
          Change
        </Link>
      ) : (
        <ConfirmAreas me={me} />
      );
    case "caseload":
      return item.done ? (
        <Link href="/caseload" className={linkButton}>
          View caseload
        </Link>
      ) : (
        <Link href="/caseload" className={buttonPrimary}>
          Import
        </Link>
      );
    case "sample-receipt":
      return item.done ? null : (
        <>
          <Link href={`/verify/${SAMPLE_RECEIPT_HASH}`} className={buttonSecondary}>
            Open a sample receipt
          </Link>
          {me.setup.hasAssessments && (
            <Link href="/impacts" className={linkButton}>
              Or verify one of yours
            </Link>
          )}
        </>
      );
  }
}

/** Saves the current areas as the consultant's choice, or sends them to Settings to pick. */
function ConfirmAreas({ me }: { me: MeResponse }) {
  const patch = usePatchMe();
  const on = Object.values(me.preferences.policyDomains).filter(Boolean).length;
  const total = Object.keys(me.preferences.policyDomains).length;
  return (
    <>
      <button
        type="button"
        className={buttonPrimary}
        disabled={patch.isPending}
        onClick={() =>
          patch.mutate(
            { preferences: { policyDomains: { ...me.preferences.policyDomains } } },
            {
              onSuccess: () => toast.success("Program areas saved"),
              onError: (err) => toast.error(describeMeError(err instanceof ApiError ? err.message : null)),
            },
          )
        }
      >
        {patch.isPending ? "Saving" : on === total ? `Keep all ${total} on` : `Keep these ${on} on`}
      </button>
      <Link href="/settings#policy-monitor" className={linkButton}>
        Choose in Settings
      </Link>
    </>
  );
}

function SignOutAgain() {
  const auth = useAuth();
  const router = useRouter();
  return (
    <button
      type="button"
      className={buttonSecondary}
      onClick={() => {
        auth.signOut();
        router.replace("/login");
      }}
    >
      Sign out
    </button>
  );
}

/** "Setup complete." with a disclosure that opens the full list. */
export function CompleteSummary({ me, items }: Props) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border border-hairline bg-card px-5 py-4">
        <div className="flex items-center gap-3">
          <StatusMark done />
          <p className="text-[14px] text-ink-1">Setup complete.</p>
        </div>
        <button type="button" aria-expanded={open} aria-controls={listId} onClick={() => setOpen((o) => !o)} className={linkButton}>
          {open ? "Hide the list" : "Change any of these"}
        </button>
      </div>
      <div id={listId} hidden={!open}>
        {open && <Checklist me={me} items={items} />}
      </div>
    </div>
  );
}
