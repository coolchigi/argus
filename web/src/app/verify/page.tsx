"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";

/**
 * Pulls a 64-character hex fingerprint out of whatever was pasted: the bare
 * hash, or a full verify link such as https://tryargus.ca/verify/<hash>.
 */
function extractFingerprint(input: string): string | null {
  const match = input.trim().match(/(?:^|[^0-9a-f])([0-9a-f]{64})(?![0-9a-f])/i);
  return match ? match[1].toLowerCase() : null;
}

export default function VerifyLookupPage() {
  const router = useRouter();
  const inputId = useId();
  const hintId = useId();
  const errorId = useId();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const hash = extractFingerprint(value);
    if (!hash) {
      setError("That doesn't look like a receipt. Paste the 64-character fingerprint or the full verify link.");
      return;
    }
    setError(null);
    router.push(`/verify/${hash}`);
  }

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <SiteHeader />
      <main id="main" className="mx-auto w-full max-w-[560px] flex-1 px-4 pb-16 pt-16 sm:px-6">
        <div className="label">Public receipt check</div>
        <h1 className="mt-2 font-display text-[28px] leading-tight text-ink-1">Verify a receipt</h1>
        <p className="mt-3 text-[14px] leading-relaxed text-ink-2">
          Every Argus assessment is signed. Paste the fingerprint or the verify link you were sent and
          you&rsquo;ll see the signed record, then check the signature in your own browser.
        </p>

        <form onSubmit={onSubmit} className="mt-8 space-y-3" noValidate>
          <label htmlFor={inputId} className="label block">
            Fingerprint or verify link
          </label>
          <input
            id={inputId}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              if (error) setError(null);
            }}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${hintId} ${errorId}` : hintId}
            placeholder="https://tryargus.ca/verify/…"
            className="h-11 w-full rounded-sm border border-control bg-surface px-3 font-mono text-[13px] text-ink-1 placeholder:text-ink-3"
          />
          <p id={hintId} className="text-[12px] text-ink-3">
            The fingerprint is 64 characters of 0 to 9 and a to f.
          </p>
          {error && (
            <p id={errorId} role="alert" className="text-[13px] text-danger-ink">
              {error}
            </p>
          )}
          <button
            type="submit"
            className="h-10 w-full rounded-sm border border-brand-ink bg-brand text-[13px] font-medium text-on-brand transition-colors hover:bg-brand-hover"
          >
            Look up receipt
          </button>
        </form>

        <p className="mt-10 text-[12px] leading-relaxed text-ink-3">
          Argus never stores client personal information. Client identity on a receipt is an opaque
          reference chosen by the consultant.
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
