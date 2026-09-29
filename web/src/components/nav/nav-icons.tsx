import { cn } from "@/lib/utils";

export type NavIconName =
  | "dashboard"
  | "policy"
  | "clients"
  | "assess"
  | "briefs"
  | "verify"
  | "settings"
  | "records"
  | "setup";

/** 14px line icons ported from the Figma sidebar (web/design/User engagement/src/App.tsx). */
export function NavIcon({ name, className }: { name: NavIconName; className?: string }) {
  const common = {
    width: 14,
    height: 14,
    viewBox: "0 0 14 14",
    fill: "none",
    "aria-hidden": true,
    className: cn("block shrink-0", className),
  } as const;
  switch (name) {
    case "dashboard":
      return (
        <svg {...common}>
          <rect x="1" y="1" width="5" height="5" stroke="currentColor" strokeWidth="1.2" />
          <rect x="8" y="1" width="5" height="5" stroke="currentColor" strokeWidth="1.2" />
          <rect x="1" y="8" width="5" height="5" stroke="currentColor" strokeWidth="1.2" />
          <rect x="8" y="8" width="5" height="5" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      );
    case "policy":
      return (
        <svg {...common}>
          <rect x="2" y="1" width="10" height="12" stroke="currentColor" strokeWidth="1.2" />
          <line x1="4" y1="4" x2="10" y2="4" stroke="currentColor" strokeWidth="1" />
          <line x1="4" y1="7" x2="10" y2="7" stroke="currentColor" strokeWidth="1" />
          <line x1="4" y1="10" x2="8" y2="10" stroke="currentColor" strokeWidth="1" />
        </svg>
      );
    case "clients":
      return (
        <svg {...common}>
          <circle cx="5" cy="4" r="2.5" stroke="currentColor" strokeWidth="1.2" />
          <circle cx="9.5" cy="5" r="2" stroke="currentColor" strokeWidth="1.2" />
          <path d="M1 12c0-2.2 1.8-4 4-4s4 1.8 4 4" stroke="currentColor" strokeWidth="1.2" />
          <path d="M9.5 9c1.7.3 3 1.9 3 3.7" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      );
    case "assess":
      return (
        <svg {...common}>
          <rect x="1" y="1" width="12" height="12" stroke="currentColor" strokeWidth="1.2" />
          <line x1="4" y1="7" x2="10" y2="7" stroke="currentColor" strokeWidth="1" />
          <polyline points="4,4 6,6 9,3" stroke="currentColor" strokeWidth="1.2" fill="none" />
        </svg>
      );
    case "briefs":
      return (
        <svg {...common}>
          <path d="M2 2h10v10l-3 2H2V2z" stroke="currentColor" strokeWidth="1.2" />
          <line x1="4" y1="5" x2="9" y2="5" stroke="currentColor" strokeWidth="1" />
          <line x1="4" y1="8" x2="7" y2="8" stroke="currentColor" strokeWidth="1" />
        </svg>
      );
    case "verify":
      return (
        <svg {...common}>
          <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.2" />
          <polyline points="5,7 6.5,8.5 9.5,5.5" stroke="currentColor" strokeWidth="1.2" fill="none" />
        </svg>
      );
    case "settings":
      return (
        <svg {...common}>
          <circle cx="7" cy="7" r="2" stroke="currentColor" strokeWidth="1.2" />
          <path
            d="M7 1v1.5M7 11.5V13M1 7h1.5M11.5 7H13M2.8 2.8l1 1M10.2 10.2l1 1M2.8 11.2l1-1M10.2 3.8l1-1"
            stroke="currentColor"
            strokeWidth="1.1"
          />
        </svg>
      );
    case "records":
      return (
        <svg {...common}>
          <rect x="1" y="2" width="12" height="3" stroke="currentColor" strokeWidth="1.2" />
          <path d="M2 5v7h10V5" stroke="currentColor" strokeWidth="1.2" />
          <line x1="5.5" y1="7.5" x2="8.5" y2="7.5" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      );
    case "setup":
      return (
        <svg {...common}>
          <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.2" />
          <line x1="7" y1="4.5" x2="7" y2="7" stroke="currentColor" strokeWidth="1.2" />
          <circle cx="7" cy="9.5" r="0.7" fill="currentColor" />
        </svg>
      );
  }
}
