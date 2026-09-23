"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Impact } from "@/lib/argus-types";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDelta, formatRelative, truncateHash } from "@/lib/format";
import { ShieldCheck } from "lucide-react";

export default function ImpactsPage() {
  const q = useQuery({
    queryKey: ["impacts"],
    queryFn: () => api<{ impacts: Impact[] }>("/impacts"),
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Impact assessments</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every assessment is cross-family verified (Nova Pro analyst + Claude auditor) and KMS-signed.
        </p>
      </header>

      <Card className="p-0 overflow-hidden">
        {q.isLoading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Loading assessments...</div>
        ) : (q.data?.impacts.length ?? 0) === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No assessments yet. When Sentinel detects a policy change, cascaded impact rows land here.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead>Topic</TableHead>
                <TableHead>Impact</TableHead>
                <TableHead className="text-right">Delta</TableHead>
                <TableHead>Confidence</TableHead>
                <TableHead>Signed</TableHead>
                <TableHead className="text-right">When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.data!.impacts.map((i) => (
                <TableRow key={i.assessmentKey} className="cursor-pointer">
                  <TableCell>
                    <Link
                      href={`/impacts/${encodeURIComponent(i.assessmentKey)}`}
                      className="font-medium text-foreground hover:underline"
                    >
                      {i.clientId}
                    </Link>
                    <div className="mt-0.5 text-[11px] text-muted-foreground truncate max-w-[200px]">
                      {truncateHash(i.assessmentKey, 24)}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs">{i.topic}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{i.impactType}</TableCell>
                  <TableCell className="text-right tabular">
                    <DeltaChip delta={i.numericDelta} type={i.impactType} />
                  </TableCell>
                  <TableCell>
                    <ConfidenceDot confidence={i.confidence} />
                  </TableCell>
                  <TableCell>
                    {i.signatureAlgorithm ? (
                      <span className="inline-flex items-center gap-1 text-[11px] text-primary">
                        <ShieldCheck className="h-3 w-3" /> ECDSA
                      </span>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-[11px] text-muted-foreground">
                    {formatRelative(i.timestamp)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
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
        "rounded-md px-2 py-0.5 text-xs tabular font-medium " +
        (negative ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary")
      }
    >
      {formatDelta(delta)}
    </span>
  );
}

function ConfidenceDot({ confidence }: { confidence: string }) {
  const color =
    confidence === "high" ? "bg-primary" : confidence === "medium" ? "bg-amber-500" : "bg-muted-foreground";
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <span className={"h-1.5 w-1.5 rounded-full " + color} />
      {confidence}
    </span>
  );
}
