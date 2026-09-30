import { NextResponse } from "next/server";
import { getStations, stationsConfigured } from "@/lib/stations";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!stationsConfigured()) return NextResponse.json({ available: false, reason: "not_configured", stations: [] });
  const stations = await getStations();
  if (!stations) return NextResponse.json({ available: false, reason: "source_failed", stations: [] });
  return NextResponse.json(
    {
      available: true,
      source: "CPCB via data.gov.in",
      stations: stations.map((s) => ({
        id: s.id,
        name: s.name,
        city: s.city,
        state: s.state,
        lat: s.lat,
        lng: s.lng,
        aqi: s.aqi,
        dominant: s.dominant,
        updatedAt: s.updatedAt,
      })),
    },
    { headers: { "Cache-Control": "public, s-maxage=900, stale-while-revalidate=1800" } },
  );
}
