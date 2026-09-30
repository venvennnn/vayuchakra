import "server-only";
import { normalizeVerdict, type Band, type Claim, type ScoreStep } from "./confidence";
import { buildChecks, fireKmFromSteps, type Check } from "./reportChecks";
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
export async function publishReport(
  reportId: string,
  filerToken: string,
  opts?: { confidence: number; attempt: number },
): Promise<PublishResult> {
  const sb = supabaseAdmin();
  if (!sb) return { ok: false, error: "db_error" };
  const { data: report } = await sb.from("reports").select("id, status, filer_token").eq("id", reportId).maybeSingle();
  if (!report) return { ok: false, error: "not_found" };
  if (report.filer_token !== filerToken) return { ok: false, error: "forbidden" };
  if (report.status !== "draft") return { ok: false, error: "not_draft", status: report.status };

  let attemptNo = opts?.attempt;
  let confidence = opts?.confidence;
  if (confidence === undefined || attemptNo === undefined) {
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
    attemptNo = attempt.attempt_no as number;
    confidence = attempt.confidence as number;
  }

  const band: Band = confidence >= 75 ? "corroborated" : confidence >= 50 ? "plausible" : "unverified";
  const { error } = await sb
    .from("reports")
    .update({ status: "published", published_attempt: attemptNo, confidence, band })
    .eq("id", reportId)
    .eq("status", "draft");
  if (error) return { ok: false, error: "db_error" };
  return { ok: true, status: "published", attempt: attemptNo, confidence, band };
}

export type FeedReport = {
  id: string;
  claim: Claim;
  createdAt: string;
  km: number;
  band: Band;
  confidence: number | null;
  placeName: string | null;
  description: string;
  observations: string[];
  visible: string | null;
  checks: Check[];
  brief: {
    happened: string;
    where: string;
    evidence: string[];
    exposed: string;
    action: string;
    uncertainty: string;
  } | null;
};

/**
 * Published, map-visible reports near a point with what the checker saw. Only a curated
 * summary leaves the server: never the raw Gemini reply, the photo, or the filer's note.
 */
export async function reportFeed(at: LatLng, radiusKm: number, days: number): Promise<FeedReport[] | null> {
  const sb = supabaseAdmin();
  if (!sb) return null;
  const { dLat, dLng } = kmToDegrees(radiusKm, at.lat);
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const { data, error } = await sb
    .from("reports")
    .select("id, created_at, claim, lat, lng, band, confidence, place_name, published_attempt")
    .eq("status", "published")
    .in("band", MAP_BANDS)
    .gte("created_at", since)
    .gte("lat", at.lat - dLat)
    .lte("lat", at.lat + dLat)
    .gte("lng", at.lng - dLng)
    .lte("lng", at.lng + dLng)
    .order("created_at", { ascending: false })
    .limit(60);
  if (error) return null;
  const rows = (data ?? [])
    .map((r) => ({ ...r, km: haversineKm(at, r) }))
    .filter((r) => r.km <= radiusKm)
    .slice(0, 30);
  if (!rows.length) return [];

  const { data: attempts } = await sb
    .from("report_attempts")
    .select("report_id, attempt_no, gemini")
    .in(
      "report_id",
      rows.map((r) => r.id),
    );
  const byReport = new Map<string, Record<string, unknown>>();
  for (const a of attempts ?? []) {
    const row = rows.find((r) => r.id === a.report_id);
    if (row && a.attempt_no === row.published_attempt) byReport.set(a.report_id, (a.gemini ?? {}) as Record<string, unknown>);
  }

  return rows.map((r) => {
    const g = byReport.get(r.id);
    const verdict = g ? normalizeVerdict(g.verdict) : null;
    const exifKm = typeof g?.exif_km === "number" ? g.exif_km : null;
    const fireKm = typeof g?.fire_km === "number" ? g.fire_km : fireKmFromSteps(g?.score_steps as ScoreStep[] | undefined);
    return {
      id: r.id,
      claim: r.claim as Claim,
      createdAt: r.created_at,
      km: Math.round(r.km * 10) / 10,
      band: r.band as Band,
      confidence: r.confidence,
      placeName: r.place_name,
      description: verdict?.description ?? "",
      observations: verdict?.observations ?? [],
      visible: verdict?.visible ?? null,
      checks: verdict ? buildChecks({ verdict, claim: r.claim as Claim, exifKm, nearestFireKm: fireKm }) : [],
      brief: briefFrom(g),
    };
  });
}

function briefFrom(g: Record<string, unknown> | undefined): FeedReport["brief"] {
  const b = g?.brief;
  if (!b || typeof b !== "object") return null;
  const o = b as Record<string, unknown>;
  const happened = typeof o.happened === "string" ? o.happened : "";
  if (!happened) return null;
  return {
    happened,
    where: typeof o.where === "string" ? o.where : "",
    evidence: Array.isArray(o.evidence) ? o.evidence.filter((x): x is string => typeof x === "string").slice(0, 5) : [],
    exposed: typeof o.exposed === "string" ? o.exposed : "",
    action: typeof o.action === "string" ? o.action : "",
    uncertainty: typeof o.uncertainty === "string" ? o.uncertainty : "",
  };
}
