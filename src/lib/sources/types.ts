import type { sources } from "@/lib/db/schema";
import type { PoliteClient } from "./http";

export type SourceRow = typeof sources.$inferSelect;

/** One item a source publishes, ready to become a raw_records row. */
export interface FetchedItem {
  externalId: string;
  sourceUrl: string | null;
  // Facts only.
  payload: Record<string, unknown>;
  // The source's description: internal staging for extraction, never
  // displayed or published, purged after descriptionPurgeAfter.
  descriptionText: string | null;
  descriptionPurgeAfter: Date | null;
}

export interface FetchResult {
  items: FetchedItem[];
  // The URLs actually read, after redirects.
  feedUrls: string[];
  // Fetcher-specific counts for runs.stats (e.g. duplicates dropped).
  stats: Record<string, number>;
}

/**
 * Reads one source. A fetcher only reads and returns facts: it never writes to
 * the database, never checks `enabled` itself (the pipeline does, right before
 * calling it), and makes every request through the PoliteClient it's given.
 */
export interface Fetcher {
  name: string;
  fetch(source: SourceRow, http: PoliteClient): Promise<FetchResult>;
}

export class SourceConfigError extends Error {}
