"use client";

import { useEffect } from "react";

/**
 * Keyboard and pointer polish for the filter chip menus (<details
 * data-chip-menu>). Without JavaScript the menus still open and every option
 * is a link; this adds: one menu open at a time, arrow keys between options,
 * Escape closes and returns focus to the chip, a click outside (or on the
 * phone's backdrop) closes, and choosing an option closes the menu.
 */
export function ChipsEnhancer() {
  useEffect(() => {
    const menus = () => [...document.querySelectorAll<HTMLDetailsElement>("details[data-chip-menu]")];
    const closeAll = (except?: Element) => {
      for (const m of menus()) if (m !== except && m.open) m.open = false;
    };

    const onToggle = (e: Event) => {
      const d = e.target as HTMLDetailsElement;
      if (!d.matches?.("details[data-chip-menu]") || !d.open) return;
      closeAll(d);
      // Focus the chosen option, or the first one.
      (d.querySelector<HTMLAnchorElement>("a[aria-current]") ?? d.querySelector<HTMLAnchorElement>("a"))?.focus();
    };
    const onKey = (e: KeyboardEvent) => {
      const d = (e.target as Element).closest?.("details[data-chip-menu]") as HTMLDetailsElement | null;
      if (!d?.open) return;
      const links = [...d.querySelectorAll<HTMLAnchorElement>("a")];
      const i = links.indexOf(document.activeElement as HTMLAnchorElement);
      if (e.key === "Escape") {
        e.preventDefault();
        d.open = false;
        d.querySelector("summary")?.focus();
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const next = e.key === "ArrowDown" ? (i + 1) % links.length : (i - 1 + links.length) % links.length;
        links[next]?.focus();
      } else if (e.key === "Home" || e.key === "End") {
        e.preventDefault();
        links[e.key === "Home" ? 0 : links.length - 1]?.focus();
      }
    };
    const onClick = (e: MouseEvent) => {
      const t = e.target as Element;
      if (t.closest?.("[data-chip-backdrop]")) return closeAll();
      if (t.closest?.("details[data-chip-menu] a")) return closeAll();
      if (!t.closest?.("details[data-chip-menu]")) closeAll();
    };

    document.addEventListener("toggle", onToggle, true);
    document.addEventListener("keydown", onKey);
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("toggle", onToggle, true);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onClick);
    };
  }, []);
  return null;
}
