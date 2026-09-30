import { NextResponse, type NextRequest } from "next/server";
import { buildContextSentence, getWeather, windCompass } from "@/lib/air";
import type { Lang } from "@/lib/copy";
import { getHotspots, hotspotsNear } from "@/lib/firms";
import { bearingDeg, compassFromDeg, parseLatLng } from "@/lib/geo";
import { reportsNear, UUID_RE } from "@/lib/reports";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const p = parseLatLng(sp);
  if (!p) return NextResponse.json({ error: "bad_coordinates" }, { status: 400 });
  const lang: Lang = sp.get("lang") === "hi" ? "hi" : "en";
  const token = sp.get("filerToken");
  const filerToken = token && UUID_RE.test(token) ? token : null;

  const [reports, hotspots, weather] = await Promise.all([
    reportsNear(p, 5, filerToken).catch(() => ({ available: false, checked: [], mine: [] })),
    getHotspots().catch(() => []),
    getWeather(p.lat, p.lng),
  ]);

  const nearestFire = hotspotsNear(hotspots, p, 20)[0] ?? null;
  const fire = nearestFire
    ? {
        km: Math.round(nearestFire.km * 10) / 10,
        direction: compassFromDeg(bearingDeg(p, nearestFire)),
        hoursAgo: Math.max(0, Math.round((Date.now() - new Date(nearestFire.acqAt).getTime()) / 3600000)),
        frp: nearestFire.frp,
        acqAt: nearestFire.acqAt,
        confidence: nearestFire.confidence,
      }
    : null;

  const windKmh = weather ? Math.round(weather.windKmh) : null;
  const windFrom = windCompass(weather ? weather.windFromDeg : null);
  const sentence = buildContextSentence(lang, {
    reportCount: reports.checked.length,
    windKmh,
    windFrom,
    fire: fire && { km: fire.km, direction: fire.direction, hoursAgo: fire.hoursAgo },
  });

  const round = (r: (typeof reports.checked)[number]) => ({ ...r, km: Math.round(r.km * 10) / 10 });
  return NextResponse.json({
    reportsAvailable: reports.available,
    reportCount: reports.checked.length,
    reports: reports.checked.slice(0, 3).map(round),
    mine: reports.mine.slice(0, 3).map(round),
    fire,
    windKmh,
    windFrom,
    sentence,
  });
}
