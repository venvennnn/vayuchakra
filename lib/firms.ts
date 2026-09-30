import "server-only";
import { haversineKm, NCR_BBOX, type LatLng } from "./geo";
import { supabaseAdmin } from "./supabase/server";

const TTL_MS = 3 * 3600 * 1000;

export type Hotspot = {
  lat: number;
  lng: number;
  acqAt: string;
  confidence: "n" | "h";
  frp: number | null;
  satellite: string | null;
};

export type HotspotNear = Hotspot & { km: number };

let memo: { at: number; rows: Hotspot[]; ok: boolean } | null = null;
let inflight: Promise<Hotspot[]> | null = null;

function parseCsv(csv: string): Hotspot[] {
  const lines = csv.trim().split(/\r?\n/);
  const header = lines.shift()?.split(",") ?? [];
  const idx = (name: string) => header.indexOf(name);
  const iLat = idx("latitude");
  const iLng = idx("longitude");
  const iDate = idx("acq_date");
  const iTime = idx("acq_time");
  const iConf = idx("confidence");
  const iFrp = idx("frp");
  const iSat = idx("satellite");
  if (iLat < 0 || iLng < 0 || iDate < 0 || iTime < 0 || iConf < 0) return [];
  const out: Hotspot[] = [];
  for (const line of lines) {
    const c = line.split(",");
    const conf = c[iConf]?.trim().toLowerCase();
    if (conf !== "n" && conf !== "h") continue;
    const lat = Number(c[iLat]);
    const lng = Number(c[iLng]);
    const hhmm = c[iTime].padStart(4, "0");
    const acqAt = new Date(`${c[iDate]}T${hhmm.slice(0, 2)}:${hhmm.slice(2)}:00Z`);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Number.isNaN(acqAt.getTime())) continue;
    const frp = iFrp >= 0 ? Number(c[iFrp]) : NaN;
    out.push({
      lat,
      lng,
      acqAt: acqAt.toISOString(),
      confidence: conf,
      frp: Number.isFinite(frp) ? frp : null,
      satellite: iSat >= 0 ? c[iSat] || null : null,
    });
  }
  return out;
}

/** Returns parsed rows, or null if the key is invalid or the request failed. */
async function fetchSource(source: string, key: string): Promise<Hotspot[] | null> {
  const { west, south, east, north } = NCR_BBOX;
  const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${key}/${source}/${west},${south},${east},${north}/2`;
  const res = await fetch(url, { signal: AbortSignal.timeout(12000), cache: "no-store" });
  if (!res.ok) return null;
  const text = await res.text();
  if (!text.startsWith("latitude")) return null;
  return parseCsv(text);
}

async function fetchFirms(): Promise<{ rows: Hotspot[]; ok: boolean }> {
  const key = process.env.FIRMS_MAP_KEY;
  if (!key) return { rows: [], ok: false };
  try {
    const primary = await fetchSource("VIIRS_NOAA20_NRT", key);
    if (primary === null) return { rows: [], ok: false };
    if (primary.length) return { rows: primary, ok: true };
    const secondary = await fetchSource("VIIRS_NOAA21_NRT", key);
    return { rows: secondary ?? [], ok: secondary !== null };
  } catch {
    return { rows: [], ok: false };
  }
}

async function loadFromTable(): Promise<{ rows: Hotspot[]; fetchedAt: number } | null> {
  const sb = supabaseAdmin();
  if (!sb) return null;
  const { data, error } = await sb
    .from("fire_hotspots")
    .select("lat, lng, acq_at, confidence, frp, satellite, fetched_at")
    .order("fetched_at", { ascending: false })
    .limit(5000);
  if (error || !data?.length) return null;
  const newest = new Date(data[0].fetched_at).getTime();
  const rows = data
    .filter((r) => new Date(r.fetched_at).getTime() === newest)
    .map((r) => ({
      lat: r.lat,
      lng: r.lng,
      acqAt: new Date(r.acq_at).toISOString(),
      confidence: r.confidence as "n" | "h",
      frp: r.frp,
      satellite: r.satellite,
    }));
  return { rows, fetchedAt: newest };
}

async function refresh(): Promise<Hotspot[]> {
  const stored = await loadFromTable();
  if (stored && Date.now() - stored.fetchedAt < TTL_MS) {
    memo = { at: stored.fetchedAt, rows: stored.rows, ok: true };
    return stored.rows;
  }
  const fresh = await fetchFirms();
  if (!fresh.ok) {
    // Keep serving the last good batch rather than pretending there are no fires.
    const rows = stored?.rows ?? memo?.rows ?? [];
    memo = { at: Date.now(), rows, ok: false };
    return rows;
  }
  const at = Date.now();
  memo = { at, rows: fresh.rows, ok: true };
  const sb = supabaseAdmin();
  if (sb) {
    const fetchedAt = new Date(at).toISOString();
    if (fresh.rows.length) {
      await sb.from("fire_hotspots").insert(
        fresh.rows.map((r) => ({
          lat: r.lat,
          lng: r.lng,
          acq_at: r.acqAt,
          confidence: r.confidence,
          frp: r.frp,
          satellite: r.satellite,
          fetched_at: fetchedAt,
        })),
      );
    }
    await sb.from("fire_hotspots").delete().lt("fetched_at", fetchedAt);
  }
  return fresh.rows;
}

/** Hotspots for the NCR box, refreshed when the cached batch is older than 3 hours. */
export async function getHotspots(): Promise<Hotspot[]> {
  if (memo && Date.now() - memo.at < TTL_MS) return memo.rows;
  inflight ??= refresh().finally(() => {
    inflight = null;
  });
  return inflight;
}

export function hotspotsNear(all: Hotspot[], at: LatLng, radiusKm: number, maxAgeHours = 48): HotspotNear[] {
  const cutoff = Date.now() - maxAgeHours * 3600 * 1000;
  return all
    .filter((h) => new Date(h.acqAt).getTime() >= cutoff)
    .map((h) => ({ ...h, km: haversineKm(at, h) }))
    .filter((h) => h.km <= radiusKm)
    .sort((a, b) => a.km - b.km);
}

export function firmsConfigured(): boolean {
  return !!process.env.FIRMS_MAP_KEY;
}
