"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { confirmSignUp, resendConfirmationCode } from "@/lib/auth";
import { Seal } from "@/components/seal";

function VerifyForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialEmail = searchParams.get("email") ?? "";
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await confirmSignUp(email.trim().toLowerCase(), code.trim());
      toast.success("Email confirmed. Please sign in.");
      router.replace(`/login`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "confirm-failed");
    } finally {
      setBusy(false);
    }
  }

  async function onResend() {
    try {
      await resendConfirmationCode(email.trim().toLowerCase());
      toast.success("A new code is on its way.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "resend-failed");
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col items-center gap-3">
        <Seal className="h-8 w-8 text-seal" />
        <div className="flex flex-col items-center gap-1">
          <h1 className="text-[24px] font-medium tracking-tight text-ink-primary" style={{ fontFamily: "var(--font-newsreader), serif" }}>
            Confirm your email
          </h1>
          <p className="text-[12px] text-ink-secondary text-center">
            Enter the 6-digit code we emailed you.
          </p>
        </div>
      </div>

      <div className="h-px bg-border" />

      <form onSubmit={onSubmit} className="space-y-5">
        <div className="space-y-1.5">
          <Label htmlFor="email" className="label">Email</Label>
          <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="h-10" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="code" className="label">Confirmation code</Label>
          <Input
            id="code"
            inputMode="numeric"
            pattern="[0-9]*"
            required
            maxLength={10}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="h-10 font-mono tabular tracking-widest"
          />
        </div>
        <button
          type="submit"
          disabled={busy}
          className="w-full h-10 rounded-sm bg-primary text-primary-foreground text-[13px] font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {busy ? "Confirming" : "Confirm"}
        </button>
      </form>

      <div className="text-center">
        <button
          type="button"
          onClick={onResend}
          className="text-[12px] text-ink-secondary underline underline-offset-4 decoration-border hover:text-ink-primary"
        >
          Resend confirmation code
        </button>
      </div>
    </div>
  );
}

export default function VerifyPage() {
  return (
    <Suspense fallback={<div className="text-center label">Loading</div>}>
      <VerifyForm />
    </Suspense>
  );
}
