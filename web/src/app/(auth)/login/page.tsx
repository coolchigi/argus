"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { SectionLabel } from "@/components/argus/section-label";
import { useAuth } from "@/components/auth-context";
import { signIn } from "@/lib/auth";
import { EyeMark } from "@/components/argus/eye-mark";

export default function LoginPage() {
  const router = useRouter();
  const auth = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const typedEmail = email.trim();
  const forgotHref = typedEmail
    ? `/forgot-password?email=${encodeURIComponent(typedEmail)}`
    : "/forgot-password";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await signIn(email.trim().toLowerCase(), password);
      await auth.refresh();
      router.replace("/dashboard");
    } catch (err) {
      const message = err instanceof Error ? err.message : "sign-in-failed";
      if (message.includes("UserNotConfirmedException")) {
        toast.error("Please confirm your email first.");
        router.push(`/confirm-email?email=${encodeURIComponent(email)}`);
      } else {
        toast.error(message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col items-center gap-3">
        <EyeMark className="h-8 w-8" />
        <div className="flex flex-col items-center gap-1">
          <h1 className="font-display text-[24px] leading-tight text-ink-1">
            Argus
          </h1>
          <p className="text-[13px] text-ink-secondary text-center leading-relaxed">
            Impact assessments,<br />signed and archived.
          </p>
        </div>
      </div>

      <div className="h-px bg-border" />

      <form onSubmit={onSubmit} className="space-y-5">
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
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between">
            <SectionLabel as="label" htmlFor="password">Password</SectionLabel>
            <Link
              href={forgotHref}
              className="text-[12px] text-ink-secondary underline underline-offset-4 decoration-border hover:text-ink-primary"
            >
              Forgot password?
            </Link>
          </div>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-10"
          />
        </div>
        <button
          type="submit"
          disabled={busy}
          className="w-full h-10 rounded-sm border border-brand-ink bg-brand text-on-brand text-[13px] font-medium hover:bg-brand-hover disabled:opacity-50 transition-colors"
        >
          {busy ? "Signing in" : "Sign in"}
        </button>
      </form>

      <div className="text-center text-[12px] text-ink-secondary">
        New to Argus?{" "}
        <Link href="/signup" className="text-ink-primary underline underline-offset-4 decoration-border">
          Create an account
        </Link>
      </div>
    </div>
  );
}
