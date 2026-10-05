"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useState, useSyncExternalStore } from "react";
import { X } from "lucide-react";
import { useAuth } from "@/components/auth-context";
import { isPlaced, samePath, TOUR_STEPS, tourEvent, tourPaths } from "@/lib/demo-tour";
import { getServerTourState, getTourState, setTourState, subscribeTour } from "@/lib/demo-tour-store";
import { prefersReducedMotion } from "@/lib/motion";
import { POLICY_EVENTS_MAX_LIMIT, usePolicyEventImpacts, usePolicyEvents } from "@/lib/queries";

// How long a step waits for its element to render before showing the card
// without a highlight.
const FIND_TIMEOUT_MS = 8000;
const MEASURE_EVERY_MS = 200;
// Scrolls to the element once it stops moving, or after this long regardless.
const SETTLE_TIMEOUT_MS = 3000;
// After a scroll, checks this often that the element stayed in view (a late
// layout shift or the router can move the page), and scrolls back at most
// MAX_RESCROLLS times.
const RECHECK_AFTER_MS = 1000;
const MAX_RESCROLLS = 2;

// Below Tailwind's sm breakpoint the card spans the bottom of the screen.
const PHONE_MAX_WIDTH = 640;
// An element taller than this share of the screen is aligned to the top.
const TALL_SHARE = 0.6;
// Clears the sticky top bar, with room for the highlight.
const TOP_OFFSET = 72;

type Box = { top: number; left: number; width: number; height: number };

/** The demo's guided tour. Renders nothing outside the read-only demo. */
export function DemoTour() {
  const auth = useAuth();
  if (auth.status !== "authed" || !auth.guest) return null;
  return <Tour />;
}

function Tour() {
  const router = useRouter();
  const pathname = usePathname();
  const tour = useSyncExternalStore(subscribeTour, getTourState, getServerTourState);
  const titleId = useId();

  // Same params as the dashboard and sidebar, so this reads their cached response.
  const events = usePolicyEvents({ limit: POLICY_EVENTS_MAX_LIMIT }, { enabled: tour.open });
  const event = tourEvent(events.data?.events);
  const impacts = usePolicyEventImpacts(event?.eventId ?? "", { enabled: tour.open && event !== null });
  const paths = tourPaths(events.data?.events, impacts.data?.clients);

  const index = Math.min(tour.step, TOUR_STEPS.length - 1);
  const step = TOUR_STEPS[index];
  const path = paths[step.target];
  const onPage = samePath(pathname, path);
  const box = useTarget(tour.open && onPage ? step.target : null, index);

  const close = useCallback(() => setTourState({ open: false, step: index }), [index]);

  useEffect(() => {
    if (!tour.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tour.open, close]);

  if (!tour.open) return null;

  const last = index === TOUR_STEPS.length - 1;
  const goTo = (next: number) => {
    setTourState({ open: true, step: next });
    const nextPath = paths[TOUR_STEPS[next].target];
    if (!samePath(pathname, nextPath)) router.push(nextPath);
  };

  return (
    <>
      {/* Room below the page, so its last element can scroll clear of the card. */}
      <div aria-hidden data-print="hide" className="h-[280px] shrink-0 bg-canvas" />
      {box && (
        <div
          aria-hidden
          data-print="hide"
          className="pointer-events-none fixed z-40 rounded-md border-2 border-brand"
          style={{ top: box.top - 6, left: box.left - 6, width: box.width + 12, height: box.height + 12 }}
        />
      )}
      <div
        role="dialog"
        aria-labelledby={titleId}
        data-print="hide"
        className="fixed bottom-4 left-4 right-4 z-50 border border-hairline bg-card px-5 py-4 shadow-lg sm:left-auto sm:w-[360px]"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="label">
            Demo tour · Step {index + 1} of {TOUR_STEPS.length}
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close the tour"
            className="-mr-1 -mt-1 inline-flex h-7 w-7 items-center justify-center rounded-sm text-ink-2 hover:bg-sunk hover:text-ink-1"
          >
            <X aria-hidden className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </div>
        <h2 id={titleId} aria-live="polite" className="mt-2 font-display text-[18px] leading-tight text-ink-1">
          {step.title}
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{step.body}</p>
        <div className="mt-4 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => goTo(index - 1)}
            disabled={index === 0}
            className="inline-flex h-8 items-center rounded-sm px-2 text-[13px] text-ink-2 hover:bg-sunk hover:text-ink-1 disabled:invisible"
          >
            Back
          </button>
          {!onPage ? (
            <button
              type="button"
              onClick={() => router.push(path)}
              className="inline-flex h-8 items-center rounded-sm border border-brand-ink bg-brand px-3 text-[13px] font-medium text-on-brand hover:bg-brand-hover"
            >
              Show me
            </button>
          ) : last ? (
            <button
              type="button"
              onClick={() => setTourState({ open: false, step: 0 })}
              className="inline-flex h-8 items-center rounded-sm border border-brand-ink bg-brand px-3 text-[13px] font-medium text-on-brand hover:bg-brand-hover"
            >
              Finish the tour
            </button>
          ) : (
            <button
              type="button"
              onClick={() => goTo(index + 1)}
              className="inline-flex h-8 items-center rounded-sm border border-brand-ink bg-brand px-3 text-[13px] font-medium text-on-brand hover:bg-brand-hover"
            >
              Next
            </button>
          )}
        </div>
      </div>
    </>
  );
}

/**
 * The on-screen box of the step's [data-tour] element. Waits for the page to
 * render it, scrolls it into view once per step (and back, if the page moves
 * it before the visitor scrolls), then follows it through
 * scrolling, resizing and late layout shifts.
 */
function useTarget(target: string | null, stepIndex: number): Box | null {
  const [box, setBox] = useState<Box | null>(null);

  useEffect(() => {
    setBox(null);
    if (!target) return;
    const started = Date.now();
    let scrolled = false;
    let scrolledAt = 0;
    let rescrolls = 0;
    // Once the visitor scrolls on their own, the tour stops moving the page.
    let visitorScrolled = false;
    const onVisitorScroll = () => {
      if (scrolled) visitorScrolled = true;
    };
    // Where the element sat on the page at the last measure. The page is
    // still loading data above it until this holds still.
    let lastSpot: string | null = null;

    const measure = () => {
      const el = document.querySelector<HTMLElement>(`[data-tour="${target}"]`);
      if (!el) {
        setBox(null);
        return Date.now() - started < FIND_TIMEOUT_MS;
      }
      const spot = el.getBoundingClientRect();
      const here = `${Math.round(spot.top + window.scrollY)}:${Math.round(spot.height)}`;
      const settled = here === lastSpot || Date.now() - started > SETTLE_TIMEOUT_MS;
      lastSpot = here;
      if (!scrolled && settled) {
        scrolled = true;
        scrolledAt = Date.now();
        scrollToElement(el, false);
      } else if (
        scrolled &&
        !visitorScrolled &&
        rescrolls < MAX_RESCROLLS &&
        Date.now() - scrolledAt > RECHECK_AFTER_MS &&
        !isPlaced(el.getBoundingClientRect().top, window.innerHeight)
      ) {
        rescrolls += 1;
        scrolledAt = Date.now();
        scrollToElement(el, true);
      }
      const r = el.getBoundingClientRect();
      setBox((prev) =>
        prev && prev.top === r.top && prev.left === r.left && prev.width === r.width && prev.height === r.height
          ? prev
          : { top: r.top, left: r.left, width: r.width, height: r.height },
      );
      return true;
    };

    const timer = window.setInterval(() => {
      if (!measure()) window.clearInterval(timer);
    }, MEASURE_EVERY_MS);
    const onMove = () => void measure();
    window.addEventListener("scroll", onMove, { passive: true, capture: true });
    window.addEventListener("resize", onMove);
    const visitorInputs = ["wheel", "touchmove", "keydown"] as const;
    for (const type of visitorInputs) window.addEventListener(type, onVisitorScroll, { passive: true });
    measure();
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("scroll", onMove, { capture: true });
      window.removeEventListener("resize", onMove);
      for (const type of visitorInputs) window.removeEventListener(type, onVisitorScroll);
    };
  }, [target, stepIndex]);

  return box;
}

/**
 * Brings the element into view: centered, or near the top on a phone (the
 * card covers the bottom) and for a tall element (centering loses its top).
 * A re-scroll jumps, so it can't race the page again.
 */
function scrollToElement(el: HTMLElement, jump: boolean): void {
  // A smooth scroll needs painted frames, so a page that isn't on screen (a
  // background tab, an automated browser) jumps instead.
  const smooth = !jump && !prefersReducedMotion() && document.visibilityState === "visible";
  const behavior = smooth ? "smooth" : "auto";
  const rect = el.getBoundingClientRect();
  if (window.innerWidth < PHONE_MAX_WIDTH || rect.height > window.innerHeight * TALL_SHARE) {
    window.scrollTo({ top: window.scrollY + rect.top - TOP_OFFSET, behavior });
  } else {
    el.scrollIntoView({ block: "center", behavior });
  }
}
