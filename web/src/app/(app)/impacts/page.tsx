"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Impact } from "@/lib/argus-types";
import { Input } from "@/components/ui/input";
import { Seal } from "@/components/seal";
import { formatDelta, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Search } from "lucide-react";

type Filter = "all" | "signed" | "pending" | "corrected";

export default function ImpactsPage() {
  const q = useQuery({
    queryKey: ["impacts"],
    queryFn: () => api<{ impacts: Impact[] }>("/impacts"),
  });
  const all = q.data?.impacts ?? [];
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return all.filter((i) => {
      if (filter === "signed" && !i.signatureAlgorithm) return false;
      if (filter === "pending" && i.signatureAlgorithm) return false;
      if (filter === "corrected") return false; // reserved for a future correction-status field
      if (!term) return true;
      return (
        i.clientId.toLowerCase().includes(term) ||
        i.topic.toLowerCase().includes(term) ||
        (i.narrative ?? "").toLowerCase().includes(term)
      );
    });
  }, [all, filter, search]);

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <div className="label">Assessments</div>
        <h1
          className="text-[24px] font-medium tracking-tight text-ink-primary leading-tight"
          style={{ fontFamily: "var(--font-newsreader), serif" }}
        >
          Signed policy-impact assessments
        </h1>
        <p className="text-[13px] text-ink-secondary">
          Every row was reviewed by Analyst and Auditor from different model families, then anchored with an
          ECDSA signature you can verify in your browser.
        </p>
      </header>

      <div className="flex items-center gap-3">
        <FilterPills value={filter} onChange={setFilter} counts={counts(all)} />
        <div className="ml-auto relative w-[280px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-tertiary" strokeWidth={1.75} />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search client, topic, wording"
            className="h-8 pl-8 text-[13px]"
          />
        </div>
      </div>

      <div className="rounded-md border border-border bg-surface overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              <Th className="w-[110px]">Status</Th>
              <Th>Topic</Th>
              <Th>Client</Th>
              <Th align="right">Delta</Th>
              <Th className="w-[120px]">Fingerprint</Th>
              <Th align="right" className="w-[120px]">When</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-divider">
            {q.isLoading ? (
              <tr>
                <td colSpan={6} className="py-16 text-center label">Loading</td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-16 text-center">
                  <div className="label">Nothing matches</div>
                  <p className="mt-2 text-[12px] text-ink-tertiary">Adjust the filter or clear the search.</p>
                </td>
              </tr>
            ) : (
              rows.map((i) => (
                <tr key={i.assessmentKey} className="h-11 hover:bg-surface-alt/50 transition-colors">
                  <Td>
                    <StatusPill impact={i} />
                  </Td>
                  <Td>
                    <Link
                      href={`/impacts/${encodeURIComponent(i.assessmentKey)}`}
                      className="text-[13px] font-medium text-ink-primary hover:underline underline-offset-4 decoration-border"
                    >
                      {i.topic}
                    </Link>
                  </Td>
                  <Td>
                    <span className="client-chip">{i.clientId}</span>
                  </Td>
                  <Td align="right">
                    <DeltaChip delta={i.numericDelta} type={i.impactType} />
                  </Td>
                  <Td>
                    {i.canonicalHash ? (
                      <span className="fingerprint">{i.canonicalHash.slice(0, 8)}</span>
                    ) : (
                      <span className="text-[11px] text-ink-tertiary">—</span>
                    )}
                  </Td>
                  <Td align="right">
                    <span className="text-[11px] text-ink-tertiary tabular">{formatRelative(i.timestamp)}</span>
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

function counts(impacts: Impact[]) {
  return {
    all: impacts.length,
    signed: impacts.filter((i) => i.signatureAlgorithm).length,
    pending: impacts.filter((i) => !i.signatureAlgorithm).length,
    corrected: 0,
  };
}

function FilterPills({
  value,
  onChange,
  counts,
}: {
  value: Filter;
  onChange: (f: Filter) => void;
  counts: Record<Filter, number>;
}) {
  const OPTIONS: Array<{ v: Filter; label: string }> = [
    { v: "all", label: "All" },
    { v: "signed", label: "Signed" },
    { v: "pending", label: "Pending" },
    { v: "corrected", label: "Corrections" },
  ];
  return (
    <div className="inline-flex items-center gap-0.5 rounded-md border border-border p-0.5">
      {OPTIONS.map((o) => (
        <button
          key={o.v}
          type="button"
          onClick={() => onChange(o.v)}
          className={cn(
            "flex h-7 items-center gap-1.5 rounded-sm px-2.5 text-[12px] transition-colors",
            value === o.v
              ? "bg-surface-alt text-ink-primary font-medium"
              : "text-ink-secondary hover:text-ink-primary",
          )}
        >
          {o.label}
          <span className="text-[11px] tabular text-ink-tertiary">{counts[o.v]}</span>
        </button>
      ))}
    </div>
  );
}

function StatusPill({ impact }: { impact: Impact }) {
  if (impact.signatureAlgorithm) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[12px] text-seal">
        <Seal className="h-3 w-3" />
        Signed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-amber">
      <span className="h-2 w-2 rounded-full bg-amber" />
      Pending
    </span>
  );
}

function Th({
  children,
  align = "left",
  className = "",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <th
      className={cn(
        "px-4 py-2.5 label",
        align === "right" ? "text-right" : "text-left",
        className,
      )}
    >
      {children}
    </th>
  );
}

function Td({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <td className={cn("px-4", align === "right" ? "text-right" : "text-left")}>{children}</td>
  );
}

function DeltaChip({ delta, type }: { delta: number | null; type: string }) {
  if (delta === null || type === "none") {
    return <span className="text-[11px] text-ink-tertiary">—</span>;
  }
  const negative = delta < 0;
  return (
    <span
      className={cn(
        "inline-block rounded-sm px-1.5 py-0.5 text-[12px] font-medium tabular",
        negative ? "bg-red-subtle text-red" : "bg-seal-subtle text-seal",
      )}
    >
      {formatDelta(delta)}
    </span>
  );
}
