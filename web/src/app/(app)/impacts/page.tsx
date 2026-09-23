"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Impact } from "@/lib/argus-types";
import { formatDelta, formatRelative } from "@/lib/format";
import { ShieldCheck } from "lucide-react";

export default function ImpactsPage() {
  const q = useQuery({
    queryKey: ["impacts"],
    queryFn: () => api<{ impacts: Impact[] }>("/impacts"),
  });
  const rows = q.data?.impacts ?? [];

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <div className="label">Assessments</div>
        <h1 className="text-xl font-semibold tracking-tight">Impact assessments</h1>
        <p className="text-[12px] text-muted-foreground">
          Cross-family verified (Nova Pro analyst, Claude auditor) and KMS-signed. Every row is receipt-worthy.
        </p>
      </header>

      <div className="border border-border bg-card rounded-md overflow-hidden">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <Th>Client</Th>
              <Th>Topic</Th>
              <Th>Impact</Th>
              <Th align="right">Delta</Th>
              <Th>Confidence</Th>
              <Th>Signed</Th>
              <Th align="right">Time</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {q.isLoading ? (
              <tr>
                <td colSpan={7} className="py-10 text-center text-[11px] text-muted-foreground">
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-10 text-center text-[11px] text-muted-foreground">
                  No assessments yet. When Sentinel catches a policy change, rows land here.
                </td>
              </tr>
            ) : (
              rows.map((i) => (
                <tr key={i.assessmentKey} className="row group hover:bg-accent/40 transition-colors">
                  <Td>
                    <Link
                      href={`/impacts/${encodeURIComponent(i.assessmentKey)}`}
                      className="font-medium tabular hover:underline"
                    >
                      {i.clientId}
                    </Link>
                  </Td>
                  <Td>
                    <span className="text-muted-foreground">{i.topic}</span>
                  </Td>
                  <Td>
                    <span className="text-muted-foreground">{i.impactType}</span>
                  </Td>
                  <Td align="right">
                    <DeltaChip delta={i.numericDelta} type={i.impactType} />
                  </Td>
                  <Td>
                    <ConfidenceDot confidence={i.confidence} />
                  </Td>
                  <Td>
                    {i.signatureAlgorithm ? (
                      <span className="inline-flex items-center gap-1 text-[11px] text-brand">
                        <ShieldCheck className="h-3 w-3" strokeWidth={1.75} /> ECDSA
                      </span>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">—</span>
                    )}
                  </Td>
                  <Td align="right">
                    <span className="text-[11px] text-muted-foreground tabular">
                      {formatRelative(i.timestamp)}
                    </span>
                  </Td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <th
      className={
        "h-8 px-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground " +
        (align === "right" ? "text-right" : "text-left")
      }
    >
      {children}
    </th>
  );
}

function Td({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <td className={"px-3 " + (align === "right" ? "text-right" : "text-left")}>{children}</td>
  );
}

function DeltaChip({ delta, type }: { delta: number | null; type: string }) {
  if (delta === null || type === "none") {
    return <span className="text-[11px] text-muted-foreground">—</span>;
  }
  const negative = delta < 0;
  return (
    <span
      className={
        "inline-block rounded-sm px-1.5 py-0.5 text-[11px] font-medium tabular " +
        (negative ? "bg-destructive/10 text-destructive" : "bg-brand-subtle text-brand")
      }
    >
      {formatDelta(delta)}
    </span>
  );
}

function ConfidenceDot({ confidence }: { confidence: string }) {
  const color =
    confidence === "high" ? "bg-brand" : confidence === "medium" ? "bg-amber-500" : "bg-muted-foreground";
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <span className={"h-1.5 w-1.5 rounded-full " + color} />
      {confidence}
    </span>
  );
}
