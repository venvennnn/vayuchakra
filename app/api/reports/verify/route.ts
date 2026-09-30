import exifr from "exifr";
import { NextResponse, type NextRequest } from "next/server";
import {
  bandFor,
  computeConfidence,
  hardFailReason,
  type Band,
  type Claim,
  type HardFailReason,
} from "@/lib/confidence";
import { COPY, hardFailMessage, type Lang } from "@/lib/copy";
import { getHotspots, hotspotsNear } from "@/lib/firms";
import { checkPhoto } from "@/lib/gemini";
import { haversineKm, isValidLatLng } from "@/lib/geo";
import { publishReport, UUID_RE } from "@/lib/reports";
import { EVIDENCE_BUCKET, supabaseAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BYTES = 8 * 1024 * 1024;
const MIME = ["image/jpeg", "image/png", "image/webp"];
const GEMINI_REASONS: HardFailReason[] = ["stock", "indoor", "quality", "place_conflict"];

type Outcome = "retry" | "published" | "rejected";

function reply(body: {
  attempt: number;
  attemptsRemaining: number;
  outcome: Outcome;
  reason: HardFailReason | null;
  message: string;
  confidence: number | null;
  band: Band | null;
  status: "draft" | "published" | "rejected";
}) {
  return NextResponse.json(body);
}

async function readExif(buf: Buffer) {
  try {
    const out = await exifr.parse(buf, { gps: true, tiff: true, exif: true, pick: ["DateTimeOriginal", "CreateDate", "latitude", "longitude"] });
    if (!out) return { gps: null, takenAt: null };
    const lat = Number(out.latitude);
    const lng = Number(out.longitude);
    const gps = isValidLatLng(lat, lng) && !(lat === 0 && lng === 0) ? { lat, lng } : null;
    const t = out.DateTimeOriginal ?? out.CreateDate;
    const takenAt = t instanceof Date && !Number.isNaN(t.getTime()) ? t.toISOString() : null;
    return { gps, takenAt };
  } catch {
    return { gps: null, takenAt: null };
  }
}

export async function POST(req: NextRequest) {
  const sb = supabaseAdmin();
  if (!sb) return NextResponse.json({ error: "reports_unavailable" }, { status: 503 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "bad_form" }, { status: 400 });
  }
  const reportId = String(form.get("reportId") ?? "");
  const filerToken = String(form.get("filerToken") ?? "");
  const photo = form.get("photo");
  const storagePath = form.get("storagePath");
  if (!UUID_RE.test(reportId) || !UUID_RE.test(filerToken)) {
    return NextResponse.json({ error: "bad_ids" }, { status: 400 });
  }

  const { data: report } = await sb
    .from("reports")
    .select("id, status, filer_token, claim, note, lat, lng, place_name, attempts_used, language")
    .eq("id", reportId)
    .maybeSingle();
  if (!report) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (report.filer_token !== filerToken) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (report.status !== "draft" || report.attempts_used >= 3) {
    return NextResponse.json({ error: "not_draft", status: report.status }, { status: 409 });
  }

  const lang: Lang = report.language === "hi" ? "hi" : "en";
  const attemptNo = report.attempts_used + 1;
  const path = `${report.id}/${attemptNo}.jpg`;

  let bytes: Buffer;
  let mimeType: string;
  if (photo instanceof File) {
    if (photo.size > MAX_BYTES) return NextResponse.json({ error: "too_large", message: COPY[lang].photoTooBig }, { status: 413 });
    if (!MIME.includes(photo.type)) return NextResponse.json({ error: "bad_type", message: COPY[lang].photoWrongType }, { status: 415 });
    bytes = Buffer.from(await photo.arrayBuffer());
    mimeType = photo.type;
  } else if (storagePath === path) {
    const { data: blob, error } = await sb.storage.from(EVIDENCE_BUCKET).download(path);
    if (error || !blob) return NextResponse.json({ error: "upload_missing" }, { status: 400 });
    if (blob.size > MAX_BYTES) return NextResponse.json({ error: "too_large", message: COPY[lang].photoTooBig }, { status: 413 });
    mimeType = MIME.includes(blob.type) ? blob.type : "image/jpeg";
    bytes = Buffer.from(await blob.arrayBuffer());
  } else {
    return NextResponse.json({ error: "no_photo" }, { status: 400 });
  }

  // Claim the attempt number before any slow work so concurrent requests cannot share it.
  const { data: claimed } = await sb
    .from("reports")
    .update({ attempts_used: attemptNo })
    .eq("id", report.id)
    .eq("status", "draft")
    .eq("attempts_used", attemptNo - 1)
    .select("id");
  if (!claimed?.length) return NextResponse.json({ error: "attempt_in_progress" }, { status: 409 });

  if (photo instanceof File) {
    const { error: upErr } = await sb.storage
      .from(EVIDENCE_BUCKET)
      .upload(path, bytes, { contentType: mimeType, upsert: true });
    if (upErr) {
      await sb.from("reports").update({ attempts_used: attemptNo - 1 }).eq("id", report.id).eq("attempts_used", attemptNo);
      return NextResponse.json({ error: "upload_failed", message: COPY[lang].networkError }, { status: 503 });
    }
  }

  const pin = { lat: report.lat as number, lng: report.lng as number };
  const [exif, hotspots, prev] = await Promise.all([
    readExif(bytes),
    getHotspots().catch(() => []),
    sb.from("report_attempts").select("hard_fail_reason").eq("report_id", report.id).lt("attempt_no", attemptNo),
  ]);
  const fires = hotspotsNear(hotspots, pin, 15, 48).slice(0, 5);
  const exifKm = exif.gps ? haversineKm(pin, exif.gps) : null;
  const previousHardFails = (prev.data ?? []).filter((r) => r.hard_fail_reason).length;

  const gemini = await checkPhoto({
    image: bytes,
    mimeType,
    claim: report.claim as Claim,
    note: report.note,
    pin: { ...pin, placeName: report.place_name },
    exif: exif.gps,
    exifTakenAt: exif.takenAt,
    replyLanguage: lang,
    fires: fires.map((f) => ({
      distance_km: Math.round(f.km * 10) / 10,
      frp: f.frp,
      confidence: f.confidence,
      acquired_at: f.acqAt,
    })),
  });

  const verdict = gemini.ok ? gemini.verdict : null;
  const reason = hardFailReason(verdict, exifKm);
  const scored =
    verdict && !reason
      ? computeConfidence({
          verdict,
          claim: report.claim as Claim,
          exifDistanceKm: exifKm,
          nearestFireKm: fires[0]?.km ?? null,
          previousHardFails,
        })
      : null;

  const { error: insErr } = await sb.from("report_attempts").insert({
    report_id: report.id,
    attempt_no: attemptNo,
    storage_path: path,
    exif_lat: exif.gps?.lat ?? null,
    exif_lng: exif.gps?.lng ?? null,
    exif_taken_at: exif.takenAt,
    gemini: gemini.ok
      ? { model: gemini.model, verdict: gemini.verdict, raw: gemini.raw, exif_km: exifKm, score_steps: scored?.steps ?? null }
      : { model: gemini.model, error: gemini.error, exif_km: exifKm },
    hard_fail_reason: reason,
    confidence: scored?.score ?? null,
  });
  if (insErr) return NextResponse.json({ error: "db_error", message: COPY[lang].networkError }, { status: 503 });

  const attemptsRemaining = 3 - attemptNo;

  if (scored) {
    const pub = await publishReport(report.id, filerToken);
    const band = pub.ok ? pub.band : bandFor(scored.score);
    const t = COPY[lang];
    const message =
      band === "corroborated" ? t.publishedCorroborated : band === "plausible" ? t.publishedPlausible : t.publishedUnverified;
    return reply({
      attempt: attemptNo,
      attemptsRemaining,
      outcome: "published",
      reason: null,
      message,
      confidence: scored.score,
      band,
      status: pub.ok ? "published" : "draft",
    });
  }

  if (attemptsRemaining === 0) {
    await sb.from("reports").update({ status: "rejected" }).eq("id", report.id).eq("status", "draft");
    return reply({
      attempt: attemptNo,
      attemptsRemaining: 0,
      outcome: "rejected",
      reason,
      message: COPY[lang].rejected,
      confidence: null,
      band: null,
      status: "rejected",
    });
  }

  const geminiLine = verdict && reason && GEMINI_REASONS.includes(reason) ? verdict.retry_reason.trim() : "";
  return reply({
    attempt: attemptNo,
    attemptsRemaining,
    outcome: "retry",
    reason,
    message: geminiLine || hardFailMessage(lang, reason!, exifKm ?? undefined),
    confidence: null,
    band: null,
    status: "draft",
  });
}
