import { NextResponse } from "next/server";
import { cached, fetchJson } from "@/lib/cache";
import { pm25SubIndex } from "@/lib/aqi";
import { NCR_BBOX } from "@/lib/geo";
import { supabaseAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const STEP = 0.08;
const COARSE = 6; // 6 × 6 = 36 Open-Meteo locations, under the 40-call cap, in one batched request.
const TTL_MS = 3 * 3600 * 1000;

type Feature = {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: { pm25: number; aqi: number; source: "cams" | "estimate" };
};
type Grid = { type: "FeatureCollection"; step: number; generatedAt: string; label: string; features: Feature[] };

async function camsCoarse(): Promise<number[][] | null> {
  const { west, south, east, north } = NCR_BBOX;
  const lats: number[] = [];
  const lngs: number[] = [];
  for (let r = 0; r < COARSE; r++) {
    for (let c = 0; c < COARSE; c++) {
      lats.push(+(south + ((north - south) * r) / (COARSE - 1)).toFixed(4));
      lngs.push(+(west + ((east - west) * c) / (COARSE - 1)).toFixed(4));
    }
  }
  const base = process.env.AIR_QUALITY_OPEN_METEO_BASE || "https://air-quality-api.open-meteo.com";
  const url = `${base}/v1/air-quality?latitude=${lats.join(",")}&longitude=${lngs.join(",")}&current=pm2_5&timezone=Asia%2FKolkata`;
  const data = await fetchJson<{ current?: { pm2_5: number | null } }[] | { current?: { pm2_5: number | null } }>(url, undefined, 15000);
  const list = Array.isArray(data) ? data : [data];
  if (list.length !== COARSE * COARSE) return null;
  const grid: number[][] = [];
  for (let r = 0; r < COARSE; r++) {
    grid.push(list.slice(r * COARSE, (r + 1) * COARSE).map((d) => d.current?.pm2_5 ?? NaN));
  }
  return grid.flat().every((v) => !Number.isFinite(v)) ? null : grid;
}

function bilinear(grid: number[][], lat: number, lng: number): number {
  const { west, south, east, north } = NCR_BBOX;
  const fy = ((lat - south) / (north - south)) * (COARSE - 1);
  const fx = ((lng - west) / (east - west)) * (COARSE - 1);
  const y0 = Math.max(0, Math.min(COARSE - 2, Math.floor(fy)));
  const x0 = Math.max(0, Math.min(COARSE - 2, Math.floor(fx)));
  const ty = fy - y0;
  const tx = fx - x0;
  const corners = [
    [grid[y0][x0], (1 - tx) * (1 - ty)],
    [grid[y0][x0 + 1], tx * (1 - ty)],
    [grid[y0 + 1][x0], (1 - tx) * ty],
    [grid[y0 + 1][x0 + 1], tx * ty],
  ].filter(([v]) => Number.isFinite(v));
  const w = corners.reduce((s, [, wt]) => s + wt, 0);
  return w > 0 ? corners.reduce((s, [v, wt]) => s + v * wt, 0) / w : NaN;
}

async function estimatesByCell(): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const sb = supabaseAdmin();
  if (!sb) return out;
  const yesterday = new Date(Date.now() + 5.5 * 3600 * 1000 - 86400 * 1000).toISOString().slice(0, 10);
  const { west, south, east, north } = NCR_BBOX;
  const { data } = await sb
    .from("pm25_estimates")
    .select("lat, lng, predicted_pm25, observation_date")
    .gte("observation_date", yesterday)
    .gte("lat", south)
    .lte("lat", north)
    .gte("lng", west)
    .lte("lng", east)
    .limit(5000);
  const sums = new Map<string, { s: number; n: number; date: string }>();
  for (const r of data ?? []) {
    const k = `${Math.floor((r.lat - south) / STEP)}:${Math.floor((r.lng - west) / STEP)}`;
    const cur = sums.get(k);
    if (!cur || r.observation_date > cur.date) sums.set(k, { s: r.predicted_pm25, n: 1, date: r.observation_date });
    else if (r.observation_date === cur.date) sums.set(k, { s: cur.s + r.predicted_pm25, n: cur.n + 1, date: cur.date });
  }
  for (const [k, v] of sums) out.set(k, v.s / v.n);
  return out;
}

async function buildGrid(): Promise<Grid | null> {
  const [coarse, estimates] = await Promise.all([camsCoarse().catch(() => null), estimatesByCell().catch(() => new Map())]);
  if (!coarse && estimates.size === 0) return null;
  const { west, south, east, north } = NCR_BBOX;
  const rows = Math.round((north - south) / STEP);
  const cols = Math.round((east - west) / STEP);
  const features: Feature[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const lat = +(south + (r + 0.5) * STEP).toFixed(4);
      const lng = +(west + (c + 0.5) * STEP).toFixed(4);
      const est = estimates.get(`${r}:${c}`);
      const value = est ?? (coarse ? bilinear(coarse, lat, lng) : NaN);
      if (!Number.isFinite(value)) continue;
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [lng, lat] },
        properties: { pm25: Math.round(value), aqi: pm25SubIndex(value), source: est !== undefined ? "estimate" : "cams" },
      });
    }
  }
  return { type: "FeatureCollection", step: STEP, generatedAt: new Date().toISOString(), label: "modelled", features };
}

export async function GET() {
  const grid = await cached<Grid>(`heatmap:v2:ncr:${STEP}`, "heatmap", TTL_MS, buildGrid);
  if (!grid) return NextResponse.json({ error: "heatmap_unavailable" }, { status: 503 });
  return NextResponse.json(grid);
}
