"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth-context";

export default function LandingPage() {
  const router = useRouter();
  const auth = useAuth();

  useEffect(() => {
    if (auth.status === "authed") router.replace("/dashboard");
    else if (auth.status === "anonymous") router.replace("/login");
  }, [auth.status, router]);

  return (
    <div className="flex h-screen items-center justify-center">
      <div className="text-sm text-muted-foreground">Loading Argus...</div>
    </div>
  );
}
