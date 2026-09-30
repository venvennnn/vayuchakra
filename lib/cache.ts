import "server-only";
import { supabaseAdmin } from "./supabase/server";

type Entry = { payload: unknown; at: number };
const mem = new Map<string, Entry>();
const MEM_MAX = 1000;

function memSet(key: string, payload: unknown, at: number) {
  if (mem.size >= MEM_MAX) mem.delete(mem.keys().next().value as string);
  mem.set(key, { payload, at });
}

/**
 * Read-through cache backed by the aqi_cache table, with an in-process layer in front.
 * Null results are not cached so a failing source is retried on the next request.
 */
export async function cached<T>(
  key: string,
  kind: string,
  ttlMs: number,
  fetcher: () => Promise<T | null>,
): Promise<T | null> {
  const now = Date.now();
  const hit = mem.get(key);
  if (hit && now - hit.at < ttlMs) return hit.payload as T;

  const sb = supabaseAdmin();
  if (sb) {
    const { data } = await sb.from("aqi_cache").select("payload, fetched_at").eq("cache_key", key).maybeSingle();
    if (data) {
      const at = new Date(data.fetched_at).getTime();
      if (now - at < ttlMs) {
        memSet(key, data.payload, at);
        return data.payload as T;
      }
    }
  }

  const value = await fetcher();
  if (value === null) return null;
  memSet(key, value, now);
  if (sb) {
    await sb
      .from("aqi_cache")
      .upsert({ cache_key: key, kind, payload: value, fetched_at: new Date(now).toISOString() });
  }
  return value;
}

export function hourBucket(d = new Date()): string {
  return d.toISOString().slice(0, 13);
}

export function cellKey(lat: number, lng: number, decimals = 2): string {
  return `${lat.toFixed(decimals)},${lng.toFixed(decimals)}`;
}

export async function fetchJson<T>(url: string, init?: RequestInit, timeoutMs = 8000): Promise<T> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} from ${new URL(url).host}`);
  return (await res.json()) as T;
}
