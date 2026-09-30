export const INDIA_GATE = { lat: 28.6129, lng: 77.2295 };
export const DEFAULT_ZOOM = 11;

// Delhi NCR: west, south, east, north.
export const NCR_BBOX = { west: 76.6, south: 27.9, east: 77.8, north: 29.2 } as const;

export type LatLng = { lat: number; lng: number };

export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371.0088;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function bearingDeg(from: LatLng, to: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(to.lng - from.lng)) * Math.cos(toRad(to.lat));
  const x =
    Math.cos(toRad(from.lat)) * Math.sin(toRad(to.lat)) -
    Math.sin(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.cos(toRad(to.lng - from.lng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export type Compass = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";
const COMPASS: Compass[] = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];

export function compassFromDeg(deg: number): Compass {
  return COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

/** Degrees of latitude/longitude spanning `km` around a latitude, for bounding-box prefilters. */
export function kmToDegrees(km: number, lat: number) {
  const dLat = km / 110.574;
  const dLng = km / (111.32 * Math.max(0.01, Math.cos((lat * Math.PI) / 180)));
  return { dLat, dLng };
}

export function isValidLatLng(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

export function parseLatLng(params: URLSearchParams): LatLng | null {
  const lat = Number(params.get("lat"));
  const lng = Number(params.get("lng"));
  if (params.get("lat") === null || params.get("lng") === null) return null;
  return isValidLatLng(lat, lng) ? { lat, lng } : null;
}

export function formatCoords({ lat, lng }: LatLng): string {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lng >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(5)}° ${ns}, ${Math.abs(lng).toFixed(5)}° ${ew}`;
}

export function formatKm(km: number): string {
  return km < 10 ? km.toFixed(1) : String(Math.round(km));
}

const IST_TIME = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function formatIstTime(iso: string | Date): string {
  return IST_TIME.format(typeof iso === "string" ? new Date(iso) : iso);
}

export function round(n: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}
