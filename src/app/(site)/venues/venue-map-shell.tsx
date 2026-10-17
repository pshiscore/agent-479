"use client";

import dynamic from "next/dynamic";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { Pin, VenueMapHandle } from "./venue-map";

/**
 * List beside the map on wide screens; a List / Map switch on phones (Phase B).
 * The map's code and files load only when the map is on screen. The list is
 * server-rendered and works on its own.
 */

const VenueMap = dynamic(() => import("./venue-map"), { ssr: false, loading: () => <div className="h-full w-full animate-pulse bg-chip motion-reduce:animate-none" /> });

const Focus = createContext<((slug: string) => void) | null>(null);

export function VenueMapShell({ pins, base, children }: { pins: Pin[]; base: string; children: React.ReactNode }) {
  const [view, setView] = useState<"list" | "map">("list");
  const [wide, setWide] = useState(false);
  const mapRef = useRef<VenueMapHandle>(null);
  const pending = useRef<string | null>(null);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const update = () => setWide(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const showMap = wide || view === "map";

  // A card's "Show on map": on phones, switch to the map first.
  const focus = useCallback(
    (slug: string) => {
      if (!wide) setView("map");
      if (mapRef.current) mapRef.current.focus(slug);
      else pending.current = slug;
    },
    [wide],
  );
  useEffect(() => {
    if (showMap && pending.current && mapRef.current) {
      mapRef.current.focus(pending.current);
      pending.current = null;
    }
  });

  // A pin: show its card in the list and highlight it.
  const onSelect = useCallback(
    (slug: string) => {
      if (!wide) setView("list");
      requestAnimationFrame(() => {
        const card = document.getElementById(`venue-${slug}`);
        if (!card) return;
        document.querySelectorAll("[data-selected]").forEach((el) => el.removeAttribute("data-selected"));
        card.setAttribute("data-selected", "");
        card.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
        card.querySelector("a")?.focus({ preventScroll: true });
      });
    },
    [wide],
  );

  const tab = (v: "list" | "map", label: string) => (
    <button
      type="button"
      onClick={() => setView(v)}
      aria-pressed={view === v}
      className={`h-10 flex-1 rounded-pill px-4 text-sm font-semibold ${view === v ? "bg-accent text-accent-ink" : "text-foreground"}`}
    >
      {label}
    </button>
  );

  return (
    <Focus.Provider value={focus}>
      <div className="mb-4 flex rounded-pill border border-line p-1 lg:hidden">
        {tab("list", "List")}
        {tab("map", "Map")}
      </div>
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-6">
        <div className={view === "map" ? "hidden lg:block" : ""}>{children}</div>
        <div className={`${view === "map" ? "block" : "hidden"} h-[70vh] overflow-hidden rounded-xl border border-line lg:sticky lg:top-4 lg:block lg:h-[calc(100vh-2rem)]`}>
          {showMap && <VenueMap ref={mapRef} pins={pins} base={base} onSelect={onSelect} />}
        </div>
      </div>
    </Focus.Provider>
  );
}

/** A small button beside a card (the card itself links to the venue page). */
export function ShowOnMap({ slug, name }: { slug: string; name: string }) {
  const focus = useContext(Focus);
  if (!focus) return null;
  return (
    <button
      type="button"
      onClick={() => focus(slug)}
      aria-label={`Show ${name} on the map`}
      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line hover:border-foreground/40"
    >
      <svg aria-hidden viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 14s4.5-4 4.5-7.5a4.5 4.5 0 10-9 0C3.5 10 8 14 8 14z" />
        <circle cx="8" cy="6.5" r="1.5" />
      </svg>
    </button>
  );
}
