"use client";

/**
 * Loads Google's Maps JavaScript API on demand, once, using Google's
 * documented dynamic bootstrap (importLibrary). Nothing from Google loads
 * until a function here is called, i.e. until someone taps a button.
 */

type ImportLibrary = (name: string) => Promise<Record<string, unknown>>;
type GoogleGlobal = { maps?: { importLibrary?: ImportLibrary; __ib__?: () => void } };

let loading: Promise<void> | null = null;

function inject(key: string): Promise<void> {
  if (loading) return loading;
  loading = new Promise<void>((resolve, reject) => {
    const w = window as unknown as { google?: GoogleGlobal };
    if (w.google?.maps?.importLibrary) return resolve();
    const g = (w.google ??= {});
    const maps = (g.maps ??= {});
    maps.__ib__ = () => resolve();
    const params = new URLSearchParams({ key, v: "weekly", loading: "async", callback: "google.maps.__ib__" });
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?${params}`;
    s.async = true;
    s.onerror = () => {
      loading = null;
      reject(new Error("Google Maps couldn't load"));
    };
    document.head.append(s);
  });
  return loading;
}

export async function importGoogleLibrary(key: string, name: "places"): Promise<Record<string, unknown>> {
  await inject(key);
  const maps = (window as unknown as { google: Required<GoogleGlobal> }).google.maps;
  return maps.importLibrary!(name);
}
