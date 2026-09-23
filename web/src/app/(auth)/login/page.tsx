"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/components/auth-context";
import { signIn } from "@/lib/auth";
import { Seal } from "@/components/seal";

export default function LoginPage() {
  const router = useRouter();
  const auth = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

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
        router.push(`/verify?email=${encodeURIComponent(email)}`);
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
        <Seal className="h-8 w-8 text-seal" />
        <div className="flex flex-col items-center gap-1">
          <h1 className="text-[24px] font-medium tracking-tight text-ink-primary" style={{ fontFamily: "var(--font-newsreader), serif" }}>
            argus
          </h1>
          <p className="text-[13px] text-ink-secondary text-center leading-relaxed">
            Impact assessments,<br />signed and archived.
          </p>
        </div>
      </div>

      <div className="h-px bg-border" />

      <form onSubmit={onSubmit} className="space-y-5">
        <div className="space-y-1.5">
          <Label htmlFor="email" className="label">Email</Label>
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
          <Label htmlFor="password" className="label">Password</Label>
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
          className="w-full h-10 rounded-sm bg-primary text-primary-foreground text-[13px] font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
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
