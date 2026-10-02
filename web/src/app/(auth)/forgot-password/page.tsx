"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { SectionLabel } from "@/components/argus/section-label";
import { confirmForgotPassword, forgotPassword } from "@/lib/auth";
import {
  describeResetError,
  PASSWORD_HINT,
  RESET_DONE_COPY,
  RESET_RESENT_COPY,
  RESET_SENT_COPY,
} from "@/lib/password-reset";
import { EyeMark } from "@/components/argus/eye-mark";

type Step = "request" | "confirm";

function ForgotPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [step, setStep] = useState<Step>("request");
  const [email, setEmail] = useState(searchParams.get("email") ?? "");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const normalizedEmail = () => email.trim().toLowerCase();

  async function onRequest(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await forgotPassword(normalizedEmail());
      setStep("confirm");
    } catch (err) {
      toast.error(describeResetError(err));
    } finally {
      setBusy(false);
    }
  }

  async function onConfirm(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await confirmForgotPassword(normalizedEmail(), code.trim(), password);
      toast.success(RESET_DONE_COPY);
      router.replace("/login");
    } catch (err) {
      toast.error(describeResetError(err));
    } finally {
      setBusy(false);
    }
  }

  async function onResend() {
    try {
      await forgotPassword(normalizedEmail());
      toast.success(RESET_RESENT_COPY);
    } catch (err) {
      toast.error(describeResetError(err));
    }
  }

  function onChangeEmail() {
    setCode("");
    setPassword("");
    setStep("request");
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col items-center gap-3">
        <EyeMark className="h-8 w-8" />
        <div className="flex flex-col items-center gap-1">
          <h1 className="font-display text-[24px] leading-tight text-ink-1">
            Reset your password
          </h1>
          <p className="text-[12px] text-ink-secondary text-center">
            {step === "request"
              ? "We'll email you a code to set a new one."
              : RESET_SENT_COPY}
          </p>
        </div>
      </div>

      <div className="h-px bg-border" />

      {step === "request" ? (
        <form onSubmit={onRequest} className="space-y-5">
          <div className="space-y-1.5">
            <SectionLabel as="label" htmlFor="email">Email</SectionLabel>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-10"
            />
          </div>
          <button
            type="submit"
            disabled={busy}
            className="w-full h-10 rounded-sm border border-brand-ink bg-brand text-on-brand text-[13px] font-medium hover:bg-brand-hover disabled:opacity-50 transition-colors"
          >
            {busy ? "Sending" : "Send reset code"}
          </button>
        </form>
      ) : (
        <form onSubmit={onConfirm} className="space-y-5">
          <div className="space-y-1.5">
            <SectionLabel as="label" htmlFor="code">Reset code</SectionLabel>
            <Input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              required
              maxLength={10}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="h-10 font-mono tabular tracking-widest"
            />
          </div>
          <div className="space-y-1.5">
            <SectionLabel as="label" htmlFor="password">New password</SectionLabel>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-10"
            />
            <p className="text-[11px] text-ink-tertiary">{PASSWORD_HINT}</p>
          </div>
          <button
            type="submit"
            disabled={busy}
            className="w-full h-10 rounded-sm border border-brand-ink bg-brand text-on-brand text-[13px] font-medium hover:bg-brand-hover disabled:opacity-50 transition-colors"
          >
            {busy ? "Resetting" : "Reset password"}
          </button>
        </form>
      )}

      {step === "request" ? (
        <div className="text-center text-[12px] text-ink-secondary">
          Remembered it?{" "}
          <Link href="/login" className="text-ink-primary underline underline-offset-4 decoration-border">
            Sign in
          </Link>
        </div>
      ) : (
        <div className="flex justify-center gap-6">
          <button
            type="button"
            onClick={onResend}
            className="text-[12px] text-ink-secondary underline underline-offset-4 decoration-border hover:text-ink-primary"
          >
            Send a new code
          </button>
          <button
            type="button"
            onClick={onChangeEmail}
            className="text-[12px] text-ink-secondary underline underline-offset-4 decoration-border hover:text-ink-primary"
          >
            Use a different email
          </button>
        </div>
      )}
    </div>
  );
}

export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={<div className="text-center label">Loading</div>}>
      <ForgotPasswordForm />
    </Suspense>
  );
}
