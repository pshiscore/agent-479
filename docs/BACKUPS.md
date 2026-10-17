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
- **0025** (2026-10-11). Corrected account: my deploy shell had the local
  database exported, and the scripts didn't override it. So the first
  `--before 0025` backup run **refused** (correctly: not the production
  database), and the "production" migrate ran against the **local**
  database, where 0025 already existed, and reported success. Production
  never got 0025 while the new code was live, so pages reading `places`
  (the homepage, /new, /admin/places) failed for about 15 minutes. The
  `before-0025` backup at 21:35 was a real production backup; 0025 was then
  applied to production at about 21:52 in a clean shell, covered by it.
  Fixes: production scripts and drizzle.config now override shell values
  with `.env.production.local`, a production migrate refuses any database
  but production, and the guard needs a backup made for the newest
  migration.

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
| 2026-10-11T21:35Z | backups/prod-20261011T2135Z-before-0025.dump | 1499645 | 3aef030a66ad4b08cceff6854bb55e7b73f45f5194da110ec61c4d68e7c7f154 | 0025 | 210 entries; off-site: r2:agent479-backups/prod/prod-20261011T2135Z-before-0025.dump.age sha256 478a68ee5f6db81719b4a5c8c6f49f7b2d7ba244b64210c08f385f16266d75c7; taken just after 0025 applied (the pre-0025 attempt failed) |
| 2026-10-11T22:18Z | backups/prod-20261011T2218Z-before-0026.dump | 1503791 | d454595af4d3b89ad2e8d251035911f96aeb1120195c56c2aabcd95e272e294a | 0026 | 211 entries; off-site: r2:agent479-backups/prod/prod-20261011T2218Z-before-0026.dump.age sha256 55940f91f1a6278925dc81a99a7f259dad4e051b7b2dd824867fa6fb6ea339d2 |
| 2026-10-17T02:30Z | backups/prod-20261017T0230Z-before-0027.dump | 1607243 | affe9785b5df2edbbbe0bcd64d7d53e7d0462a4730184fb1de4be86dc4e9580e | 0027 | 211 entries; off-site: r2:agent479-backups/prod/prod-20261017T0230Z-before-0027.dump.age sha256 2a0458c0b013f49554db61dd586eb0d3669ee5b1a12bc836d01557a5e4c1ac26 |
| 2026-10-17T02:40Z | backups/prod-20261017T0239Z-before-0028.dump | 1609923 | d7e79eac911f915bb6a2d0e9ff02fd81eb1adece7201d82c9a839be8d5e90777 | 0028 | 214 entries; off-site: r2:agent479-backups/prod/prod-20261017T0239Z-before-0028.dump.age sha256 7f8ea7b0baa70d4c6287629f8808e593837a37bd1d39329f1304e14faaf4233c |
| 2026-10-17T02:56Z | backups/prod-20261017T0256Z-before-0029.dump | 1611760 | 6cd91aa7d6b678d1ca6325a645a2be18ad7c3cd04c76d92950f7868d57ed93c8 | 0029 | 214 entries; off-site: r2:agent479-backups/prod/prod-20261017T0256Z-before-0029.dump.age sha256 d1ed85743528fa20c4739b39bab543f029c4be65a6e6d64b04e59d2ea1593e3b |
| 2026-10-17T13:58Z | backups/prod-20261017T1358Z-before-0030.dump | 1649063 | 8ae4c391e00d50b8227750581b7c3a04cdb453117bd1e6309c137293e4481f47 | 0030 | 252 entries; off-site: r2:agent479-backups/prod/prod-20261017T1358Z-before-0030.dump.age sha256 d31b42d8c9c6b05a15fd2f87138dba7d42504e34fed1b5dac200611b17981fe8 |
