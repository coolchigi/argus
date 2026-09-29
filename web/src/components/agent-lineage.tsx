"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { DURATIONS, prefersReducedMotion } from "@/lib/motion";
import {
  buildChain,
  describeOutcomes,
  formatDuration,
  hasTelemetry,
  isCrossFamily,
  isLive,
  LIVE_WINDOW_MS,
  runStartedAt,
  type ChainLink,
} from "@/lib/lineage";
import type { Lineage, LineageAgentName } from "@/lib/types/lineage";

/**
 * The agent chain behind an assessment or a pipeline run, as a chip row.
 * Section 8c of the design brief, with the live reveal from PERFORMATIVE.md
 * Section 3b.
 *
 * Models and durations come from the lineage API, which reads the steps each
 * agent recorded. Records signed before step telemetry have none, so they
 * show the chain without models or timings.
 *
 * While a run is live (started in the last 10 minutes) the page polls, and a
 * step that lands while you're watching fades in with its duration counting
 * up. Steps already done when the page opened render in their final state.
 * The animation is the pipeline, at its real pace.
 */
export function AgentLineage({
  policyEventId,
  lineage,
  live,
  scope = "assessment",
}: {
  policyEventId: string;
  lineage: Lineage | undefined;
  live: boolean;
  scope?: "assessment" | "run";
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const chain = buildChain(policyEventId, lineage);
  const recorded = hasTelemetry(lineage);
  const crossFamily = isCrossFamily(chain);
  const done = chain.filter((c) => c.step !== null).length;

  // The steps already recorded on the first response. Those never animate.
  const [baseline, setBaseline] = useState<Set<LineageAgentName> | null>(null);
  useEffect(() => {
    if (baseline === null && lineage) setBaseline(new Set(lineage.agents.map((a) => a.agent)));
  }, [baseline, lineage]);

  // Nothing dims until the first response is in, so a step that was already
  // done never fades in on page load.
  const pendingLook = lineage !== undefined && (live || recorded);

  return (
    <div className="rounded-md border border-border bg-surface">
      <div className="flex flex-wrap items-start gap-y-2 px-4 py-3">
        {chain.map((link, i) => {
          const landed = link.step !== null;
          const animate = live && baseline !== null && !baseline.has(link.agent);
          return (
            <div key={link.agent} className="flex items-start">
              <Chip link={link} dim={pendingLook && !landed} animate={animate} showTime={pendingLook} />
              {i < chain.length - 1 && (
                <span
                  aria-hidden
                  className={cn(
                    "mx-2 pt-[1px] text-[12px] text-ink-3 transition-opacity duration-[220ms] delay-[80ms] motion-reduce:duration-[120ms] motion-reduce:delay-0",
                    pendingLook && !landed ? "opacity-35" : "opacity-100",
                  )}
                >
                  ▸
                </span>
              )}
            </div>
          );
        })}
        {crossFamily === true && (
          <span className="ml-3 inline-flex items-center gap-1 self-start rounded-sm bg-sunk px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-wider text-ink-2">
            Cross-family
          </span>
        )}
      </div>

      <p className="border-t border-border px-4 py-2 text-[11px] text-ink-2">
        {live ? (
          <span>
            Live. {done} of {chain.length} steps done{scope === "run" ? " for at least one client" : ""}.
          </span>
        ) : recorded ? (
          scope === "run" ? (
            <span>Times are the median across your clients in this run.</span>
          ) : (
            <span>Times are how long each agent took on this assessment.</span>
          )
        ) : (
          <span>Signed before Argus recorded each step, so models and timings aren&apos;t available for this one.</span>
        )}
      </p>
      <span className="sr-only" aria-live="polite">
        {live ? `${done} of ${chain.length} pipeline steps done` : ""}
      </span>

      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between border-t border-border px-4 py-2 text-[11px] text-ink-secondary transition-colors hover:text-ink-primary focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus"
      >
        <span>How this was reviewed</span>
        {open ? (
          <ChevronDown aria-hidden className="h-3 w-3" strokeWidth={1.75} />
        ) : (
          <ChevronRight aria-hidden className="h-3 w-3" strokeWidth={1.75} />
        )}
      </button>
      {open && (
        <ul id={panelId} className="space-y-2.5 border-t border-border px-4 py-3">
          {chain.map((link) => (
            <li key={link.agent} className="grid grid-cols-[88px_1fr_auto] items-baseline gap-x-3 gap-y-0.5">
              <span className="text-[12px] font-medium text-ink-primary">{link.name}</span>
              <span className="text-[12px] text-ink-secondary">{link.role}</span>
              <span className="font-mono text-[11px] text-ink-2 tabular">{formatDuration(link.step?.durationMs ?? null)}</span>
              <span />
              <span className="fingerprint col-span-2 text-[11px] break-all">{modelLabel(link, recorded)}</span>
              {scope === "run" && link.step && link.agent !== "sentinel" && link.agent !== "recall" && (
                <>
                  <span />
                  <span className="col-span-2 text-[11px] text-ink-2">
                    {link.step.count} {link.step.count === 1 ? "client" : "clients"} · {describeOutcomes(link.step.outcomes)}
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Whether the run is live now. Re-checked on every lineage response, and once
 * more when the 10-minute window closes, so the page settles on its own.
 */
export function useLiveRun(policyEventId: string | null, lineage: Lineage | undefined): boolean {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => setNow(Date.now()), [lineage]);
  const started = policyEventId ? runStartedAt(policyEventId, lineage) : null;
  const live = policyEventId !== null && isLive(policyEventId, lineage, now);
  useEffect(() => {
    if (!live || started === null) return;
    const t = setTimeout(() => setNow(Date.now()), Math.max(0, started + LIVE_WINDOW_MS - Date.now()) + 50);
    return () => clearTimeout(t);
  }, [live, started]);
  return live;
}

function modelLabel(link: ChainLink, recorded: boolean): string {
  if (link.step?.modelId) return link.step.modelId;
  // Anchor runs no model. It signs with the Argus KMS key.
  if (link.step && link.agent === "anchor") return "AWS KMS, ECDSA P-256";
  if (!recorded) return "Model not recorded";
  return link.step ? "Model not recorded" : "No step recorded yet";
}

function Chip({ link, dim, animate, showTime }: { link: ChainLink; dim: boolean; animate: boolean; showTime: boolean }) {
  const duration = useCountUp(link.step?.durationMs ?? null, animate);
  return (
    <span
      className={cn(
        "flex min-w-[56px] flex-col transition-[opacity,color] duration-[220ms] ease-[cubic-bezier(0.2,0.9,0.3,1)] motion-reduce:duration-[120ms]",
        dim ? "opacity-35" : "opacity-100",
      )}
    >
      <span className={cn("text-[12px] font-medium", dim ? "text-ink-3" : "text-ink-primary")}>{link.name}</span>
      {showTime && <span className="h-4 font-mono text-[11px] leading-4 text-ink-2 tabular">{formatDuration(duration)}</span>}
    </span>
  );
}

/**
 * Counts from 0.0s up to the real duration over 320ms, ease-out, only when a
 * step first lands. A later change (a run's median moving as more clients
 * finish) just updates the number. Off for reduced motion.
 */
function useCountUp(target: number | null, run: boolean): number | null {
  const [value, setValue] = useState<number | null>(target);
  const previous = useRef<number | null>(target);
  useEffect(() => {
    const from = previous.current;
    previous.current = target;
    if (target === null || from !== null || !run || prefersReducedMotion()) {
      setValue(target);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / DURATIONS.medium);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(target * eased));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, run]);
  return value;
}
