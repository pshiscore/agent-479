"use client";

import { useSyncExternalStore } from "react";

/**
 * Directions (docs/product/front-page.md, H; for places and events alike).
 * The server always renders the Google Maps link, which works everywhere
 * without JavaScript; in the browser, Apple devices switch to Apple Maps.
 * Never decided by user agent on the server, so pages stay cacheable.
 */

const isApple = () => /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent);
const noop = () => () => {};

export function DirectionsLink({ google, apple, className, children }: { google: string; apple: string; className?: string; children: React.ReactNode }) {
  const onApple = useSyncExternalStore(noop, isApple, () => false);
  return (
    <a href={onApple ? apple : google} className={className} rel="noopener" target="_blank">
      {children}
    </a>
  );
}
