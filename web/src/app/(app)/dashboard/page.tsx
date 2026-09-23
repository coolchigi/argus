"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Impact, Brief } from "@/lib/argus-types";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/components/auth-context";
import { ArrowRight, FileSignature, Mail, ShieldCheck } from "lucide-react";
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

  const recentImpacts = (impacts.data?.impacts ?? []).slice(0, 5);
  const recentBriefs = (briefs.data?.briefs ?? []).slice(0, 5);

  const greetingName = auth.claims?.givenName ?? "there";

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Welcome back, {greetingName}.</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Argus is watching IRCC for you. Here&apos;s what changed.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <Stat label="Affected clients" value={affectedCount} accent icon={<FileSignature className="h-4 w-4" />} />
        <Stat label="Signed assessments" value={signedCount} icon={<ShieldCheck className="h-4 w-4" />} />
        <Stat label="Pending briefs" value={pendingBriefs} icon={<Mail className="h-4 w-4" />} />
        <Stat label="Briefs sent" value={sentBriefs} muted />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SectionCard
          title="Recent impact assessments"
          href="/impacts"
          hrefLabel="View all"
          empty={recentImpacts.length === 0 && !impacts.isLoading}
          loading={impacts.isLoading}
        >
          <ul className="divide-y divide-border">
            {recentImpacts.map((i) => (
              <li key={i.assessmentKey} className="py-3">
                <Link
                  href={`/impacts/${encodeURIComponent(i.assessmentKey)}`}
                  className="flex items-start justify-between gap-3 hover:bg-accent/40 -mx-3 rounded-md px-3 py-2 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-medium">{i.clientId}</span>
                      <span className="text-xs text-muted-foreground truncate">{i.topic}</span>
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{i.narrative}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <DeltaChip delta={i.numericDelta} type={i.impactType} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </SectionCard>

        <SectionCard
          title="Recent briefs"
          href="/briefs"
          hrefLabel="View all"
          empty={recentBriefs.length === 0 && !briefs.isLoading}
          loading={briefs.isLoading}
        >
          <ul className="divide-y divide-border">
            {recentBriefs.map((b) => (
              <li key={b.briefId} className="py-3">
                <Link
                  href={`/briefs/${b.briefId}`}
                  className="flex items-start justify-between gap-3 hover:bg-accent/40 -mx-3 rounded-md px-3 py-2 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-medium truncate">{b.subject}</span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{b.clientId}</span>
                      <span>·</span>
                      <span>{formatRelative(b.createdAt)}</span>
                    </div>
                  </div>
                  <BriefStatusBadge status={b.status} />
                </Link>
              </li>
            ))}
          </ul>
        </SectionCard>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
  muted,
  icon,
}: {
  label: string;
  value: number;
  accent?: boolean;
  muted?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        {icon && <span className="text-muted-foreground">{icon}</span>}
      </div>
      <div
        className={
          "mt-2 text-2xl font-semibold tabular tracking-tight " +
          (accent ? "text-primary" : muted ? "text-muted-foreground" : "text-foreground")
        }
      >
        {value}
      </div>
    </Card>
  );
}

function SectionCard({
  title,
  href,
  hrefLabel,
  loading,
  empty,
  children,
}: {
  title: string;
  href: string;
  hrefLabel: string;
  loading?: boolean;
  empty?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        <Link href={href} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          {hrefLabel} <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
      {loading ? (
        <div className="py-6 text-center text-xs text-muted-foreground">Loading...</div>
      ) : empty ? (
        <div className="py-6 text-center text-xs text-muted-foreground">Nothing yet.</div>
      ) : (
        children
      )}
    </Card>
  );
}

function DeltaChip({ delta, type }: { delta: number | null; type: string }) {
  if (delta === null || type === "none") {
    return (
      <span className="rounded-md bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        {type}
      </span>
    );
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

function BriefStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    draft: "bg-muted text-muted-foreground",
    edited: "bg-accent text-accent-foreground",
    sent: "bg-primary/10 text-primary",
  };
  return (
    <Badge className={"h-5 border-0 " + (map[status] ?? "bg-muted text-muted-foreground")}>{status}</Badge>
  );
}
