"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { confirmSignUp, resendConfirmationCode } from "@/lib/auth";
import { Shield } from "lucide-react";

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
    <div className="space-y-6">
      <div className="flex flex-col items-center gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Shield className="h-5 w-5" />
        </div>
        <h1 className="text-lg font-semibold tracking-tight">Confirm your email</h1>
        <p className="text-center text-xs text-muted-foreground">
          Enter the 6-digit code we emailed you.
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="code">Confirmation code</Label>
          <Input
            id="code"
            inputMode="numeric"
            pattern="[0-9]*"
            required
            maxLength={10}
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </div>
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "Confirming..." : "Confirm"}
        </Button>
      </form>

      <div className="text-center">
        <button
          type="button"
          onClick={onResend}
          className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          Resend confirmation code
        </button>
      </div>
    </div>
  );
}

export default function VerifyPage() {
  return (
    <Suspense fallback={<div className="text-center text-sm text-muted-foreground">Loading...</div>}>
      <VerifyForm />
    </Suspense>
  );
}
