"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { humanizeTopic } from "@/lib/humanize";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { statsLine } from "@/lib/public-stats";
import { JWKS_PATH, SAMPLE_RECEIPT_HASH, SAMPLE_RECEIPT_TOPIC } from "@/lib/sample-receipt";
import type { PublicStats } from "@/lib/types/public";
import { useAuth } from "@/components/auth-context";
import { Seal } from "@/components/seal";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { cn } from "@/lib/utils";
import { ArrowUpRight } from "lucide-react";

const AGENTS = [
  { name: "Sentinel", role: "Watches IRCC hourly", model: "Nova Micro" },
  { name: "Analyst", role: "Reasons per client", model: "Nova Pro" },
  { name: "Auditor", role: "Adversarial review", model: "Claude Haiku 4.5" },
  { name: "Anchor", role: "Signs and archives", model: "AWS KMS · P-256" },
  { name: "Composer", role: "Drafts the client email", model: "Nova Lite" },
  { name: "Recall", role: "Re-checks recent changes nightly", model: "Nova Micro" },
];

export default function LandingPage() {
  const router = useRouter();
  const auth = useAuth();

  useEffect(() => {
    if (auth.status === "authed") router.replace("/dashboard");
  }, [auth.status, router]);

  if (auth.status === "authed") {
    return null;
  }

  return (
    <div className="min-h-screen bg-canvas text-ink-1">
      <SiteHeader
        nav={
          <>
            <Link href="/login" className="text-ink-2 hover:text-ink-1 transition-colors">
              Sign in
            </Link>
            <Link
              href="/signup"
              className="inline-flex h-8 items-center rounded-sm border border-brand-ink bg-brand px-3 text-[13px] font-medium text-on-brand transition-colors hover:bg-brand-hover"
            >
              Create account
            </Link>
          </>
        }
      />
      <main id="main">
        <Hero />
        <PipelineSection />
        <TrustSection />
        <FooterCta />
      </main>
      <SiteFooter />
    </div>
  );
}

function Hero() {
  return (
    <section className="mx-auto max-w-[1080px] px-6 pt-24 pb-20">
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-12 items-start">
        <div>
          <div className="label">Argus · policy-impact platform</div>
          <h1
            className="mt-3 font-display text-[52px] leading-[1.05] text-ink-1"
          >
            Every impact assessment,
            <br />
            signed and archived.
          </h1>
          <p className="mt-6 max-w-[480px] text-[16px] leading-relaxed text-ink-2">
            Argus watches IRCC for you. When something changes, six AI agents review the impact on your
            caseload and sign the finding. You get a draft brief per client and a receipt an auditor can verify.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href="/signup"
              className="inline-flex h-10 items-center rounded-sm border border-brand-ink bg-brand px-4 text-[13px] font-medium text-on-brand transition-colors hover:bg-brand-hover"
            >
              Start with your R-license
            </Link>
            <Link
              href="/login"
              className="inline-flex h-10 items-center rounded-sm border border-control bg-surface px-4 text-[13px] font-medium text-ink-1 transition-colors hover:bg-sunk"
            >
              Sign in
            </Link>
          </div>
          <ActivityLine />
        </div>

        <div className="lg:pt-8">
          <SampleReceipt />
        </div>
      </div>
    </section>
  );
}

/**
 * "N assessments signed in the last 7 days", from GET /public/stats. Renders
 * nothing while loading, on error, or when the 7-day number is zero.
 */
function ActivityLine() {
  const stats = useQuery({
    queryKey: ["public-stats"],
    queryFn: () => api<PublicStats>("/public/stats", { requireAuth: false }),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const line = statsLine(stats.data);
  if (!line) return null;
  return (
    <p className="mt-6 flex items-center gap-2 text-[12px] text-ink-2">
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-brand" />
      <span className="tabular">{line}</span>
    </p>
  );
}

function SampleReceipt() {
  const SAMPLE_HASH = SAMPLE_RECEIPT_HASH;
  const SAMPLE_TOPIC = SAMPLE_RECEIPT_TOPIC;
  return (
    <div className="rounded-[8px] border border-hairline bg-card p-6 space-y-5">
      <div className="flex items-center gap-2">
        <Seal className="h-3.5 w-3.5 text-seal" />
        <span className="label text-seal">Live sample receipt</span>
      </div>
      <div className="space-y-3">
        <div>
          <div className="label">Topic</div>
          <div className="mt-1 text-[13px] text-ink-1">
            {humanizeTopic(SAMPLE_TOPIC)}
          </div>
        </div>
        <div>
          <div className="label">Fingerprint</div>
          <div className="mt-1 fingerprint-lg text-ink-1">
            {SAMPLE_HASH.slice(0, 4)} {SAMPLE_HASH.slice(4, 8)} {SAMPLE_HASH.slice(8, 12)} {SAMPLE_HASH.slice(12, 16)}
          </div>
        </div>
        <div>
          <div className="label">Algorithm</div>
          <div className="mt-1 text-[13px] text-ink-1">ECDSA P-256 (SHA-256)</div>
        </div>
        <div>
          <div className="label">Signed by</div>
          <div className="mt-1 text-[13px] text-ink-1">AWS KMS key <span className="fingerprint text-ink-2">8b3b43ef…</span></div>
        </div>
      </div>
      <div className="border-t border-hairline pt-4">
        <Link
          href={`/verify/${SAMPLE_HASH}`}
          className="inline-flex items-center gap-1.5 text-[12px] font-medium text-ink-1 hover:underline underline-offset-4 decoration-hairline"
        >
          Open and verify in your browser
          <ArrowUpRight className="h-3 w-3 text-ink-3" strokeWidth={1.75} />
        </Link>
      </div>
    </div>
  );
}

function PipelineSection() {
  const [visible, setVisible] = useState<boolean[]>(AGENTS.map(() => false));

  useEffect(() => {
    // 60ms Disney overlap between cards.
    AGENTS.forEach((_, i) => {
      window.setTimeout(() => {
        setVisible((v) => {
          const next = [...v];
          next[i] = true;
          return next;
        });
      }, 120 + i * 60);
    });
  }, []);

  return (
    <section className="border-t border-hairline">
      <div className="mx-auto max-w-[1080px] px-6 py-20">
        <div className="max-w-[640px] mb-10">
          <div className="label">How it works</div>
          <h2
            className="mt-2 text-[28px] font-display text-ink-1"
          >
            Six agents check every change.
          </h2>
          <p className="mt-3 text-[14px] leading-relaxed text-ink-2">
            Nova Pro reasons, Claude audits from a different model family, KMS signs. No single model is
            trusted alone. Every claim on your assessment carries a receipt you can verify.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {AGENTS.map((agent, i) => (
            <div
              key={agent.name}
              className={cn(
                "border border-hairline bg-card p-4 transition-all duration-[220ms] ease-[cubic-bezier(0.2,0.9,0.3,1)]",
                visible[i] ? "opacity-100 translate-y-0" : "opacity-0 translate-y-1",
              )}
            >
              <div className="flex items-baseline justify-between">
                <div className="text-[13px] font-medium text-ink-1">{agent.name}</div>
                <div className="font-mono text-[11px] text-ink-3 tabular">{i + 1}</div>
              </div>
              <div className="mt-2 text-[12px] text-ink-2 leading-relaxed">{agent.role}</div>
              <div className="mt-3 fingerprint text-ink-3 text-[11px]">{agent.model}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function TrustSection() {
  return (
    <section className="border-t border-hairline bg-sunk/40">
      <div className="mx-auto max-w-[1080px] px-6 py-20">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-12">
          <div>
            <div className="label">The audit trail</div>
            <h2
              className="mt-2 text-[28px] font-display text-ink-1"
            >
              A receipt a CICC auditor can verify years from now.
            </h2>
            <p className="mt-3 text-[14px] leading-relaxed text-ink-2">
              Every assessment is signed with an ECDSA P-256 key managed by AWS KMS. Anyone with the
              fingerprint can check the signature in their own browser.
            </p>
            <p className="mt-3 text-[14px] leading-relaxed text-ink-2">
              CICC Client File Management Regulation s. 7.2 requires 6-year retention on file records.
              Argus retains signed assessments indefinitely by default. Export on demand.
            </p>
          </div>

          <div className="space-y-4">
            <div className="border border-hairline bg-card p-4">
              <div className="label">Public receipts</div>
              <Link
                href="/verify"
                className="mt-2 inline-block fingerprint text-ink-1 break-all underline-offset-4 decoration-hairline hover:underline"
              >
                tryargus.ca/verify
              </Link>
            </div>
            <div className="border border-hairline bg-card p-4">
              <div className="label">Public key (JWKS)</div>
              <a
                href={JWKS_PATH}
                className="mt-2 inline-block fingerprint text-ink-1 break-all underline-offset-4 decoration-hairline hover:underline"
              >
                tryargus.ca{JWKS_PATH}
              </a>
              <p className="mt-2 text-[12px] text-ink-2 leading-relaxed">
                ECDSA P-256 (SHA-256), held in AWS KMS. Every receipt names this key by its ID.
              </p>
            </div>
            <div className="border border-hairline bg-card p-4">
              <div className="label">Zero client PII</div>
              <p className="mt-2 text-[12px] text-ink-2 leading-relaxed">
                Client identity is an opaque reference the consultant chooses. Names, emails, phone numbers
                never touch Argus.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function FooterCta() {
  return (
    <section className="border-t border-hairline">
      <div className="mx-auto max-w-[1080px] px-6 py-16 text-center">
        <h2
          className="text-[28px] font-display text-ink-1"
        >
          Ready when IRCC changes something.
        </h2>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Link
            href="/signup"
            className="inline-flex h-10 items-center rounded-sm border border-brand-ink bg-brand px-4 text-[13px] font-medium text-on-brand transition-colors hover:bg-brand-hover"
          >
            Create your account
          </Link>
          <Link
            href="/login"
            className="inline-flex h-10 items-center rounded-sm border border-control bg-surface px-4 text-[13px] font-medium text-ink-1 transition-colors hover:bg-sunk"
          >
            Sign in
          </Link>
        </div>
      </div>
    </section>
  );
}

