import "server-only";
import { cached } from "./cache";
import { haversineKm, type LatLng } from "./geo";

// CPCB "Real time Air Quality Index from various locations" on data.gov.in.
const RESOURCE = "3b01bcb8-0b14-4abf-b6f2-c1bfd384ba69";
const TTL_MS = 60 * 60 * 1000;
const PAGE = 1000;
const MAX_PAGES = 6;

export type Station = {
  id: string;
  name: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
  updatedAt: string | null;
  /** CPCB's published index: the highest pollutant sub-index at the station. */
  aqi: number | null;
  dominant: string | null;
  /** Per-pollutant sub-index averages as published (PM2.5, PM10, NO2, OZONE, CO, SO2, NH3). */
  subIndex: Record<string, number>;
};

type Rec = Record<string, string | undefined>;

function num(v: string | undefined): number | null {
  if (v === undefined || v === null) return null;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

/** "30-09-2026 14:00:00" in IST → ISO. */
function parseIst(v: string | undefined): string | null {
  const m = v?.match(/^(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const d = new Date(`${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6] ?? "00"}+05:30`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function group(records: Rec[]): Station[] {
  const byId = new Map<string, Station>();
  for (const r of records) {
    const lat = num(r.latitude);
    const lng = num(r.longitude);
    const name = r.station?.trim();
    if (!name || lat === null || lng === null || (lat === 0 && lng === 0)) continue;
    const id = `${name}|${lat.toFixed(4)}|${lng.toFixed(4)}`;
    let s = byId.get(id);
    if (!s) {
      s = {
        id,
        name,
        city: r.city?.trim() ?? "",
        state: r.state?.trim().replace(/_/g, " ") ?? "",
        lat,
        lng,
        updatedAt: parseIst(r.last_update),
        aqi: null,
        dominant: null,
        subIndex: {},
      };
      byId.set(id, s);
    }
    const pollutant = r.pollutant_id?.trim();
    const avg = num(r.avg_value ?? r.pollutant_avg);
    if (!pollutant || avg === null) continue;
    s.subIndex[pollutant] = avg;
    if (s.aqi === null || avg > s.aqi) {
      s.aqi = Math.round(avg);
      s.dominant = pollutant;
    }
  }
  return [...byId.values()];
}

async function fetchAll(key: string): Promise<Station[] | null> {
  const records: Rec[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `https://api.data.gov.in/resource/${RESOURCE}?api-key=${key}&format=json&limit=${PAGE}&offset=${page * PAGE}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15000), cache: "no-store" });
    if (!res.ok) return page === 0 ? null : group(records);
    const data: { records?: Rec[]; total?: number | string } = await res.json();
    const batch = data.records ?? [];
    records.push(...batch);
    const total = Number(data.total);
    if (batch.length < PAGE || (Number.isFinite(total) && records.length >= total)) break;
  }
  const stations = group(records);
  return stations.length ? stations : null;
}

export function stationsConfigured(): boolean {
  return !!process.env.DATA_GOV_IN_API_KEY;
}

export async function getStations(): Promise<Station[] | null> {
  const key = process.env.DATA_GOV_IN_API_KEY;
  if (!key) return null;
  return cached("cpcb_stations:v1", "stations", TTL_MS, () => fetchAll(key).catch(() => null));
}

export function nearestStation(all: Station[], at: LatLng): (Station & { km: number }) | null {
  let best: (Station & { km: number }) | null = null;
  for (const s of all) {
    if (s.aqi === null) continue;
    const km = haversineKm(at, s);
    if (!best || km < best.km) best = { ...s, km };
  }
  return best;
}
