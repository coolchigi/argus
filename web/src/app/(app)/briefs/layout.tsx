import type { ReactNode } from "react";
import { BriefsWorkspace } from "@/components/briefs/briefs-workspace";

// The list pane lives here so it stays mounted while /briefs/[id] swaps.
export default function BriefsLayout({ children }: { children: ReactNode }) {
  return <BriefsWorkspace>{children}</BriefsWorkspace>;
}
