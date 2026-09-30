import { NextResponse, type NextRequest } from "next/server";
import { categoryFromIndex, type CategoryKey } from "@/lib/aqi";
import { getWeather } from "@/lib/air";
import { getHotspots, hotspotsNear, upwindFires } from "@/lib/firms";
import { haversineKm, parseLatLng } from "@/lib/geo";
import { reportsNear } from "@/lib/reports";
import { getStations, nearestStation, stationsConfigured } from "@/lib/stations";

export const dynamic = "force-dynamic";

const NEAR_KM = 60;
const FALLBACK_RADIUS_KM = 25;

/** CPCB stations in the selected point's city, with city-wide figures, fires and report counts. */
export async function GET(req: NextRequest) {
  const p = parseLatLng(req.nextUrl.searchParams);
  if (!p) return NextResponse.json({ error: "bad_coordinates" }, { status: 400 });

  const [stations, hotspots, weather, reports] = await Promise.all([
    stationsConfigured() ? getStations().catch(() => null) : Promise.resolve(null),
    getHotspots().catch(() => []),
    getWeather(p.lat, p.lng),
    reportsNear(p, 15, null).catch(() => ({ available: false, checked: [], mine: [] })),
  ]);

  const fires = {
    within25km: hotspotsNear(hotspots, p, 25).length,
    within50km: hotspotsNear(hotspots, p, 50).length,
    within100km: hotspotsNear(hotspots, p, 100).length,
    upwind: upwindFires(hotspots, p, weather?.windFromDeg ?? null).length,
  };
  const weekAgo = Date.now() - 7 * 86400000;
  const reportCounts = {
    last7days: reports.checked.filter((r) => new Date(r.createdAt).getTime() >= weekAgo).length,
    total: reports.checked.length,
  };

  const nearest = stations ? nearestStation(stations, p) : null;
  if (!stations || !nearest || nearest.km > NEAR_KM) {
    return NextResponse.json({
      stationsAvailable: !!stations,
      city: null,
      state: null,
      stations: [],
      summary: null,
      fires,
      reports: reportCounts,
    });
  }

  let inCity = stations.filter((s) => s.city && s.city === nearest.city && s.state === nearest.state);
  if (inCity.length < 2) inCity = stations.filter((s) => haversineKm(p, s) <= FALLBACK_RADIUS_KM);
  const list = inCity
    .map((s) => ({
      id: s.id,
      name: s.name,
      lat: s.lat,
      lng: s.lng,
      aqi: s.aqi,
      dominant: s.dominant,
      updatedAt: s.updatedAt,
      km: Math.round(haversineKm(p, s) * 10) / 10,
      subIndex: s.subIndex,
    }))
    .sort((a, b) => (b.aqi ?? -1) - (a.aqi ?? -1));

  const reporting = list.filter((s) => s.aqi !== null) as (typeof list[number] & { aqi: number })[];
  const categories: Partial<Record<CategoryKey, number>> = {};
  const dominant: Record<string, number> = {};
  for (const s of reporting) {
    const c = categoryFromIndex(s.aqi);
    categories[c] = (categories[c] ?? 0) + 1;
    if (s.dominant) dominant[s.dominant] = (dominant[s.dominant] ?? 0) + 1;
  }
  const avg = reporting.length ? Math.round(reporting.reduce((n, s) => n + s.aqi, 0) / reporting.length) : null;
  const latest = list.map((s) => s.updatedAt).filter(Boolean).sort().pop() ?? null;

  return NextResponse.json({
    stationsAvailable: true,
    city: nearest.city || null,
    state: nearest.state || null,
    stations: list,
    summary: {
      count: list.length,
      reporting: reporting.length,
      avg,
      max: reporting[0] ? { name: reporting[0].name, aqi: reporting[0].aqi } : null,
      min: reporting.length ? { name: reporting[reporting.length - 1].name, aqi: reporting[reporting.length - 1].aqi } : null,
      categories,
      dominant: Object.entries(dominant)
        .sort((a, b) => b[1] - a[1])
        .map(([pollutant, count]) => ({ pollutant, count })),
      updatedAt: latest,
    },
    fires,
    reports: reportCounts,
  });
}
