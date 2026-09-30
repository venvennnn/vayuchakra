import "server-only";
import { cellKey, fetchJson } from "./cache";
import { supabaseAdmin } from "./supabase/server";

const TTL_MS = 7 * 24 * 3600 * 1000;
const mem = new Map<string, { name: string; at: number }>();

type GoogleComponent = { long_name: string; types: string[] };
type GoogleGeocode = { status: string; results: { address_components: GoogleComponent[] }[] };
type Nominatim = { address?: Record<string, string> };

function joinName(local: string | undefined, city: string | undefined): string | null {
  const parts = [local, city].filter((p): p is string => !!p);
  const unique = parts.filter((p, i) => parts.indexOf(p) === i);
  return unique.length ? unique.join(", ") : null;
}

async function fromGoogle(lat: number, lng: number) {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return null;
  const url =
    `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}` +
    `&language=en&result_type=${encodeURIComponent("neighborhood|sublocality|locality")}&key=${key}`;
  const data = await fetchJson<GoogleGeocode>(url);
  if (data.status !== "OK" || !data.results.length) return null;
  const all = data.results.flatMap((r) => r.address_components);
  const find = (...types: string[]) => all.find((c) => types.some((t) => c.types.includes(t)))?.long_name;
  const name = joinName(find("neighborhood", "sublocality_level_1", "sublocality"), find("locality"));
  return name ? { name, payload: data as unknown } : null;
}

async function fromNominatim(lat: number, lng: number) {
  const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=14`;
  const data = await fetchJson<Nominatim>(url, {
    headers: {
      "User-Agent": "ProjectVayuchakra/1.0 (hyperlocal air-quality map for Delhi NCR)",
      "Accept-Language": "en",
    },
  });
  const a = data.address ?? {};
  const name = joinName(
    a.neighbourhood ?? a.suburb ?? a.quarter ?? a.city_district,
    a.city ?? a.town ?? a.village ?? a.state_district,
  );
  return name ? { name, payload: data as unknown } : null;
}

export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  const key = `geo:${cellKey(lat, lng, 3)}`;
  const now = Date.now();
  const m = mem.get(key);
  if (m && now - m.at < TTL_MS) return m.name;

  const sb = supabaseAdmin();
  if (sb) {
    const { data } = await sb.from("geocode_cache").select("place_name, fetched_at").eq("cache_key", key).maybeSingle();
    if (data && now - new Date(data.fetched_at).getTime() < TTL_MS) {
      mem.set(key, { name: data.place_name, at: now });
      return data.place_name;
    }
  }

  let result: { name: string; payload: unknown } | null = null;
  try {
    result = await fromGoogle(lat, lng);
  } catch {
    result = null;
  }
  if (!result) {
    try {
      result = await fromNominatim(lat, lng);
    } catch {
      result = null;
    }
  }
  if (!result) return null;

  mem.set(key, { name: result.name, at: now });
  if (sb) {
    await sb.from("geocode_cache").upsert({
      cache_key: key,
      place_name: result.name,
      payload: result.payload,
      fetched_at: new Date(now).toISOString(),
    });
  }
  return result.name;
}
