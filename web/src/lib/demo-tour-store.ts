// Where the demo tour is: open or closed, and which step. Kept in
// sessionStorage like the guest flag, so a reload resumes the tour and a new
// tab starts fresh.

export type TourState = { open: boolean; step: number };

const STORAGE_KEY = "argus-tour";
const CLOSED: TourState = { open: false, step: 0 };
const listeners = new Set<() => void>();
let state: TourState | null = null;

function read(): TourState {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object") {
      const p = parsed as Partial<TourState>;
      if (typeof p.open === "boolean" && Number.isInteger(p.step) && (p.step as number) >= 0) return { open: p.open, step: p.step as number };
    }
  } catch {
    // Storage blocked or bad JSON: start closed.
  }
  return CLOSED;
}

export function getTourState(): TourState {
  if (state === null) state = typeof window === "undefined" ? CLOSED : read();
  return state;
}

export function getServerTourState(): TourState {
  return CLOSED;
}

export function setTourState(next: TourState): void {
  state = next;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage blocked. The tour still works until the page reloads.
  }
  for (const l of listeners) l();
}

export function subscribeTour(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function startTour(): void {
  setTourState({ open: true, step: 0 });
}
