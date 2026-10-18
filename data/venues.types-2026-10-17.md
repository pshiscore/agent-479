# Venue type changes for sign-off (2026-10-17)

For the /venues redesign (owner, 2026-10-17): six venues typed `other` get
one of two new venue types. Types are our own classification of what a
place is used for; nothing else about these venues changes. Until you sign
off, production keeps `other` and /venues shows them as "Other".

| Venue | City | Was | Proposed | Shown under |
|---|---|---|---|---|
| Fayetteville Town Center | Fayetteville | other | event_space | Event Spaces |
| The Jones Center | Springdale | other | event_space | Event Spaces |
| Rogers Convention Center | Rogers | other | event_space | Event Spaces |
| RECORD | Bentonville | other | event_space | Event Spaces |
| 8th Street Market | Bentonville | other | market | Districts & Markets |
| Pinnacle Hills Promenade | Rogers | other | market | Districts & Markets |

**What signing covers.** `data/venues.report.md` was regenerated after these
edits (offline checks: 56 venues, 0 errors, 1 warning, the existing Upper
Ramble note). Its contents hash was then
`06cd45558e7ceb7866ae11d8b1dfaf21d239f9b2ebadd3bb4c2416ef953f432f`; the outdoor flags
(`data/venues.outdoor-2026-10-17.md`) changed it again, and one
sign-off covers everything still pending in it: these six types, The Ramble
and Upper Ramble, and The Auditorium set inactive (already applied in
production, 2026-10-17, logged).
