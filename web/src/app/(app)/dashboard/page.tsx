"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Impact, Brief } from "@/lib/argus-types";
import { useAuth } from "@/components/auth-context";
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

  const recentImpacts = (impacts.data?.impacts ?? []).slice(0, 6);
  const recentBriefs = (briefs.data?.briefs ?? []).slice(0, 6);

  return (
    <div className="space-y-10">
      <header className="space-y-1">
        <div className="label">Overview</div>
        <h1 className="text-xl font-semibold tracking-tight">
          {auth.claims?.givenName ?? "Consultant"}&rsquo;s workspace
        </h1>
      </header>

      <section className="grid grid-cols-4 divide-x divide-border border border-border bg-card rounded-md">
        <Stat label="Affected clients" value={affectedCount} accent />
        <Stat label="Signed assessments" value={signedCount} />
        <Stat label="Draft briefs" value={pendingBriefs} />
        <Stat label="Briefs sent" value={sentBriefs} />
      </section>

      <div className="grid grid-cols-2 gap-8">
        <Section title="Recent assessments" href="/impacts">
          {impacts.isLoading ? (
            <Empty>Loading…</Empty>
          ) : recentImpacts.length === 0 ? (
            <Empty>No assessments yet.</Empty>
          ) : (
            <ul className="divide-y divide-border">
              {recentImpacts.map((i) => (
                <li key={i.assessmentKey}>
                  <Link
                    href={`/impacts/${encodeURIComponent(i.assessmentKey)}`}
                    className="row -mx-2 flex items-center gap-3 rounded-sm px-2 transition-colors hover:bg-accent/50"
                  >
                    <span className="w-14 text-[13px] font-medium tabular">{i.clientId}</span>
                    <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">
                      {i.topic}
                    </span>
                    <DeltaChip delta={i.numericDelta} type={i.impactType} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Recent briefs" href="/briefs">
          {briefs.isLoading ? (
            <Empty>Loading…</Empty>
          ) : recentBriefs.length === 0 ? (
            <Empty>No briefs yet.</Empty>
          ) : (
            <ul className="divide-y divide-border">
              {recentBriefs.map((b) => (
                <li key={b.briefId}>
                  <Link
                    href={`/briefs/${b.briefId}`}
                    className="row -mx-2 flex items-center gap-3 rounded-sm px-2 transition-colors hover:bg-accent/50"
                  >
                    <span className="min-w-0 flex-1 truncate text-[13px]">{b.subject}</span>
                    <span className="text-[11px] tabular text-muted-foreground">
                      {formatRelative(b.createdAt)}
                    </span>
                    <StatusPill status={b.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="p-4">
      <div className="label">{label}</div>
      <div
        className={
          "mt-1 text-3xl font-semibold tabular tracking-tight " +
          (accent ? "text-foreground" : "text-foreground")
        }
      >
        {value}
      </div>
    </div>
  );
}

function Section({
  title,
  href,
  children,
}: {
  title: string;
  href: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="label">{title}</h2>
        <Link
          href={href}
          className="flex items-center gap-0.5 text-[11px] text-muted-foreground hover:text-foreground"
        >
          View all
          <ChevronRight className="h-3 w-3" strokeWidth={1.75} />
        </Link>
      </div>
      <div className="border border-border bg-card rounded-md p-2">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="py-8 text-center text-[11px] text-muted-foreground">{children}</div>;
}

function DeltaChip({ delta, type }: { delta: number | null; type: string }) {
  if (delta === null || type === "none") {
    return (
      <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        {type}
      </span>
    );
  }
  const negative = delta < 0;
  return (
    <span
      className={
        "rounded-sm px-1.5 py-0.5 text-[11px] font-medium tabular " +
        (negative ? "bg-destructive/10 text-destructive" : "bg-brand-subtle text-brand")
      }
    >
      {formatDelta(delta)}
    </span>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    draft: "bg-muted text-muted-foreground",
    edited: "bg-accent text-accent-foreground",
    sent: "bg-brand-subtle text-brand",
  };
  return (
    <span
      className={
        "rounded-sm px-1.5 py-0.5 text-[10px] uppercase tracking-wider " +
        (map[status] ?? "bg-muted text-muted-foreground")
      }
    >
      {status}
    </span>
  );
}
