"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Impact, Brief } from "@/lib/argus-types";
import { useAuth } from "@/components/auth-context";
import { Seal } from "@/components/seal";
import { ChevronRight } from "lucide-react";
import { formatDelta, formatRelative } from "@/lib/format";

export default function DashboardPage() {
  const auth = useAuth();
  const impacts = useQuery({
    queryKey: ["impacts"],
    queryFn: () => api<{ impacts: Impact[] }>("/impacts"),
  });
  const briefs = useQuery({
    queryKey: ["briefs"],
    queryFn: () => api<{ briefs: Brief[] }>("/briefs"),
  });

  const affectedCount = impacts.data?.impacts.filter((i) => i.isAffected).length ?? 0;
  const signedCount = impacts.data?.impacts.filter((i) => i.signatureAlgorithm).length ?? 0;
  const pendingBriefs = briefs.data?.briefs.filter((b) => b.status !== "sent").length ?? 0;
  const sentBriefs = briefs.data?.briefs.filter((b) => b.status === "sent").length ?? 0;

  const recent = (impacts.data?.impacts ?? []).slice(0, 8);

  return (
    <div className="space-y-10">
      <header className="space-y-1">
        <div className="label">Overview</div>
        <h1
          className="text-[28px] font-medium tracking-tight text-ink-primary leading-tight"
          style={{ fontFamily: "var(--font-newsreader), serif" }}
        >
          Good to see you, {auth.claims?.givenName ?? "Consultant"}.
        </h1>
        <p className="text-[13px] text-ink-secondary">
          Argus watched IRCC while you were away. Everything below is signed and archived.
        </p>
      </header>

      <div className="grid grid-cols-[1fr_280px] gap-10">
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="label">Recent assessments</div>
            <Link
              href="/impacts"
              className="flex items-center gap-0.5 text-[11px] text-ink-secondary hover:text-ink-primary"
            >
              View all
              <ChevronRight className="h-3 w-3" strokeWidth={1.75} />
            </Link>
          </div>
          <div className="rounded-md border border-border bg-surface overflow-hidden">
            {impacts.isLoading ? (
              <div className="py-16 text-center label">Loading</div>
            ) : recent.length === 0 ? (
              <div className="py-16 text-center">
                <div className="label">Nothing yet</div>
                <p className="mt-2 text-[12px] text-ink-tertiary">Sentinel will surface changes as they land.</p>
              </div>
            ) : (
              <ul className="divide-y divide-divider">
                {recent.map((i) => {
                  const signed = !!i.signatureAlgorithm;
                  return (
                    <li key={i.assessmentKey}>
                      <Link
                        href={`/impacts/${encodeURIComponent(i.assessmentKey)}`}
                        className="grid grid-cols-[16px_1fr_auto] items-center gap-4 px-4 py-3 hover:bg-surface-alt/50 transition-colors"
                      >
                        <StateDot signed={signed} isAffected={i.isAffected} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-3">
                            <span className="text-[13px] font-medium text-ink-primary truncate">{i.topic}</span>
                            <ClientChip id={i.clientId} />
                          </div>
                          <div className="mt-0.5 text-[11px] text-ink-tertiary tabular truncate">
                            {formatRelative(i.timestamp)}
                            {signed && i.canonicalHash && (
                              <>
                                {" · "}
                                <span className="fingerprint">
                                  sig {i.canonicalHash.slice(0, 8)}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                        <DeltaChip delta={i.numericDelta} type={i.impactType} />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>

        <aside className="space-y-6">
          <StatBlock label="Affected clients" value={affectedCount} />
          <StatBlock label="Signed assessments" value={signedCount} accent />
          <StatBlock label="Briefs drafted" value={pendingBriefs} />
          <StatBlock label="Briefs sent" value={sentBriefs} />
        </aside>
      </div>
    </div>
  );
}

function StatBlock({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div
        className={
          "mt-1 text-[32px] leading-none font-medium tabular tracking-tight " +
          (accent ? "text-seal" : "text-ink-primary")
        }
      >
        {value}
      </div>
    </div>
  );
}

function StateDot({ signed, isAffected }: { signed: boolean; isAffected: boolean }) {
  if (signed) {
    return <Seal className="h-3.5 w-3.5 text-seal" />;
  }
  if (isAffected) {
    return <span className="h-2 w-2 rounded-full bg-amber block ml-[3px]" title="Pending signature" />;
  }
  return <span className="h-2 w-2 rounded-full border border-ink-tertiary block ml-[3px]" title="No impact" />;
}

function ClientChip({ id }: { id: string }) {
  return <span className="client-chip">{id}</span>;
}

function DeltaChip({ delta, type }: { delta: number | null; type: string }) {
  if (delta === null || type === "none") {
    return (
      <span className="text-[11px] uppercase tracking-wider text-ink-tertiary">
        no impact
      </span>
    );
  }
  const negative = delta < 0;
  return (
    <span
      className={
        "rounded-sm px-2 py-0.5 text-[12px] font-medium tabular " +
        (negative ? "bg-red-subtle text-red" : "bg-seal-subtle text-seal")
      }
    >
      {formatDelta(delta)}
    </span>
  );
}
