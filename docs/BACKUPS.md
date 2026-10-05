# Production backups

Before every production migration: `MIGRATE_PRODUCTION=yes npm run db:backup:prod -- --before <migration>`
(AGENTS.md rule 11). The dump goes to the gitignored `backups/` folder on the
machine that ran it (custom format, schemas `public` and `drizzle`, checked
with `pg_restore --list`), and a row is appended here; commit it. A production
migration refuses to run without a logged backup from the last 2 hours whose
file is still on disk with a matching checksum (`src/lib/db/backups.ts`).

Restore (into a scratch database first):
`pg_restore --no-owner --dbname <url> backups/<file>.dump`

## History before the rule (2026-10-05)

- **0000–0016** (2026-10-04, ~19:56 UTC): applied to the new, empty Supabase
  project. No backup (nothing to back up yet).
- **0017 and 0018** (2026-10-04, 22:37 UTC): applied together, right after
  the `before-0017` dump below.
- **0019** (2026-10-04, ~22:38 UTC, after the deploy): no dump of its own;
  covered only by the `before-0017` dump taken about two minutes earlier.
- **0020** and **0021**: each had its own dump, below.

## Log

| Taken (UTC) | File | Bytes | SHA-256 | Before | Note |
|---|---|---|---|---|---|
| 2026-10-04T22:36Z | backups/prod-20261004T2236Z-before-0017.dump | 1284176 | 76d881d2ef7a898d95d957a42dab9da438c1c3405479e475978feddce5a31319 | 0017 | 191 entries; also covers 0018 and 0019 |
| 2026-10-04T23:50Z | backups/prod-20261004T2350Z-before-0020.dump | 1292525 | fca3c31944dc83bec71fe0eaf856b7947a49a1349f5c6e8535b0266dbfdaffe0 | 0020 | 191 entries |
| 2026-10-05T00:27Z | backups/prod-20261005T0027Z-before-0021.dump | 1305008 | 11cd9b332493dfee7bb85fabf91dbf097102dc63faceb81a7a3a31d519a83e0f | 0021 | 199 entries |
| 2026-10-05T21:54Z | backups/prod-20261005T2154Z-before-0022.dump | 1321401 | 443e6a9b552eb40b971bf63aad6077f90711b8efd2a381b2bec50c8cd4a7789e | 0022 | 192 entries; covers 0022 and 0023 |
