# Outdoor venues for sign-off (2026-10-17)

For event weather (owner, 2026-10-17): outdoor events show the chance of
rain and NWS warning badges. Parks, areas, and plazas are outdoor by their
type (20 venues, no change to them). Seven more get an explicit `"outdoor": true`
in `data/venues.seed.json`:

| Venue | City | Type | Why outdoor |
|---|---|---|---|
| Walmart AMP | Rogers | music_venue | Open-air amphitheater (owner) |
| Butterfield Stage | Rogers | music_venue | Outdoor stage at Railyard Park (owner) |
| Arvest Ballpark | Springdale | arena | Open-air ballpark (owner) |
| Baum-Walker Stadium | Fayetteville | arena | Open-air ballpark (owner) |
| Razorback Stadium | Fayetteville | arena | Open-air football stadium (owner) |
| Razorback Field | Fayetteville | arena | Open-air soccer field (owner) |
| Pinnacle Hills Promenade | Rogers | market (proposed; now other) | Open-air shopping center (owner, added 2026-10-17) |

Not outdoor: Bud Walton Arena and Barnhill Arena (indoor). The full list of
27 is pinned by `src/lib/weather/outdoor.test.ts`.

**What signing covers.** `data/venues.report.md` was regenerated after these
edits (offline: 56 venues, 0 errors, 1 warning, the existing Upper Ramble
note). Its contents hash is now
`e138d5b14fd58a07f42dfd7b9e95bc4d757768beb56c716a8c043e1d0d8c66b3`, and one
sign-off covers everything pending: these six outdoor flags, the six new
venue types (`data/venues.types-2026-10-17.md`), The Ramble and Upper
Ramble, and The Auditorium set inactive (already applied in production).
