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
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Server only: photo checks (`app/api/reports/verify`) and the "Why is the air like this?" summary (`app/api/news`, cached per area for 3 h). `GEMINI_MODEL` is optional. If Google answers 404 or 429 (quota) for it, both try `gemini-2.5-flash`, `gemini-flash-latest`, `gemini-2.5-flash-lite`, `gemini-flash-lite-latest`, then the newest Flash models the key can list, and log `[gemini] … using <model>`. A model that hit its quota is skipped for Google's retry delay (an hour for daily limits). The summary backs off for 20 min after a failure and pauses while any model is out of quota, so photo checks keep the quota. A checker failure does not use up one of the filer's three attempts |
| `GOOGLE_MAPS_API_KEY` | Air Quality API + Geocoding, server only. Restrict it by API (and by IP if your host allows), not by HTTP referrer |
| `FIRMS_MAP_KEY` | NASA FIRMS area API, VIIRS NOAA-20 NRT (NOAA-21 retry) |
| `DATA_GOV_IN_API_KEY` | CPCB real-time station index from data.gov.in (the ~600 station markers). Free key from data.gov.in → sign up → My Account |
| `SERPAPI_API_KEY` | SerpApi Google News for local pollution headlines. Cached 8 h per area to stay near the free 100 searches/month |
| `OPEN_METEO_BASE`, `AIR_QUALITY_OPEN_METEO_BASE` | Wind and CAMS fallback |

Never add a `NEXT_PUBLIC_` prefix to the Gemini, Google, FIRMS, data.gov.in, SerpApi, or service-role keys. The browser only learns whether each is set, from `/api/status`.

## Supabase

1. Create a project and turn on **Anonymous sign-ins** (Authentication → Providers).
2. Run `supabase/migrations/001_init.sql` in the SQL editor, or with `supabase db push`. It creates the tables and enums, enables RLS on every table with no client policies, and creates the private `evidence` bucket (8 MB, jpeg/png/webp).
3. Evidence images are stored at `{report_id}/{attempt}.jpg`. The database keeps only the storage path.

## Deploy (Vercel)

Import the repo, add the environment variables above, and deploy. `app/api/reports/verify` and `app/api/news` set `maxDuration = 60`. `vercel.json` pins functions to `bom1` (Mumbai): data.gov.in is often unreachable from outside India.

The AQI heatmap uses Google Air Quality heatmap tiles through `/api/aqtiles/{z}/{x}/{y}`, so the key stays on the server. Tiles are billed per request; the CDN caches each for an hour and the layer stops fetching new tiles above zoom 12. Without the Google key the map falls back to the CAMS grid for NCR.

Vercel caps function request bodies at 4.5 MB, but photos can be up to 8 MB. Photos up to 4 MB are posted to `/api/reports/verify` as multipart. Larger ones are uploaded straight to Storage via `/api/reports/upload-url`, and verify then reads them from the bucket.

## Data flow

- **Live number**: Google Air Quality `currentConditions:lookup` (PM2.5 in µg/m³ only), then CAMS via Open-Meteo. The number is our CPCB 2014 sub-index from *hourly* PM2.5. It is labelled that way and never called the official CPCB AQI. Cached 30 min in `aqi_cache` by ~1 km cell + hour.
- **Later today**: the forecast value about 6 h ahead, from the same source.
- **Spatial estimate**: read from `pm25_estimates` if a row exists for today or yesterday within ~5 km. It is shown as a separate line. The website never trains or runs the model.
- **Fires**: FIRMS box over Punjab, Haryana, Delhi and western UP, confidence `n`/`h` only, cached 3 h in `fire_hotspots` (plus in-process). Shown on the map for the last 48 h; the card counts fires within 50 km and upwind within 400 km.
- **Stations**: CPCB station index from data.gov.in, cached 1 h. Station AQI is the highest pollutant sub-index, as CPCB publishes it.
- **News and causes**: SerpApi Google News for the area (NCR places share "Delhi NCR"), last 7 days. Gemini gets only the reading, 24 h trend, wind, fire counts and numbered headlines, and returns likely causes that cite headlines by number. Headlines are also passed to photo checks as background only.
- **Heatmap**: Google Air Quality tiles (US AQI colours) when the Google key is set. Otherwise one batched Open-Meteo request for a 6 × 6 coarse grid (36 points), bilinearly interpolated onto a 0.08° grid, with `pm25_estimates` preferred where rows exist. Cached 3 h. Labelled modelled.
- **Reports**: draft → up to 3 Gemini multimodal checks. Each call sends the photo, claim, pin, EXIF time/GPS, nearby hourly PM2.5, wind, FIRMS fires and local headlines. Gemini returns structured fields (visible event, quality, consistencies, contradictions, retry guidance). **The published score is calculated here**, not by Gemini: 30% image quality, 25% visual-event match, 20% location/time, 15% satellite or sensor, 10% report consistency. Soft-pass scores below 60 ask for another photo. After 2+ photos the final score is best image + agreement bonus − contradiction penalty. A second Gemini call writes an officer-facing incident brief. The UI labels the check “Verified live using Gemini …”. Only corroborated and plausible reports appear on the map. Rate limit: 5 drafts per `filer_token` per rolling 24 h.

## Later, not this build

A daily Cloud Run Job can export `v6_sat_completed` plus its satellite imputers and insert rows into `pm25_estimates` with `model_version = 'v6_sat_completed'`. The site already reads that table.
