"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth-context";
import { Seal } from "@/components/seal";
import { cn } from "@/lib/utils";
import { ArrowUpRight } from "lucide-react";

const AGENTS = [
  { name: "Sentinel", role: "Watches IRCC hourly", model: "Nova Micro" },
  { name: "Analyst", role: "Reasons per client", model: "Nova Pro" },
  { name: "Auditor", role: "Adversarial review", model: "Claude Haiku 4.5" },
  { name: "Anchor", role: "Signs and archives", model: "AWS KMS · P-256" },
  { name: "Composer", role: "Drafts the client email", model: "Nova Lite" },
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
    <div className="min-h-screen bg-canvas text-ink-primary">
      <TopBar />
      <main>
        <Hero />
        <PipelineSection />
        <TrustSection />
        <FooterCta />
      </main>
      <Footer />
    </div>
  );
}

function TopBar() {
  return (
    <header className="border-b border-border">
      <div className="mx-auto max-w-[1080px] px-6 h-14 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <Seal className="h-4 w-4 text-seal" />
          <span className="text-[14px] font-medium tracking-tight">argus</span>
        </Link>
        <nav className="flex items-center gap-6 text-[13px]">
          <Link href="/login" className="text-ink-secondary hover:text-ink-primary transition-colors">
            Sign in
          </Link>
          <Link
            href="/signup"
            className="inline-flex h-8 items-center rounded-sm bg-primary px-3 text-[13px] font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Create account
          </Link>
        </nav>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="mx-auto max-w-[1080px] px-6 pt-24 pb-20">
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-12 items-start">
        <div>
          <div className="label">Argus · policy-impact platform</div>
          <h1
            className="mt-3 text-[52px] leading-[1.05] font-medium tracking-tight text-ink-primary"
            style={{ fontFamily: "var(--font-newsreader), serif" }}
          >
            Every impact assessment,
            <br />
            signed and archived.
          </h1>
          <p className="mt-6 max-w-[480px] text-[16px] leading-relaxed text-ink-secondary">
            Argus watches IRCC for you. When something changes, six AI agents review the impact on your
            caseload and sign the finding. You get a draft brief per client and a receipt an auditor can verify.
          </p>
          <div className="mt-8 flex items-center gap-3">
            <Link
              href="/signup"
              className="inline-flex h-10 items-center rounded-sm bg-primary px-4 text-[13px] font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              Start with your R-license
            </Link>
            <Link
              href="/login"
              className="inline-flex h-10 items-center rounded-sm border border-border bg-surface px-4 text-[13px] font-medium text-ink-primary hover:bg-surface-alt transition-colors"
            >
              Sign in
            </Link>
          </div>
        </div>

        <div className="lg:pt-8">
          <SampleReceipt />
        </div>
      </div>
    </section>
  );
}

function SampleReceipt() {
  const SAMPLE_HASH = "1cbb498541676b14a34b357c325a05c54b6c01bc3ce899c2a00acf9944f86191";
  return (
    <div className="rounded-lg border border-border bg-surface p-6 space-y-5">
      <div className="flex items-center gap-2">
        <Seal className="h-3.5 w-3.5 text-seal" />
        <span className="label text-seal">Live sample receipt</span>
      </div>
      <div className="space-y-3">
        <div>
          <div className="label">Topic</div>
          <div className="mt-1 text-[13px] text-ink-primary">
            CRS scorecard rule change
          </div>
        </div>
        <div>
          <div className="label">Fingerprint</div>
          <div className="mt-1 fingerprint-lg text-ink-primary">
            {SAMPLE_HASH.slice(0, 4)} {SAMPLE_HASH.slice(4, 8)} {SAMPLE_HASH.slice(8, 12)} {SAMPLE_HASH.slice(12, 16)}
          </div>
        </div>
        <div>
          <div className="label">Algorithm</div>
          <div className="mt-1 text-[13px] text-ink-primary">ECDSA P-256 · SHA-256</div>
        </div>
        <div>
          <div className="label">Signed by</div>
          <div className="mt-1 text-[13px] text-ink-primary">AWS KMS key <span className="fingerprint text-ink-secondary">8b3b43ef…</span></div>
        </div>
      </div>
      <div className="border-t border-border pt-4">
        <Link
          href={`/verify/${SAMPLE_HASH}`}
          className="inline-flex items-center gap-1.5 text-[12px] font-medium text-ink-primary hover:underline underline-offset-4 decoration-border"
        >
          Open and verify in your browser
          <ArrowUpRight className="h-3 w-3 text-ink-tertiary" strokeWidth={1.75} />
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
    <section className="border-t border-border">
      <div className="mx-auto max-w-[1080px] px-6 py-20">
        <div className="max-w-[640px] mb-10">
          <div className="label">How it works</div>
          <h2
            className="mt-2 text-[28px] font-medium tracking-tight text-ink-primary"
            style={{ fontFamily: "var(--font-newsreader), serif" }}
          >
            Five agents review every change.
          </h2>
          <p className="mt-3 text-[14px] leading-relaxed text-ink-secondary">
            Nova Pro reasons, Claude audits from a different model family, KMS signs. No single model is
            trusted alone. Every claim on your assessment carries a receipt you can verify.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          {AGENTS.map((agent, i) => (
            <div
              key={agent.name}
              className={cn(
                "rounded-md border border-border bg-surface p-4 transition-all duration-[220ms] ease-[cubic-bezier(0.2,0.9,0.3,1)]",
                visible[i] ? "opacity-100 translate-y-0" : "opacity-0 translate-y-1",
              )}
            >
              <div className="flex items-baseline justify-between">
                <div className="text-[13px] font-medium text-ink-primary">{agent.name}</div>
                <div className="text-[10px] text-ink-tertiary tabular">{i + 1}</div>
              </div>
              <div className="mt-2 text-[12px] text-ink-secondary leading-relaxed">{agent.role}</div>
              <div className="mt-3 fingerprint text-ink-tertiary text-[11px]">{agent.model}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function TrustSection() {
  return (
    <section className="border-t border-border bg-surface-alt/30">
      <div className="mx-auto max-w-[1080px] px-6 py-20">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-12">
          <div>
            <div className="label">The audit trail</div>
            <h2
              className="mt-2 text-[28px] font-medium tracking-tight text-ink-primary"
              style={{ fontFamily: "var(--font-newsreader), serif" }}
            >
              A receipt a CICC auditor can verify years from now.
            </h2>
            <p className="mt-3 text-[14px] leading-relaxed text-ink-secondary">
              Every assessment is signed with an ECDSA P-256 key managed by AWS KMS. The public key is
              published as JWKS. Anyone with the fingerprint can verify the signature in their browser,
              offline, without contacting Argus.
            </p>
            <p className="mt-3 text-[14px] leading-relaxed text-ink-secondary">
              CICC Client File Management Regulation s. 7.2 requires 6-year retention on file records.
              Argus retains signed assessments indefinitely by default. Export on demand.
            </p>
          </div>

          <div className="space-y-4">
            <div className="rounded-md border border-border bg-surface p-4">
              <div className="label">Public JWKS</div>
              <div className="mt-2 fingerprint text-ink-primary break-all">
                argus.ca/.well-known/jwks.json
              </div>
            </div>
            <div className="rounded-md border border-border bg-surface p-4">
              <div className="label">Signing algorithm</div>
              <div className="mt-2 text-[13px] text-ink-primary">ECDSA P-256 · SHA-256</div>
            </div>
            <div className="rounded-md border border-border bg-surface p-4">
              <div className="label">Zero client PII</div>
              <p className="mt-2 text-[12px] text-ink-secondary leading-relaxed">
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
    <section className="border-t border-border">
      <div className="mx-auto max-w-[1080px] px-6 py-16 text-center">
        <h2
          className="text-[28px] font-medium tracking-tight text-ink-primary"
          style={{ fontFamily: "var(--font-newsreader), serif" }}
        >
          Ready when IRCC changes something.
        </h2>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Link
            href="/signup"
            className="inline-flex h-10 items-center rounded-sm bg-primary px-4 text-[13px] font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Create your account
          </Link>
          <Link
            href="/login"
            className="inline-flex h-10 items-center rounded-sm border border-border bg-surface px-4 text-[13px] font-medium text-ink-primary hover:bg-surface-alt transition-colors"
          >
            Sign in
          </Link>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto max-w-[1080px] px-6 py-6 flex items-center justify-between">
        <div className="flex items-center gap-2 text-[11px] text-ink-tertiary">
          <Seal className="h-3 w-3 text-ink-tertiary" filled={false} />
          <span>argus · signed and archived</span>
        </div>
        <div className="text-[11px] text-ink-tertiary tabular">
          Built for CICC-licensed consultants
        </div>
      </div>
    </footer>
  );
}
