import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, id, sqlList, updatedAt } from "./columns";
import { venues } from "./venues";

export const SOURCE_KINDS = ["api", "ics", "rss", "jsonld_sitemap", "html"] as const;
export const COMMERCIAL_USE = ["yes", "no", "unknown"] as const;
export const DEDUP_MODES = ["shadow", "live"] as const;
/**
 * Whether a source's events publish (owner, 2026-10-16): proposed (not fetched
 * yet), shadow (fetched and processed, events only go to /admin/review), live
 * (publishes through the normal gate), paused (not fetched). Every transition
 * is logged; promotion to live is the owner's.
 */
export const PUBLISH_STATES = ["proposed", "shadow", "live", "paused"] as const;
export const LINK_MODES = ["deep", "homepage_only"] as const;
/**
 * Why a source is off. untested: never fetched yet; only these may be test
 * fetched. awaiting_permission: never fetched, not even a test, until the
 * owner records permission. blocked: the site refused us; manual re-enable
 * only. manual: the owner turned it off.
 */
export const DISABLED_REASONS = ["untested", "awaiting_permission", "blocked", "manual"] as const;

/**
 * Where events come from. A source with enabled = false is never fetched;
 * the fetch layer enforces that itself (AGENTS.md rule 6). Sources awaiting
 * permission may leave kind and fetcher unset until we know how we'll read them.
 */
export const sources = pgTable(
  "sources",
  {
    id: id(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    kind: text("kind", { enum: SOURCE_KINDS }),
    // Which fetcher module reads it, e.g. "ics" or "ticketmaster".
    fetcher: text("fetcher"),
    baseUrl: text("base_url").notNull(),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    defaultVenueId: uuid("default_venue_id").references(() => venues.id, { onDelete: "set null" }),
    trustLevel: integer("trust_level").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    // Existing sources were live before shadow mode existed; new ones enter through
    // a test fetch, which puts them in shadow (src/lib/sources/admin.ts).
    publishState: text("publish_state", { enum: PUBLISH_STATES }).notNull().default("live"),
    publishStateSince: timestamp("publish_state_since", { withTimezone: true }).notNull().defaultNow(),
    disabledReason: text("disabled_reason", { enum: DISABLED_REASONS }).default("untested"),
    fetchIntervalMinutes: integer("fetch_interval_minutes").notNull(),
    commercialUseOk: text("commercial_use_ok", { enum: COMMERCIAL_USE }).notNull().default("unknown"),
    termsNotes: text("terms_notes").notNull(),
    // The source's own published statement about prices, e.g. "Programs are
    // free unless the event lists a fee." When set, its events are Free unless
    // their listing mentions a fee, cost, or ticket price. Only set from a page
    // the owner verified in the browser; that page is recorded beside it.
    defaultPriceNote: text("default_price_note"),
    defaultPriceNoteSource: jsonb("default_price_note_source").$type<{
      url: string;
      checkedAt: string;
      verifiedBy: "owner";
      confirmed: string;
    }>(),
    dedupMode: text("dedup_mode", { enum: DEDUP_MODES }).notNull().default("shadow"),
    lastFetchedAt: timestamp("last_fetched_at", { withTimezone: true }),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    lastError: text("last_error"),
    robotsCheckedAt: timestamp("robots_checked_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("sources_slug_uniq").on(t.slug),
    check("sources_slug_check", sql.raw(`slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`)),
    check("sources_kind_check", sql.raw(`kind is null or kind in ${sqlList(SOURCE_KINDS)}`)),
    // Nothing can be switched on until we know how to read it.
    check("sources_enabled_check", sql.raw(`not enabled or (kind is not null and fetcher is not null)`)),
    // "is not null" matters: NULL in (...) is NULL, which a CHECK lets through.
    check(
      "sources_disabled_reason_check",
      sql.raw(
        `(enabled and disabled_reason is null) or ` +
          `(not enabled and disabled_reason is not null and disabled_reason in ${sqlList(DISABLED_REASONS)})`,
      ),
    ),
    check(
      "sources_price_note_check",
      sql.raw(`(default_price_note is null) = (default_price_note_source is null)`),
    ),
    check("sources_publish_state_check", sql.raw(`publish_state in ${sqlList(PUBLISH_STATES)}`)),
    check("sources_trust_check", sql.raw(`trust_level between 1 and 5`)),
    check("sources_interval_check", sql.raw(`fetch_interval_minutes >= 15`)),
    check("sources_commercial_check", sql.raw(`commercial_use_ok in ${sqlList(COMMERCIAL_USE)}`)),
    check("sources_dedup_check", sql.raw(`dedup_mode in ${sqlList(DEDUP_MODES)}`)),
    check("sources_failures_check", sql.raw(`consecutive_failures >= 0`)),
    check("sources_base_url_check", sql.raw(`base_url ~ '^https://'`)),
  ],
).enableRLS();

/**
 * How we may link to a domain. Applied when links are rendered, never stored
 * into events, so a policy change takes effect without touching event data.
 * A domain with no row gets deep links.
 */
export const linkPolicies = pgTable(
  "link_policies",
  {
    // uuid key like every table, so changes can be logged and rolled back.
    id: id(),
    // Registrable domain without scheme or "www.", e.g. "crystalbridges.org".
    domain: text("domain").notNull(),
    mode: text("mode", { enum: LINK_MODES }).notNull(),
    homepageUrl: text("homepage_url"),
    reason: text("reason").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("link_policies_domain_uniq").on(t.domain),
    check("link_policies_mode_check", sql.raw(`mode in ${sqlList(LINK_MODES)}`)),
    check("link_policies_domain_check", sql.raw(`domain ~ '^[a-z0-9-]+(\\.[a-z0-9-]+)+$' and domain !~ '^www\\.'`)),
    // "is not null" matters: a NULL regex match would make the check pass.
    check(
      "link_policies_homepage_check",
      sql.raw(`mode = 'deep' or (homepage_url is not null and homepage_url ~ '^https://')`),
    ),
  ],
).enableRLS();
