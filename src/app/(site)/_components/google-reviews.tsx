"use client";

import { useRef, useState } from "react";
import { importGoogleLibrary } from "@/components/google-maps-loader";

/**
 * Google ratings and reviews (owner, 2026-10-06; AGENTS.md, Content rules).
 * Nothing from Google loads until the visitor taps the button; then Google's
 * own Place Details element renders, showing only rating and reviews, in a
 * bordered box. We never restyle it or hide its attribution, and nothing it
 * shows is stored, cached, or read by our code. If it fails (or the daily
 * quota is reached), the visitor is pointed to the Maps link, which is
 * always on the page.
 */

const TIMEOUT_MS = 15_000;

export function GoogleReviews({ googlePlaceId, browserKey }: { googlePlaceId: string; browserKey: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "shown" | "failed">("idle");

  async function show() {
    setStatus("loading");
    try {
      // Only loading Google's script is timed out; once the element is in, only its own error hides it.
      await Promise.race([
        importGoogleLibrary(browserKey, "places"),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS)),
      ]);
      const el = document.createElement("gmp-place-details");
      const req = document.createElement("gmp-place-details-place-request");
      req.setAttribute("place", googlePlaceId);
      const config = document.createElement("gmp-place-content-config");
      config.append(document.createElement("gmp-place-rating"), document.createElement("gmp-place-reviews"));
      el.append(req, config);
      el.addEventListener("gmp-error", () => setStatus("failed"));
      box.current?.replaceChildren(el);
      setStatus("shown");
    } catch {
      setStatus("failed");
    }
  }

  return (
    <section aria-label="Google ratings and reviews" className="mt-6">
      {status === "idle" && (
        <button type="button" onClick={show} className="rounded-md border border-foreground/70 px-3 py-1.5 text-sm font-semibold hover:bg-chip">
          Show Google ratings and reviews
        </button>
      )}
      {status === "loading" && <p className="text-sm text-muted">Loading from Google…</p>}
      {status === "failed" && (
        <p className="text-sm text-muted">Google ratings couldn&apos;t load right now. Use &quot;Reviews on Google Maps&quot; above instead.</p>
      )}
      {/* Google's element, kept apart from our content by a border; its own attribution untouched. */}
      <div ref={box} className={status === "loading" || status === "shown" ? "mt-3 rounded-lg border border-line p-2" : "hidden"} />
    </section>
  );
}
