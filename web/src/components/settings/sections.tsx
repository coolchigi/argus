"use client";

import Link from "next/link";
import { useId, type ReactNode } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { SectionLabel } from "@/components/argus/section-label";
import { Switch } from "@/components/argus/switch";
import { fieldClass } from "@/components/caseload/copy";
import { useTheme, type Theme } from "@/components/theme-provider";
import { POLICY_DOMAIN_LABELS, humanizeSignatureAlgorithm } from "@/lib/humanize";
import { DOMAIN_DESCRIPTIONS, PROVINCE_LABELS, type DraftErrors, type SettingsDraft } from "@/lib/settings-draft";
import { FIRM_MAX_LENGTH, MONITORED_DOMAINS, PROVINCES, type MeResponse, type Province } from "@/lib/types/me";
import { cn } from "@/lib/utils";

export function SettingsSection({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  const headingId = `${id}-heading`;
  return (
    <section id={id} aria-labelledby={headingId} className="scroll-mt-20 border-t border-hairline pt-6">
      <h2 id={headingId} className="font-display text-[20px] leading-tight text-ink-1">
        {title}
      </h2>
      {description && <div className="mt-1 max-w-prose text-[13px] leading-relaxed text-ink-2">{description}</div>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function ReadOnlyField({ label, value, mono = false }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="label mb-1">{label}</dt>
      <dd className={cn("truncate text-[13px] text-ink-1", mono && "font-mono", !value && "text-ink-3")} title={value ?? undefined}>
        {value ?? "Not set"}
      </dd>
    </div>
  );
}

export function ProfileSection({
  me,
  draft,
  errors,
  onChange,
}: {
  me: MeResponse;
  draft: SettingsDraft;
  errors: DraftErrors;
  onChange: (patch: Partial<SettingsDraft>) => void;
}) {
  const firmId = useId();
  const firmHelpId = useId();
  const provinceId = useId();
  const c = me.consultant;
  const name = [c.givenName, c.familyName].filter(Boolean).join(" ") || c.displayName;
  const firmLength = draft.firm.trim().length;
  return (
    <SettingsSection
      id="practice"
      title="Profile"
      description="Your name, email and licence come from sign-up. Firm and province are yours to set."
    >
      <div className="space-y-5 border border-hairline bg-card p-5">
        <dl className="grid gap-4 sm:grid-cols-3">
          <ReadOnlyField label="Name" value={name} />
          <ReadOnlyField label="Email" value={c.email} />
          <ReadOnlyField label="CICC licence" value={c.rcicLicense} mono />
        </dl>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <SectionLabel as="label" htmlFor={firmId} className="mb-1">
              Firm
            </SectionLabel>
            <input
              id={firmId}
              type="text"
              autoComplete="organization"
              value={draft.firm}
              onChange={(e) => onChange({ firm: e.target.value })}
              aria-invalid={errors.firm ? true : undefined}
              aria-describedby={firmHelpId}
              className={cn(fieldClass, errors.firm && "border-danger")}
              placeholder="Your practice's name"
            />
            <p id={firmHelpId} className={cn("mt-1 text-[12px]", errors.firm ? "text-danger-ink" : "text-ink-3")}>
              {errors.firm ?? `${firmLength} of ${FIRM_MAX_LENGTH} characters`}
            </p>
          </div>
          <div>
            <SectionLabel as="label" htmlFor={provinceId} className="mb-1">
              Province or territory
            </SectionLabel>
            <select
              id={provinceId}
              value={draft.province}
              onChange={(e) => onChange({ province: e.target.value as Province | "" })}
              aria-invalid={errors.province ? true : undefined}
              className={cn(fieldClass, "px-2")}
            >
              <option value="">Not set</option>
              {PROVINCES.map((p) => (
                <option key={p} value={p}>
                  {PROVINCE_LABELS[p]}
                </option>
              ))}
            </select>
            {errors.province && <p className="mt-1 text-[12px] text-danger-ink">{errors.province}</p>}
          </div>
        </div>
      </div>
    </SettingsSection>
  );
}

export function PolicyMonitorSection({ draft, onChange }: { draft: SettingsDraft; onChange: (patch: Partial<SettingsDraft>) => void }) {
  const on = MONITORED_DOMAINS.filter((d) => draft.policyDomains[d]).length;
  return (
    <SettingsSection
      id="policy-monitor"
      title="Policy monitor"
      description={
        <>
          <p>Choose the IRCC program areas Argus checks against your caseload. {on} of {MONITORED_DOMAINS.length} are on.</p>
          <p className="mt-1">Turning an area off stops new assessments for it. Records already signed stay on file.</p>
        </>
      }
    >
      <ul className="divide-y divide-hairline border border-hairline bg-card">
        {MONITORED_DOMAINS.map((d) => (
          <li key={d} className="px-5 py-3.5">
            <Switch
              checked={draft.policyDomains[d]}
              onCheckedChange={(checked) => onChange({ policyDomains: { ...draft.policyDomains, [d]: checked } })}
              label={POLICY_DOMAIN_LABELS[d]}
              description={DOMAIN_DESCRIPTIONS[d]}
              className="items-center"
            />
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[12px] text-ink-3">
        Changes IRCC files under general or other still reach clients in the areas you keep on.
      </p>
    </SettingsSection>
  );
}

export function NotificationsSection({
  me,
  draft,
  onChange,
}: {
  me: MeResponse;
  draft: SettingsDraft;
  onChange: (patch: Partial<SettingsDraft>) => void;
}) {
  return (
    <SettingsSection id="notifications" title="Notifications">
      <div className="border border-hairline bg-card px-5 py-3.5">
        <Switch
          checked={draft.realtimeAlerts}
          onCheckedChange={(checked) => onChange({ realtimeAlerts: checked })}
          label="Real-time email"
          description={`Email ${me.consultant.email ?? "you"} when Argus drafts a brief for a high-severity change. Briefs wait in Argus either way.`}
          className="items-center"
        />
      </div>
    </SettingsSection>
  );
}

export function PublicReceiptsSection({
  me,
  draft,
  onChange,
}: {
  me: MeResponse;
  draft: SettingsDraft;
  onChange: (patch: Partial<SettingsDraft>) => void;
}) {
  const name = me.consultant.displayName ?? "your name";
  const license = me.consultant.rcicLicense ?? me.consultant.rcicId;
  return (
    <SettingsSection
      id="public-receipts"
      title="Public receipts"
      description="Anyone with a receipt link can check the signature. Clients never appear on a receipt."
    >
      <div className="border border-hairline bg-card px-5 py-3.5">
        <Switch
          checked={draft.showIdentityOnPublicReceipts}
          onCheckedChange={(checked) => onChange({ showIdentityOnPublicReceipts: checked })}
          label="Show my name on receipts"
          description={`Receipts read "Signed for ${name}, RCIC ${license}". Off until you turn it on.`}
          className="items-center"
        />
      </div>
    </SettingsSection>
  );
}

function groupFingerprint(hex: string): string {
  return (hex.toLowerCase().match(/.{1,4}/g) ?? []).join(" ");
}

export function SigningKeySection({ me }: { me: MeResponse }) {
  const s = me.signing;
  return (
    <SettingsSection
      id="signing-key"
      title="Signing key"
      description="Argus signs every assessment with this key in AWS KMS. You can't change it, and the private half never leaves KMS."
    >
      {s ? (
        <div className="space-y-4 border border-hairline bg-card p-5">
          <dl className="grid gap-4 sm:grid-cols-3">
            <ReadOnlyField label="Key ID" value={s.keyId} mono />
            <ReadOnlyField label="Algorithm" value={humanizeSignatureAlgorithm(s.algorithm)} />
            <ReadOnlyField label="Created" value={s.createdAt ? formatDate(s.createdAt) : null} />
          </dl>
          <div>
            <div className="label mb-1">Fingerprint (SHA-256 of the public key)</div>
            <p className="break-all font-mono text-[12px] leading-relaxed text-ink-1" title={s.spkiSha256}>
              {groupFingerprint(s.spkiSha256)}
            </p>
          </div>
          <p className="text-[12px] text-ink-2">
            Receipts name this key by its ID. Your browser checks the key against this fingerprint before it trusts a
            signature.{" "}
            <Link href="/verify" className="text-brand-ink underline underline-offset-4 hover:text-ink-1">
              Check a receipt
            </Link>
          </p>
        </div>
      ) : (
        <p className="border border-hairline bg-card px-5 py-4 text-[13px] text-ink-2">
          Couldn&rsquo;t read the key details right now. Signing isn&rsquo;t affected. Reload to try again.
        </p>
      )}
    </SettingsSection>
  );
}

const THEME_OPTIONS: Array<{ value: Theme; label: string; icon: typeof Sun }> = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

export function AppearanceSection() {
  const { theme, setTheme } = useTheme();
  const name = useId();
  return (
    <SettingsSection id="appearance" title="Appearance" description="Applies right away and stays on this device.">
      <fieldset>
        <legend className="sr-only">Theme</legend>
        <div className="inline-grid grid-cols-3 gap-1 rounded-sm border border-control p-1">
          {THEME_OPTIONS.map((o) => {
            const Icon = o.icon;
            const active = theme === o.value;
            return (
              <label
                key={o.value}
                className={cn(
                  "flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-[2px] px-3 text-[13px] transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus",
                  active ? "bg-brand-subtle text-ink-1" : "text-ink-2 hover:bg-sunk hover:text-ink-1",
                )}
              >
                <input
                  type="radio"
                  name={name}
                  value={o.value}
                  checked={active}
                  onChange={() => setTheme(o.value)}
                  className="sr-only"
                />
                <Icon aria-hidden className="h-3.5 w-3.5" strokeWidth={1.75} />
                {o.label}
              </label>
            );
          })}
        </div>
      </fieldset>
    </SettingsSection>
  );
}

export function DataRetentionSection() {
  return (
    <SettingsSection id="data-retention" title="Data and retention">
      <div className="space-y-2 border border-hairline bg-card p-5 text-[13px] leading-relaxed text-ink-2">
        <p>
          CICC Client File Management Regulation s. 7.2 has you keep client records for 6 years after a file closes. Argus
          assessments and sent briefs count as client records, so Argus keeps them at least that long and never deletes
          them on its own.
        </p>
        <p>
          Closing a client in your caseload stops new assessments for them and starts that clock. For each client, Argus
          holds the case number you gave it and the program details in your import.
        </p>
      </div>
    </SettingsSection>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
