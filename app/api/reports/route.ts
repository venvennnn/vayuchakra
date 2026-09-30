import { NextResponse, type NextRequest } from "next/server";
import { CLAIMS, type Claim } from "@/lib/confidence";
import { COPY } from "@/lib/copy";
import { isValidLatLng } from "@/lib/geo";
import { reverseGeocode } from "@/lib/geocode";
import { reportsInBox, UUID_RE } from "@/lib/reports";
import { supabaseAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const DAILY_LIMIT = 5;

export async function POST(req: NextRequest) {
  const sb = supabaseAdmin();
  if (!sb) return NextResponse.json({ error: "reports_unavailable" }, { status: 503 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }
  const filerToken = String(body.filerToken ?? "");
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  const claim = body.claim as Claim;
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 240) : "";
  const language = body.language === "hi" ? "hi" : "en";

  if (!UUID_RE.test(filerToken)) return NextResponse.json({ error: "bad_filer_token" }, { status: 400 });
  if (!isValidLatLng(lat, lng)) return NextResponse.json({ error: "bad_coordinates" }, { status: 400 });
  if (!CLAIMS.includes(claim)) return NextResponse.json({ error: "bad_claim" }, { status: 400 });

  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count, error: countError } = await sb
    .from("reports")
    .select("id", { count: "exact", head: true })
    .eq("filer_token", filerToken)
    .gte("created_at", since);
  if (countError) return NextResponse.json({ error: "reports_unavailable" }, { status: 503 });
  if ((count ?? 0) >= DAILY_LIMIT) {
    return NextResponse.json({ error: "rate_limited", message: COPY[language].rateLimited }, { status: 429 });
  }

  const placeName = await reverseGeocode(lat, lng).catch(() => null);
  const { data, error } = await sb
    .from("reports")
    .insert({ filer_token: filerToken, lat, lng, claim, note: note || null, language, place_name: placeName })
    .select("id")
    .single();
  if (error || !data) return NextResponse.json({ error: "reports_unavailable" }, { status: 503 });
  return NextResponse.json({ reportId: data.id, attemptsRemaining: 3 });
}

/** Published corroborated/plausible reports in a bbox (west,south,east,north), up to 40. */
export async function GET(req: NextRequest) {
  const bbox = (req.nextUrl.searchParams.get("bbox") ?? "").split(",").map(Number);
  if (bbox.length !== 4 || bbox.some((n) => !Number.isFinite(n))) {
    return NextResponse.json({ error: "bad_bbox" }, { status: 400 });
  }
  const [west, south, east, north] = bbox;
  const reports = await reportsInBox(west, south, east, north);
  if (reports === null) return NextResponse.json({ reports: [], available: false });
  return NextResponse.json({ reports, available: true });
}
