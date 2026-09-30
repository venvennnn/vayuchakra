import { NextResponse } from "next/server";
import { firmsConfigured } from "@/lib/firms";
import { newsConfigured } from "@/lib/news";
import { stationsConfigured } from "@/lib/stations";

export const dynamic = "force-dynamic";

/** Which optional layers have their keys configured. Never returns key values. */
export async function GET() {
  return NextResponse.json({
    googleHeatmap: !!process.env.GOOGLE_MAPS_API_KEY,
    stations: stationsConfigured(),
    fires: firmsConfigured(),
    news: newsConfigured(),
    insight: !!process.env.GEMINI_API_KEY,
  });
}
