# Project Vayuchakra

One map for Delhi NCR. It asks for the visitor's location and shows what the air is doing there right now. People can file a photo report, and Gemini checks it for scene consistency, location consistency, and fire corroboration before it is published.

Built with Next.js 15 (App Router, React 19), MapLibre GL + CARTO Positron, Supabase (Postgres, Storage, anonymous auth), and Gemini 2.5 Flash via Google AI Studio, called server-side only.

## Run locally

```bash
npm install
cp .env.example .env.local   # fill in keys
npm run dev                  # http://localhost:3000
npm test                     # CPCB sub-index + confidence rules
npm run typecheck
```

With no keys set, the map, the CAMS/Open-Meteo air values, wind, and Nominatim place names still work. Reports return 503 until Supabase is configured. Photo checks fail closed ("We could not check that photo") until `GEMINI_API_KEY` is set.

## Environment

| Variable | Where it is used |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser: anonymous session, plus direct upload of large photos to a server-issued signed URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Server routes only. All reads and writes go through it |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | `app/api/reports/verify/route.ts` only |
| `GOOGLE_MAPS_API_KEY` | Air Quality API + Geocoding, server only. Restrict it by API (and by IP if your host allows), not by HTTP referrer |
| `FIRMS_MAP_KEY` | NASA FIRMS area API, VIIRS NOAA-20 NRT (NOAA-21 retry) |
| `OPEN_METEO_BASE`, `AIR_QUALITY_OPEN_METEO_BASE` | Wind and CAMS fallback |

Never add a `NEXT_PUBLIC_` prefix to the Gemini, Google, FIRMS, or service-role keys.

## Supabase

1. Create a project and turn on **Anonymous sign-ins** (Authentication → Providers).
2. Run `supabase/migrations/001_init.sql` in the SQL editor, or with `supabase db push`. It creates the tables and enums, enables RLS on every table with no client policies, and creates the private `evidence` bucket (8 MB, jpeg/png/webp).
3. Evidence images are stored at `{report_id}/{attempt}.jpg`. The database keeps only the storage path.

## Deploy (Vercel)

Import the repo, add the environment variables above, and deploy. `app/api/reports/verify` sets `maxDuration = 60`.

Vercel caps function request bodies at 4.5 MB, but photos can be up to 8 MB. Photos up to 4 MB are posted to `/api/reports/verify` as multipart. Larger ones are uploaded straight to Storage via `/api/reports/upload-url`, and verify then reads them from the bucket.

## Data flow

- **Live number**: Google Air Quality `currentConditions:lookup` (PM2.5 in µg/m³ only), then CAMS via Open-Meteo. The number is our CPCB 2014 sub-index from *hourly* PM2.5. It is labelled that way and never called the official CPCB AQI. Cached 30 min in `aqi_cache` by ~1 km cell + hour.
- **Later today**: the forecast value about 6 h ahead, from the same source.
- **Spatial estimate**: read from `pm25_estimates` if a row exists for today or yesterday within ~5 km. It is shown as a separate line. The website never trains or runs the model.
- **Fires**: FIRMS NCR box, confidence `n`/`h` only, cached 3 h in `fire_hotspots` (plus in-process).
- **Heatmap**: one batched Open-Meteo request for a 6 × 6 coarse grid (36 points), bilinearly interpolated onto a 0.08° grid, with `pm25_estimates` preferred where rows exist. Cached 3 h. Labelled modelled.
- **Reports**: draft → up to 3 Gemini-checked attempts → published (band `corroborated` / `plausible` / `unverified`) or rejected. Only corroborated and plausible reports appear on the map. Rate limit: 5 drafts per `filer_token` per rolling 24 h.

## Later, not this build

A daily Cloud Run Job can export `v6_sat_completed` plus its satellite imputers and insert rows into `pm25_estimates` with `model_version = 'v6_sat_completed'`. The site already reads that table.
