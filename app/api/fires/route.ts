import { NextResponse } from "next/server";
import { firmsConfigured, getHotspots } from "@/lib/firms";

export const dynamic = "force-dynamic";

/** Satellite hotspots from the last 48 h in the North India box, as GeoJSON points. */
export async function GET() {
  if (!firmsConfigured()) return NextResponse.json({ type: "FeatureCollection", available: false, features: [] });
  const cutoff = Date.now() - 48 * 3600 * 1000;
  const rows = (await getHotspots().catch(() => [])).filter((h) => new Date(h.acqAt).getTime() >= cutoff);
  return NextResponse.json(
    {
      type: "FeatureCollection",
      available: true,
      features: rows.map((h) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [h.lng, h.lat] },
        properties: { frp: h.frp ?? 0, confidence: h.confidence, acqAt: h.acqAt },
      })),
    },
    { headers: { "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=3600" } },
  );
}
