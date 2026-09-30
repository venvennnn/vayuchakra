import { NextResponse, type NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const MAP_TYPES = ["US_AQI", "UAQI_RED_GREEN", "UAQI_INDIGO_PERSIAN", "PM25_INDIGO_PERSIAN"] as const;

/**
 * Proxies Google Air Quality heatmap tiles so the key stays on the server.
 * Tiles are billed per request, so the CDN keeps each one for an hour.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ z: string; x: string; y: string }> }) {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return new NextResponse(null, { status: 404 });
  const { z, x, y } = await params;
  const [zi, xi, yi] = [z, x, y.replace(/\.png$/, "")].map(Number);
  const max = 2 ** zi;
  if (![zi, xi, yi].every(Number.isInteger) || zi < 0 || zi > 16 || xi < 0 || yi < 0 || xi >= max || yi >= max) {
    return new NextResponse(null, { status: 400 });
  }
  const type = req.nextUrl.searchParams.get("type") ?? "US_AQI";
  const mapType = (MAP_TYPES as readonly string[]).includes(type) ? type : "US_AQI";
  const res = await fetch(
    `https://airquality.googleapis.com/v1/mapTypes/${mapType}/heatmapTiles/${zi}/${xi}/${yi}?key=${key}`,
    { signal: AbortSignal.timeout(10000), cache: "no-store" },
  ).catch(() => null);
  if (!res?.ok) return new NextResponse(null, { status: res?.status === 429 ? 429 : 502 });
  return new NextResponse(await res.arrayBuffer(), {
    headers: {
      "Content-Type": res.headers.get("content-type") ?? "image/png",
      "Cache-Control": "public, max-age=1800, s-maxage=3600, stale-while-revalidate=3600",
    },
  });
}
