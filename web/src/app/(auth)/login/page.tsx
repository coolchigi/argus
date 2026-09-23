"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/components/auth-context";
import { signIn } from "@/lib/auth";
import { Shield } from "lucide-react";

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
    <div className="space-y-6">
      <div className="flex flex-col items-center gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Shield className="h-5 w-5" />
        </div>
        <h1 className="text-lg font-semibold tracking-tight">Sign in to Argus</h1>
        <p className="text-xs text-muted-foreground">Policy-impact assessments for RCICs.</p>
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "Signing in..." : "Sign in"}
        </Button>
      </form>

      <div className="text-center text-xs text-muted-foreground">
        New to Argus?{" "}
        <Link href="/signup" className="font-medium text-foreground underline underline-offset-2">
          Create an account
        </Link>
      </div>
    </div>
  );
}
