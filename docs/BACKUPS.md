# Production backups

Before every production migration: `MIGRATE_PRODUCTION=yes npm run db:backup:prod -- --before <migration>`
(AGENTS.md rule 11). The dump goes to the gitignored `backups/` folder on the
machine that ran it (custom format, schemas `public` and `drizzle`, checked
with `pg_restore --list`), and a row is appended here; commit it. A production
migration refuses to run without a logged backup from the last 2 hours whose
file is still on disk with a matching checksum (`src/lib/db/backups.ts`).

Off-site (from 2026-10-06): the script also encrypts the dump with age to
`BACKUP_AGE_RECIPIENT` (the owner's public key; the private key is in the
owner's password manager), uploads it to the private R2 bucket under
`prod/`, reads it back and compares SHA-256, deletes copies older than 30
days (logged in `docs/BACKUPS-PRUNED.md`), and only then appends the row
below, with `off-site: r2:<bucket>/<key> sha256 <encrypted hash>` in the
note. Without a verified off-site copy, a production migration refuses.

Restore (into a scratch database first):
- From this machine: `pg_restore --no-owner --no-privileges --dbname <url> backups/<file>.dump`
  (`--no-privileges` skips Supabase's role grants, which fail on a plain
  Postgres. Tested 2026-10-11: an R2 copy restored into a scratch database
  with all tables and rows; the only errors were those grants.)
- From R2: `MIGRATE_PRODUCTION=yes npm run db:backup:fetch -- --key prod/<file>.dump.age --identity-file <key file>`,
  then `pg_restore` as above. (Or with the age tool:
  `age -d -i <key file> <file>.age > <file>.dump`.)

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
| 2026-10-11T21:09Z | backups/prod-20261011T2109Z-before-test.dump | 1498401 | ba5682956f8ce5daf9d04c89d4e84aa3a443ce084ae841b07d33aebd072cc0a8 | test | 208 entries; off-site: r2:agent479-backups/prod/prod-20261011T2109Z-before-test.dump.age sha256 a7b7a1423f9c60c03cf8c8ae4a4cce73e15520cdfa8b0aca57c80327c41e5e85; first off-site test |
| 2026-10-11T21:15Z | backups/prod-20261011T2115Z-before-test.dump | 1498401 | ecbef7effe3d1d68e5c61de699ee7646f450d68ceb5c8d70a324fe3ad33aa57c | test | 208 entries; off-site: r2:agent479-backups/prod/prod-20261011T2115Z-before-test.dump.age sha256 57c13ba74e6a594d893b43f8fe0d96eac18e6b02a6818d09b694b44fa6522b09; test with the new key |
| 2026-10-11T21:25Z | backups/prod-20261011T2125Z-before-0024.dump | 1498477 | 7e69ad48c15a8cca99003d722270448ed4a50629e827f7fd93cc15d6d13be08b | 0024 | 208 entries; off-site: r2:agent479-backups/prod/prod-20261011T2125Z-before-0024.dump.age sha256 3b3f2ea2f18822fc5e61a52115fcc5bc8cfe567ecdabe501a2cc1d847e8dcac8 |
