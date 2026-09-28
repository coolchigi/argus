"use client";

import Link from "next/link";
import { use } from "react";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { InlineError } from "@/components/argus/inline-error";
import { NumberedSection } from "@/components/argus/numbered-section";
import { PageHeader } from "@/components/argus/page-header";
import { ProgressLine } from "@/components/argus/progress-line";
import { Badge, StatusBadge } from "@/components/argus/status-badge";
import { AssessmentList, BriefList } from "@/components/caseload/client-history";
import { buttonSecondary } from "@/components/caseload/copy";
import { formatDayMonthYear } from "@/components/dashboard/derive";
import { EmptyState } from "@/components/empty-state";
import { useBreadcrumbLabel } from "@/components/nav/breadcrumb-context";
import { ApiError } from "@/lib/api";
import { humanizePolicyDomain, humanizeTopic } from "@/lib/humanize";
import { usePatchProfile, useProfile } from "@/lib/queries";
import type { ClientProfile } from "@/lib/types/profiles";

type Field = { key: keyof ClientProfile; label: string; format?: (v: unknown) => string };

const yesNo = (v: unknown) => (v === true ? "Yes" : v === false ? "No" : String(v));
const slug = (v: unknown) => humanizeTopic(String(v));

/** Display order. Only fields on the profile are shown. notes and age never reach the browser. */
const FIELDS: Field[] = [
  { key: "currentCrsScore", label: "CRS score" },
  { key: "nocCode", label: "NOC" },
  { key: "teerLevel", label: "TEER" },
  { key: "educationLevel", label: "Education", format: slug },
  { key: "clbEnglishWorst", label: "CLB English, lowest" },
  { key: "clbFrenchWorst", label: "CLB French, lowest" },
  { key: "canadianWorkYears", label: "Canadian work, years" },
  { key: "foreignWorkYears", label: "Foreign work, years" },
  { key: "hasJobOffer", label: "Job offer", format: yesNo },
  { key: "jobOfferTeer", label: "Job offer TEER" },
  { key: "principalPermitTeer", label: "Principal permit TEER" },
  { key: "principalPermitRemainingMonths", label: "Principal permit, months left" },
  { key: "cipCode", label: "CIP code" },
  { key: "graduationDate", label: "Graduation", format: (v) => formatDayMonthYear(`${String(v)}T12:00:00Z`) },
  { key: "pgpSponsor2020Form", label: "2020 PGP interest form", format: yesNo },
  { key: "pgpLicoYearsMet", label: "LICO years met" },
  { key: "pnpProvince", label: "PNP province" },
  { key: "intendedStudyLevel", label: "Intended study level", format: slug },
  { key: "palOnFile", label: "PAL on file", format: yesNo },
];

export default function ClientDetailPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId: raw } = use(params);
  const clientId = decodeURIComponent(raw);
  const detail = useProfile(clientId);
  const patch = usePatchProfile(clientId);
  useBreadcrumbLabel(clientId);

  const back = (
    <Link href="/caseload" className="inline-flex items-center gap-1 text-[12px] text-ink-2 hover:text-ink-1">
      <ArrowLeft aria-hidden className="h-3 w-3" strokeWidth={1.75} />
      Back to caseload
    </Link>
  );

  if (detail.error instanceof ApiError && detail.error.status === 404) {
    return (
      <div className="space-y-6">
        {back}
        <EmptyState headline="Client not found." body={`There's no client ${clientId} in your caseload.`} />
      </div>
    );
  }

  const data = detail.data;
  const client = data?.client;
  const closed = client?.status === "closed";
  const toSend = data?.assessments.filter((a) => a.needsBrief).length ?? 0;

  async function setStatus(next: "active" | "closed") {
    try {
      await patch.mutateAsync({ status: next });
      toast.success(next === "closed" ? `${clientId} closed. Its records stay on file.` : `${clientId} reopened`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update the client");
    }
  }

  return (
    <div className="space-y-8">
      <ProgressLine active={detail.isFetching} fixed label="Loading client" />
      {back}

      <PageHeader
        crumbs={[{ label: "Caseload", href: "/caseload" }, { label: clientId }]}
        title={<span className="font-mono text-[24px]">{clientId}</span>}
        meta={
          client
            ? [
                humanizePolicyDomain(client.program),
                client.createdAt ? `Added ${formatDayMonthYear(client.createdAt)}` : null,
                client.closedAt ? `Closed ${formatDayMonthYear(client.closedAt)}` : null,
              ]
                .filter(Boolean)
                .join(" · ")
            : "Loading"
        }
        actions={
          client && (
            <button type="button" className={buttonSecondary} disabled={patch.isPending} onClick={() => void setStatus(closed ? "active" : "closed")}>
              {closed ? "Reopen file" : "Close file"}
            </button>
          )
        }
      />

      {detail.error ? (
        <InlineError
          message="Couldn't load this client."
          detail={detail.error instanceof Error ? detail.error.message : null}
          retrying={detail.isFetching}
          onRetry={() => void detail.refetch()}
        />
      ) : !data || !client ? (
        <div aria-busy className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <span key={i} aria-hidden className="block h-3 w-2/3 rounded-sm bg-hairline" />
          ))}
        </div>
      ) : (
        <>
          <NumberedSection number={1} title="Profile">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              {client.status === "submitted" ? (
                <Badge tone="neutral">Submitted</Badge>
              ) : (
                <StatusBadge kind="client" status={closed ? "closed" : "active"} />
              )}
              {toSend > 0 && (
                <Badge tone="danger" dot>
                  {toSend} {toSend === 1 ? "brief" : "briefs"} to send
                </Badge>
              )}
            </div>
            <dl className="grid grid-cols-1 gap-px border border-hairline bg-hairline sm:grid-cols-2 lg:grid-cols-3">
              <Item label="Program" value={humanizePolicyDomain(client.program)} />
              {FIELDS.filter((f) => client[f.key] !== undefined && client[f.key] !== null).map((f) => (
                <Item key={f.key} label={f.label} value={f.format ? f.format(client[f.key]) : String(client[f.key])} mono={!f.format} />
              ))}
            </dl>
            <p className="mt-3 text-[12px] text-ink-3">
              Argus holds scoring details only, never names or contact details. Age is used for scoring and isn&apos;t shown here.
            </p>
          </NumberedSection>

          <NumberedSection number={2} title="Assessments">
            <AssessmentList assessments={data.assessments} />
          </NumberedSection>

          <NumberedSection number={3} title="Briefs">
            <BriefList briefs={data.briefs} />
          </NumberedSection>
        </>
      )}
    </div>
  );
}

function Item({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="bg-card px-4 py-3">
      <dt className="label">{label}</dt>
      <dd className={`mt-1 text-[14px] text-ink-1 ${mono ? "font-mono tabular" : ""}`}>{value}</dd>
    </div>
  );
}
