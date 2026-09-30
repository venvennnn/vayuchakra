import { NextResponse, type NextRequest } from "next/server";
import { parseLatLng } from "@/lib/geo";
import { reverseGeocode } from "@/lib/geocode";

export async function GET(req: NextRequest) {
  const p = parseLatLng(req.nextUrl.searchParams);
  if (!p) return NextResponse.json({ error: "bad_coordinates" }, { status: 400 });
  const placeName = await reverseGeocode(p.lat, p.lng);
  return NextResponse.json({ placeName });
}
