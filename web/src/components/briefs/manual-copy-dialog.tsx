"use client";

import { useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { buttonPrimary, buttonSecondary } from "@/components/caseload/copy";
import { CLIENT_NAME_TOKEN, tryLegacyCopy } from "@/lib/briefs";

type Props = {
  text: string;
  confirming: boolean;
  error: string | null;
  onConfirm: () => void;
  onClose: () => void;
};

/**
 * Shown when the browser blocks the clipboard. The text sits selected in a
 * read-only box so Cmd/Ctrl+C works straight away. Mount it only while open.
 * The brief is marked copied only from the "I've copied it" button.
 */
export function ManualCopyDialog({ text, confirming, error, onConfirm, onClose }: Props) {
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const [legacy, setLegacy] = useState<"idle" | "copied" | "failed">("idle");

  function selectAll() {
    const el = boxRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }

  function onCopy() {
    const ok = tryLegacyCopy(selectAll, () => document.execCommand("copy"));
    setLegacy(ok ? "copied" : "failed");
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        initialFocus={boxRef}
        className="max-h-[calc(100dvh-2rem)] gap-4 overflow-y-auto rounded-md border border-hairline bg-surface p-6 sm:max-w-xl"
      >
        <div className="space-y-1.5 pr-8">
          <DialogTitle className="font-display text-[20px] font-medium leading-tight text-ink-1">Copy it by hand</DialogTitle>
          <DialogDescription className="text-[13px] leading-relaxed text-ink-2">
            Your browser blocked the clipboard, so nothing was copied yet. The text below is selected. Press Cmd+C on a Mac or Ctrl+C
            elsewhere, then paste it into your email and swap {CLIENT_NAME_TOKEN} for the name.
          </DialogDescription>
        </div>

        <label htmlFor="manual-copy-text" className="sr-only">
          Brief text to copy
        </label>
        <textarea
          id="manual-copy-text"
          ref={boxRef}
          readOnly
          value={text}
          rows={12}
          onFocus={(e) => e.currentTarget.select()}
          className="w-full resize-y rounded-sm border border-control bg-sunk px-3 py-2 font-mono text-[12px] leading-relaxed text-ink-1"
        />

        <p role="status" className="min-h-[1lh] text-[12px] text-ink-2">
          {legacy === "copied"
            ? "Your browser says it copied. Paste it into your email to check."
            : legacy === "failed"
              ? "Your browser blocked that too. Press Cmd+C or Ctrl+C while the text is selected."
              : ""}
        </p>

        {error && (
          <p role="alert" className="text-[12px] text-danger-ink">
            {error}
          </p>
        )}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className={buttonSecondary} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={buttonSecondary} onClick={onCopy}>
            Copy
          </button>
          <button type="button" className={buttonPrimary} onClick={onConfirm} disabled={confirming}>
            {confirming ? "Marking" : "I've copied it"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
