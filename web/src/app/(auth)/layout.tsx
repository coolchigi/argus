import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-start justify-center bg-canvas px-4 pt-24 pb-12">
      <div className="w-full max-w-[400px]">{children}</div>
    </div>
  );
}
