import type { ReactNode } from "react";
import { ThemeContextProvider, useTheme, type Theme } from "@/components/theme-context";

/**
 * The theme a first-time visitor gets. Flip this one line when the audience
 * research lands. "system" follows the OS setting.
 *
 * This file has no "use client" directive on purpose, so the root layout
 * (a server component) can read DEFAULT_THEME for the pre-paint script.
 */
export const DEFAULT_THEME: Theme = "system";

export const THEME_STORAGE_KEY = "argus-theme";

/** Runs before first paint so the page never flashes the wrong theme. */
export const themeInitScript = `
try {
  var t = localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)}) || ${JSON.stringify(DEFAULT_THEME)};
  var d = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  if (d) document.documentElement.classList.add('dark');
  document.documentElement.style.colorScheme = d ? 'dark' : 'light';
} catch (e) {}
`;

export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <ThemeContextProvider defaultTheme={DEFAULT_THEME} storageKey={THEME_STORAGE_KEY}>
      {children}
    </ThemeContextProvider>
  );
}

export { useTheme };
export type { Theme };
