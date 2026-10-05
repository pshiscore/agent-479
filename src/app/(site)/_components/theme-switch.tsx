"use client";

import { useSyncExternalStore } from "react";

/**
 * Light / dark / automatic (follows the device). The choice is a per-visitor
 * convenience kept in localStorage; the inline script in the root layout
 * applies it before the first paint, so there's no flash of the wrong theme.
 */

type Theme = "system" | "light" | "dark";
const NEXT: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };
const LABEL: Record<Theme, string> = { system: "Auto", light: "Light", dark: "Dark" };

function read(): Theme {
  try {
    const t = localStorage.getItem("theme");
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

// A tiny store over localStorage, so the button reflects the saved choice (and other tabs' changes).
const listeners = new Set<() => void>();
function subscribe(fn: () => void) {
  listeners.add(fn);
  window.addEventListener("storage", fn);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", fn);
  };
}

function apply(t: Theme) {
  const root = document.documentElement;
  if (t === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", t);
  try {
    if (t === "system") localStorage.removeItem("theme");
    else localStorage.setItem("theme", t);
  } catch {
    // Storage unavailable (private mode): the choice lasts for this page only.
  }
  listeners.forEach((fn) => fn());
}

export function ThemeSwitch() {
  // The server can't know the visitor's choice: it renders "Auto", then the client reads the real one.
  const theme = useSyncExternalStore(subscribe, read, () => "system" as Theme);
  return (
    <button
      type="button"
      onClick={() => {
        apply(NEXT[theme]);
      }}
      className="inline-flex h-9 items-center gap-1.5 rounded-pill border border-line px-3 text-xs font-semibold transition-colors duration-150 hover:border-foreground/40 motion-reduce:transition-none"
      aria-label={`Theme: ${LABEL[theme]}. Switch to ${LABEL[NEXT[theme]]}`}
    >
      <svg aria-hidden viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor">
        {theme === "dark" ? (
          <path d="M6.2 1.5a6.5 6.5 0 108.3 8.3A5.5 5.5 0 016.2 1.5z" />
        ) : theme === "light" ? (
          <path d="M8 4.5a3.5 3.5 0 110 7 3.5 3.5 0 010-7zM7.25 0h1.5v2.5h-1.5zM7.25 13.5h1.5V16h-1.5zM0 7.25h2.5v1.5H0zM13.5 7.25H16v1.5h-2.5z" />
        ) : (
          <path d="M8 1a7 7 0 100 14V1z" />
        )}
      </svg>
      {LABEL[theme]}
    </button>
  );
}
