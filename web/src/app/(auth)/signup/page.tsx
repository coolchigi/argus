"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signUp } from "@/lib/auth";
import { Shield } from "lucide-react";

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
      toast.error("R-license should be one letter followed by 6-7 digits, e.g. R527888.");
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
    <div className="space-y-6">
      <div className="flex flex-col items-center gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Shield className="h-5 w-5" />
        </div>
        <h1 className="text-lg font-semibold tracking-tight">Create your Argus account</h1>
        <p className="text-center text-xs text-muted-foreground">
          For Regulated Canadian Immigration Consultants. R-license required.
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="given">First name</Label>
            <Input id="given" required value={givenName} onChange={(e) => setGivenName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="family">Last name</Label>
            <Input id="family" required value={familyName} onChange={(e) => setFamilyName(e.target.value)} />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="rcic">CICC R-license</Label>
          <Input id="rcic" required placeholder="R527888" value={rcicLicense} onChange={(e) => setRcicLicense(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <p className="text-[11px] text-muted-foreground">
            12+ characters, upper, lower, digit, symbol.
          </p>
        </div>
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "Creating account..." : "Create account"}
        </Button>
      </form>

      <div className="text-center text-xs text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-foreground underline underline-offset-2">
          Sign in
        </Link>
      </div>
    </div>
  );
}
