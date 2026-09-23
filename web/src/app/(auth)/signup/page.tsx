"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signUp } from "@/lib/auth";
import { Seal } from "@/components/seal";

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [givenName, setGivenName] = useState("");
  const [familyName, setFamilyName] = useState("");
  const [rcicLicense, setRcicLicense] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const license = rcicLicense.trim().toUpperCase();
    if (!/^[A-Z]\d{6,7}$/.test(license)) {
      toast.error("R-license should be a letter and 6 to 7 digits (e.g. R527888).");
      return;
    }
    setBusy(true);
    try {
      await signUp({
        email: email.trim().toLowerCase(),
        password,
        givenName: givenName.trim(),
        familyName: familyName.trim(),
        rcicLicense: license,
      });
      toast.success("Check your email for a confirmation code.");
      router.push(`/verify?email=${encodeURIComponent(email)}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "sign-up-failed");
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
            Create your account
          </h1>
          <p className="text-[12px] text-ink-secondary text-center">
            For CICC-licensed consultants.
          </p>
        </div>
      </div>

      <div className="h-px bg-border" />

      <form onSubmit={onSubmit} className="space-y-5">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="given" className="label">First name</Label>
            <Input id="given" required value={givenName} onChange={(e) => setGivenName(e.target.value)} className="h-10" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="family" className="label">Last name</Label>
            <Input id="family" required value={familyName} onChange={(e) => setFamilyName(e.target.value)} className="h-10" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="email" className="label">Email</Label>
          <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="h-10" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rcic" className="label">CICC R-license</Label>
          <Input id="rcic" required placeholder="R527888" value={rcicLicense} onChange={(e) => setRcicLicense(e.target.value)} className="h-10 font-mono" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password" className="label">Password</Label>
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
          <p className="text-[11px] text-ink-tertiary">12+ characters, upper, lower, digit, symbol.</p>
        </div>
        <button
          type="submit"
          disabled={busy}
          className="w-full h-10 rounded-sm bg-primary text-primary-foreground text-[13px] font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {busy ? "Creating" : "Create account"}
        </button>
      </form>

      <div className="text-center text-[12px] text-ink-secondary">
        Already have an account?{" "}
        <Link href="/login" className="text-ink-primary underline underline-offset-4 decoration-border">
          Sign in
        </Link>
      </div>
    </div>
  );
}
