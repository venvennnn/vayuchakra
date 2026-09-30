import { NextResponse, type NextRequest } from "next/server";
import { CATEGORY_LABEL_EN, categoryFromIndex, pm25SubIndex } from "@/lib/aqi";
import { getLiveReading, getWeather, SOURCE_LABEL, windCompass } from "@/lib/air";
import { COPY, type Lang } from "@/lib/copy";
import { getHotspots, hotspotsNear, upwindFires } from "@/lib/firms";
import { INDIA_GATE, parseLatLng } from "@/lib/geo";
import { reverseGeocode } from "@/lib/geocode";
import { getInsight } from "@/lib/insight";
import { getNews, newsArea, newsConfigured } from "@/lib/news";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Local pollution news (SerpApi) plus a Gemini explanation of what is likely driving the air. */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const p = parseLatLng(sp);
  if (!p) return NextResponse.json({ error: "bad_coordinates" }, { status: 400 });
  const lang: Lang = sp.get("lang") === "hi" ? "hi" : "en";

  const placeName = await reverseGeocode(p.lat, p.lng).catch(() => null);
  const area = newsArea(placeName);
  // The explanation is cached per area, so NCR is always described from the same centre point.
  const basis = area === "Delhi NCR" ? INDIA_GATE : p;
  const [news, live, weather, hotspots] = await Promise.all([
    newsConfigured() ? getNews(area) : Promise.resolve(null),
    getLiveReading(basis.lat, basis.lng),
    getWeather(basis.lat, basis.lng),
    getHotspots().catch(() => []),
  ]);

  const articles = news?.articles ?? [];
  let insight = null;
  if (live) {
    const aqi = pm25SubIndex(live.pm25);
    const windFrom = windCompass(weather?.windFromDeg ?? null);
    insight = await getInsight({
      area,
      lang,
      aqi,
      category: CATEGORY_LABEL_EN[categoryFromIndex(aqi)],
      pm25: Math.round(live.pm25),
      source: SOURCE_LABEL[live.source],
      trend: live.hourly.filter((_, i) => i % 3 === 0).map((h) => ({ at: h.at, pm25: Math.round(h.pm25) })),
      windKmh: weather ? Math.round(weather.windKmh) : null,
      windFrom: windFrom ? COPY.en.compass[windFrom] : null,
      temperatureC: weather ? Math.round(weather.temperatureC) : null,
      firesWithin50km: hotspotsNear(hotspots, basis, 50).length,
      firesUpwind: upwindFires(hotspots, basis, weather?.windFromDeg ?? null).length,
      articles,
    }).catch(() => null);
  }

  return NextResponse.json({
    area,
    newsAvailable: news !== null,
    articles: articles.slice(0, 4),
    insight,
  });
}
