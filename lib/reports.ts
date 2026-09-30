import "server-only";
import type { Band, Claim } from "./confidence";
import { haversineKm, kmToDegrees, type LatLng } from "./geo";
import { supabaseAdmin } from "./supabase/server";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const MAP_BANDS: Band[] = ["corroborated", "plausible"];

export type ReportRow = {
  id: string;
  created_at: string;
  status: "draft" | "published" | "rejected";
  claim: Claim;
  lat: number;
  lng: number;
  band: Band | null;
  confidence: number | null;
  filer_token: string;
};

export type NearbyReport = {
  id: string;
  claim: Claim;
  km: number;
  createdAt: string;
  band: Band | null;
  status: ReportRow["status"];
  mine: boolean;
};

const COLS = "id, created_at, status, claim, lat, lng, band, confidence, filer_token";

export async function reportsNear(at: LatLng, radiusKm: number, filerToken: string | null) {
  const sb = supabaseAdmin();
  if (!sb) return { available: false, checked: [] as NearbyReport[], mine: [] as NearbyReport[] };
  const { dLat, dLng } = kmToDegrees(radiusKm, at.lat);
  const box = <T extends { gte: Function; lte: Function }>(q: T) =>
    q.gte("lat", at.lat - dLat).lte("lat", at.lat + dLat).gte("lng", at.lng - dLng).lte("lng", at.lng + dLng) as T;

  const publicQ = box(sb.from("reports").select(COLS).eq("status", "published").in("band", MAP_BANDS)).limit(500);
  const mineQ = filerToken
    ? box(sb.from("reports").select(COLS).eq("filer_token", filerToken).neq("status", "draft"))
        .or("status.eq.rejected,band.eq.unverified")
        .order("created_at", { ascending: false })
        .limit(20)
    : null;
  const [pub, mine] = await Promise.all([publicQ, mineQ]);
  if (pub.error) return { available: false, checked: [], mine: [] };

  const toNearby = (r: ReportRow): NearbyReport => ({
    id: r.id,
    claim: r.claim,
    km: haversineKm(at, r),
    createdAt: r.created_at,
    band: r.band,
    status: r.status,
    mine: !!filerToken && r.filer_token === filerToken,
  });
  const within = (r: NearbyReport) => r.km <= radiusKm;
  return {
    available: true,
    checked: ((pub.data ?? []) as ReportRow[]).map(toNearby).filter(within).sort((a, b) => a.km - b.km),
    mine: ((mine?.data ?? []) as ReportRow[]).map(toNearby).filter(within),
  };
}

export type MapReport = { id: string; lat: number; lng: number; claim: Claim; band: Band; createdAt: string };

export async function reportsInBox(west: number, south: number, east: number, north: number): Promise<MapReport[] | null> {
  const sb = supabaseAdmin();
  if (!sb) return null;
  const { data, error } = await sb
    .from("reports")
    .select("id, lat, lng, claim, band, created_at")
    .eq("status", "published")
    .in("band", MAP_BANDS)
    .gte("lat", south)
    .lte("lat", north)
    .gte("lng", west)
    .lte("lng", east)
    .order("created_at", { ascending: false })
    .limit(40);
  if (error) return null;
  return (data ?? []).map((r) => ({ id: r.id, lat: r.lat, lng: r.lng, claim: r.claim, band: r.band, createdAt: r.created_at }));
}

export type PublishResult =
  | { ok: true; status: "published"; attempt: number; confidence: number; band: Band }
  | { ok: false; error: "not_found" | "forbidden" | "not_draft" | "no_passing_attempt" | "db_error"; status?: string };

/**
 * Publishes a draft using its most recent soft-pass attempt. Bands come from the stored score,
 * so "unverified" reports are published but filtered out of every public query.
 */
export async function publishReport(reportId: string, filerToken: string): Promise<PublishResult> {
  const sb = supabaseAdmin();
  if (!sb) return { ok: false, error: "db_error" };
  const { data: report } = await sb.from("reports").select("id, status, filer_token").eq("id", reportId).maybeSingle();
  if (!report) return { ok: false, error: "not_found" };
  if (report.filer_token !== filerToken) return { ok: false, error: "forbidden" };
  if (report.status !== "draft") return { ok: false, error: "not_draft", status: report.status };

  const { data: attempt } = await sb
    .from("report_attempts")
    .select("attempt_no, confidence")
    .eq("report_id", reportId)
    .is("hard_fail_reason", null)
    .not("confidence", "is", null)
    .order("attempt_no", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!attempt || attempt.confidence === null) return { ok: false, error: "no_passing_attempt" };

  const confidence = attempt.confidence as number;
  const band: Band = confidence >= 75 ? "corroborated" : confidence >= 50 ? "plausible" : "unverified";
  const { error } = await sb
    .from("reports")
    .update({ status: "published", published_attempt: attempt.attempt_no, confidence, band })
    .eq("id", reportId)
    .eq("status", "draft");
  if (error) return { ok: false, error: "db_error" };
  return { ok: true, status: "published", attempt: attempt.attempt_no, confidence, band };
}
