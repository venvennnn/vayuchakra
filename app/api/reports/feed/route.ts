import { NextResponse, type NextRequest } from "next/server";
import { parseLatLng } from "@/lib/geo";
import { reportFeed } from "@/lib/reports";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const p = parseLatLng(req.nextUrl.searchParams);
  if (!p) return NextResponse.json({ error: "bad_coordinates" }, { status: 400 });
  const reports = await reportFeed(p, 10, 30);
  if (!reports) return NextResponse.json({ available: false, reports: [] });
  return NextResponse.json({ available: true, radiusKm: 10, days: 30, reports });
}
