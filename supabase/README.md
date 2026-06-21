# Immortal Pocket — Backend

Backend for the Immortal Pocket manhwa/anime streaming site.

- **Supabase** — Postgres database + auth (Google / email login)
- **Bunny** — Stream (anime video) + Storage (manhwa page images, covers)

## Build steps

- [x] **Step 1 — Core schema** (`migrations/0001_core_schema.sql`)
      Tables: `series`, `episodes`, `chapters`, `profiles`. Plus auto-profile
      trigger and Row Level Security (public read / admin write / own-profile).
- [ ] Step 2 — User-data tables: `favorites`, `watch_history`, `read_history`.
- [ ] Step 3 — Auth wiring (Google + email) and making yourself an admin.
- [ ] Step 4 — Bunny: secure video upload + signed playback.
- [ ] Step 5 — Membership / Premium (payment + ad gating).

## Running a migration

Supabase Dashboard → **SQL Editor** → **New query** → paste the file → **Run**.
Each migration is safe to re-run.

## Data model at a glance

```
auth.users (managed by Supabase)
   └─1:1─ profiles (role: user|admin, is_premium)

series (kind: anime|manhwa)
   ├─1:many─ episodes   (anime → Bunny Stream video)
   └─1:many─ chapters   (manhwa → ordered page images)
```
