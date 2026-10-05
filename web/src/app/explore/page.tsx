"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { useAuth } from "@/components/auth-context";
import { ProgressLine } from "@/components/argus/progress-line";
import { startTour } from "@/lib/demo-tour-store";

// Opens the read-only demo without an account, with the guided tour on. A
// signed-in consultant goes straight to their own dashboard.
export default function ExplorePage() {
  const auth = useAuth();
  const router = useRouter();
  const done = useRef(false);

  useEffect(() => {
    if (auth.status === "loading" || done.current) return;
    done.current = true;
    if (auth.status === "anonymous") {
      auth.enterGuest();
      startTour();
    }
    router.replace("/dashboard");
  }, [auth, router]);

  return (
    <div className="flex h-screen items-center justify-center bg-canvas">
      <ProgressLine active fixed label="Opening the demo" />
      <div className="label">Opening the demo</div>
    </div>
  );
}
