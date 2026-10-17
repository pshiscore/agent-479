import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, sqlList, updatedAt } from "./columns";
import { runs } from "./runs";
import { sources } from "./sources";
import { type FieldProvenance, venues } from "./venues";

/**
 * The organizer registry (docs/product/organizers.md; owner, 2026-10-16):
 * who puts on events, and how we could hear about them. Entries are internal
 * pointers, not published facts, so the agent verifies each against the
 * organizer's own site and logs it; no owner sign-off. The owner approves
 * feeds (sources) and events. Venues and organizers stay separate tables,
 * linked when a venue runs its own calendar. The coverage area applies to
 * where events happen, not where an organizer is based (owner, 2026-10-17):
 * an organizer based elsewhere is added when it holds events here, and its
 * out-of-area events are still held in review like any other.
 */

export const ORGANIZER_TYPES = [
  "government",
  "parks_department",
  "fire_department",
  "library",
  "museum",
  "venue",
  "downtown_organization",
  "chamber",
  "festival_organizer",
  "race_organizer",
  "nonprofit",
  "business",
] as const;
/** How the organizer publishes events. We never fetch social media; social_only reaches us through the owner or submissions. */
export const ORGANIZER_CHANNELS = ["feed", "structured_page", "html_page", "social_only", "newsletter", "unknown"] as const;
export const ORGANIZER_STATUSES = ["candidate", "verified", "retired"] as const;
export const HOLDS_EVENTS_IN_AREA = ["yes", "no", "unknown"] as const;

/** Per-field provenance, like venues: where each fact was checked, and when. */
export interface OrganizerVerification {
  name?: FieldProvenance;
  website?: FieldProvenance;
  city?: FieldProvenance;
  channel?: FieldProvenance;
  notes?: FieldProvenance[];
}

export const organizers = pgTable(
  "organizers",
  {
    id: id(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    aliases: text("aliases").array().notNull().default(sql`'{}'::text[]`),
    organizerType: text("organizer_type", { enum: ORGANIZER_TYPES }).notNull(),
    website: text("website"),
    // Where the organizer is based (facts, nullable; may be outside the coverage area).
    city: text("city"),
    homeCounty: text("county"),
    homeState: text("state"),
    // Whether it holds events in Benton or Washington county.
    holdsEventsInArea: text("holds_events_in_area", { enum: HOLDS_EVENTS_IN_AREA }).notNull().default("unknown"),
    channel: text("channel", { enum: ORGANIZER_CHANNELS }).notNull().default("unknown"),
    status: text("status", { enum: ORGANIZER_STATUSES }).notNull().default("candidate"),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    // When feed discovery last looked at this organizer's site; due again each Chicago month (step 8).
    discoveryCheckedAt: timestamp("discovery_checked_at", { withTimezone: true }),
    // Set when the site refused discovery (a block means stop): no later run retries until the owner clears it.
    discoveryBlocked: text("discovery_blocked"),
    notes: text("notes"),
    // The venue this organizer is, or runs (a venue with its own calendar).
    venueId: uuid("venue_id").references(() => venues.id, { onDelete: "restrict" }),
    verification: jsonb("verification").$type<OrganizerVerification>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("organizers_slug_uniq").on(t.slug),
    index("organizers_name_trgm_idx").using("gin", t.name.op("extensions.gin_trgm_ops")),
    index("organizers_venue_idx").on(t.venueId),
    check("organizers_slug_check", sql.raw(`slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`)),
    check("organizers_type_check", sql.raw(`organizer_type in ${sqlList(ORGANIZER_TYPES)}`)),
    check("organizers_channel_check", sql.raw(`channel in ${sqlList(ORGANIZER_CHANNELS)}`)),
    check("organizers_status_check", sql.raw(`status in ${sqlList(ORGANIZER_STATUSES)}`)),
    check("organizers_state_check", sql.raw(`state is null or state ~ '^[A-Z]{2}$'`)),
    check("organizers_holds_events_check", sql.raw(`holds_events_in_area in ${sqlList(HOLDS_EVENTS_IN_AREA)}`)),
    check("organizers_website_check", sql.raw(`website is null or website ~ '^https://'`)),
    // Verified means the agent checked it against the organizer's own site.
    check("organizers_verified_check", sql.raw(`status <> 'verified' or last_checked_at is not null`)),
  ],
).enableRLS();

export const DISCOVERY_KINDS = ["ics", "events_api", "rss", "page_data", "html"] as const;
export const DISCOVERY_STATUSES = ["proposed", "approved", "rejected", "gone"] as const;
export const ROBOTS_RESULTS = ["allowed", "disallowed", "no_robots", "error"] as const;

/** A sample event, facts only (no descriptions), so the owner can judge a feed. */
export interface DiscoverySample {
  title: string;
  startAt: string;
  location?: string | null;
  url?: string | null;
}

/**
 * Feeds the discovery agent found on an organizer's site. Each is a proposal:
 * approving one creates a disabled, untested source, and the normal test fetch
 * and enable steps apply (it then starts in shadow). A feed that disappears is
 * marked gone, logged, never deleted.
 */
export const feedDiscoveries = pgTable(
  "feed_discoveries",
  {
    id: id(),
    organizerId: uuid("organizer_id")
      .notNull()
      .references(() => organizers.id, { onDelete: "restrict" }),
    url: text("url").notNull(),
    // The feed's own name where it has one (a CivicPlus calendar's title), else what it is.
    label: text("label"),
    kind: text("kind", { enum: DISCOVERY_KINDS }).notNull(),
    // What served it, when recognized: "civicplus", "the_events_calendar", "google_calendar", ...
    platform: text("platform"),
    robotsResult: text("robots_result", { enum: ROBOTS_RESULTS }).notNull(),
    robotsCheckedAt: timestamp("robots_checked_at", { withTimezone: true }).notNull(),
    // The terms page link and the phrases flagged on it ("automated", "scrape"); the owner decides.
    termsUrl: text("terms_url"),
    termsFlags: text("terms_flags").array().notNull().default(sql`'{}'::text[]`),
    sampleEvents: jsonb("sample_events").$type<DiscoverySample[]>().notNull().default([]),
    // Suggested title filters, e.g. "City Council"; applied only once the owner approves them on the source.
    suggestedFilters: text("suggested_filters").array().notNull().default(sql`'{}'::text[]`),
    // What the agent saw, in our words (where the link was found, why samples are missing).
    notes: text("notes"),
    status: text("status", { enum: DISCOVERY_STATUSES }).notNull().default("proposed"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    // The source approval created.
    sourceId: uuid("source_id").references(() => sources.id, { onDelete: "restrict" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decidedBy: text("decided_by"),
    decisionNote: text("decision_note"),
    runId: uuid("run_id").references(() => runs.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("feed_discoveries_organizer_url_uniq").on(t.organizerId, t.url),
    index("feed_discoveries_proposed_idx").on(t.createdAt).where(sql`${t.status} = 'proposed'`),
    check("feed_discoveries_kind_check", sql.raw(`kind in ${sqlList(DISCOVERY_KINDS)}`)),
    check("feed_discoveries_status_check", sql.raw(`status in ${sqlList(DISCOVERY_STATUSES)}`)),
    check("feed_discoveries_robots_check", sql.raw(`robots_result in ${sqlList(ROBOTS_RESULTS)}`)),
    check("feed_discoveries_url_check", sql.raw(`url ~ '^https://'`)),
    check("feed_discoveries_samples_check", sql.raw(`jsonb_typeof(sample_events) = 'array' and jsonb_array_length(sample_events) <= 5`)),
    // A disallowed feed is never approved.
    check("feed_discoveries_robots_approved_check", sql.raw(`status <> 'approved' or robots_result <> 'disallowed'`)),
    // Approval creates a source; a proposal has none.
    check("feed_discoveries_source_check", sql.raw(`(status <> 'approved' or source_id is not null) and (status <> 'proposed' or source_id is null)`)),
    check("feed_discoveries_decided_check", sql.raw(`(status in ('approved', 'rejected')) <= (decided_at is not null) and (decided_at is null) = (decided_by is null)`)),
  ],
).enableRLS();
