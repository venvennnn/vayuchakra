import { NextResponse, type NextRequest } from "next/server";
import { getEstimate, getLiveReading, getWeather, toAirResponse } from "@/lib/air";
import { parseLatLng } from "@/lib/geo";
import { reverseGeocode } from "@/lib/geocode";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const p = parseLatLng(req.nextUrl.searchParams);
  if (!p) return NextResponse.json({ error: "bad_coordinates" }, { status: 400 });
  // lite=1 skips place name, wind, and estimate (used for station dots).
  const lite = req.nextUrl.searchParams.get("lite") === "1";

  const [live, placeName, weather, estimate] = await Promise.all([
    getLiveReading(p.lat, p.lng),
    lite ? null : reverseGeocode(p.lat, p.lng).catch(() => null),
    lite ? null : getWeather(p.lat, p.lng),
    lite ? null : getEstimate(p.lat, p.lng).catch(() => null),
  ]);
  if (!live) return NextResponse.json({ error: "air_unavailable" }, { status: 503 });
  return NextResponse.json(toAirResponse(live, placeName, weather, estimate));
}
