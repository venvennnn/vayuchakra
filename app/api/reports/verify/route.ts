import exifr from "exifr";
import { NextResponse, type NextRequest } from "next/server";
import {
  bandFor,
  combineAttempts,
  computeConfidence,
  hardFailReason,
  liveModelLabel,
  SCORE_RETRY_BELOW,
  type Band,
  type Claim,
  type CombineAttempt,
  type HardFailReason,
  type ScoreParts,
} from "@/lib/confidence";
import { COPY, hardFailMessage, type Lang } from "@/lib/copy";
import { writeIncidentBrief, type IncidentBrief } from "@/lib/brief";
import { getLiveReading, getWeather, SOURCE_LABEL, windCompass } from "@/lib/air";
import { pm25SubIndex } from "@/lib/aqi";
import { getHotspots, hotspotsNear } from "@/lib/firms";
import { checkPhoto, type CheckerError } from "@/lib/gemini";
import { haversineKm, isValidLatLng } from "@/lib/geo";
import { getNews, newsArea } from "@/lib/news";
import { buildChecks, type Check } from "@/lib/reportChecks";
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
  checkerError?: CheckerError | null;
  review?: { description: string; observations: string[]; visible: string; checks: Check[]; contradictions: string[] } | null;
  assessment?: {
    model: string;
    liveLabel: string;
    parts: ScoreParts;
    combined?: { best: number; bonus: number; penalty: number } | null;
    brief: IncidentBrief | null;
  } | null;
}) {
  return NextResponse.json(body);
}

async function readExif(buf: Buffer) {
  try {
    const out = await exifr.parse(buf, { gps: true });
    if (!out) return { gps: null, takenAt: null };
    const lat = Number(out.latitude);
    const lng = Number(out.longitude);
    const gps = isValidLatLng(lat, lng) && !(lat === 0 && lng === 0) ? { lat, lng } : null;
    // GPS date/time stamps are UTC; DateTimeOriginal has no zone, so it is only a fallback.
    let takenAt: string | null = null;
    if (typeof out.GPSDateStamp === "string" && typeof out.GPSTimeStamp === "string") {
      const d = new Date(`${out.GPSDateStamp.replace(/:/g, "-")}T${out.GPSTimeStamp.split(".")[0]}Z`);
      if (!Number.isNaN(d.getTime())) takenAt = d.toISOString();
    }
    const t = out.DateTimeOriginal ?? out.CreateDate;
    if (!takenAt && t instanceof Date && !Number.isNaN(t.getTime())) takenAt = t.toISOString();
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
  const [exif, hotspots, prev, news, live, weather] = await Promise.all([
    readExif(bytes),
    getHotspots().catch(() => []),
    sb.from("report_attempts").select("hard_fail_reason, confidence, gemini").eq("report_id", report.id).lt("attempt_no", attemptNo),
    getNews(newsArea(report.place_name)).catch(() => null),
    getLiveReading(pin.lat, pin.lng).catch(() => null),
    getWeather(pin.lat, pin.lng),
  ]);
  const fires = hotspotsNear(hotspots, pin, 15, 48).slice(0, 5);
  const exifKm = exif.gps ? haversineKm(pin, exif.gps) : null;
  const previousHardFails = (prev.data ?? []).filter((r) => r.hard_fail_reason).length;
  const aqi = live ? pm25SubIndex(live.pm25) : null;
  const windFrom = weather ? windCompass(weather.windFromDeg) : null;

  const gemini = await checkPhoto({
    image: bytes,
    mimeType,
    claim: report.claim as Claim,
    note: report.note,
    pin: { ...pin, placeName: report.place_name },
    exif: exif.gps,
    exifTakenAt: exif.takenAt,
    replyLanguage: lang,
    news: (news?.articles ?? []).slice(0, 5).map((a) => a.title),
    fires: fires.map((f) => ({
      distance_km: Math.round(f.km * 10) / 10,
      frp: f.frp,
      confidence: f.confidence,
      acquired_at: f.acqAt,
    })),
    air: live ? { pm25: Math.round(live.pm25), aqi: aqi ?? 0, source: SOURCE_LABEL[live.source], observedAt: live.observedAt } : null,
    weather: weather
      ? {
          windKmh: Math.round(weather.windKmh),
          windFrom: windFrom,
          temperatureC: Number.isFinite(weather.temperatureC) ? Math.round(weather.temperatureC) : null,
        }
      : null,
  });

  if (!gemini.ok) {
    console.error(`[verify] Gemini failed for report ${report.id} attempt ${attemptNo}: ${gemini.error} (${gemini.model}) ${gemini.detail}`);
    // Our failure, not the filer's: hand the attempt back so it can be retried with the same number.
    await sb.from("reports").update({ attempts_used: attemptNo - 1 }).eq("id", report.id).eq("attempts_used", attemptNo);
    const t = COPY[lang];
    return reply({
      attempt: attemptNo,
      attemptsRemaining: 3 - (attemptNo - 1),
      outcome: "retry",
      reason: "gemini_failed",
      message: gemini.error === "quota" ? t.checkerBusy : hardFailMessage(lang, "gemini_failed"),
      confidence: null,
      band: null,
      status: "draft",
      checkerError: gemini.error,
    });
  }
  const verdict = gemini.verdict;
  const reason = hardFailReason(verdict, exifKm);
  const nearestFireKm = fires[0]?.km ?? null;
  const scored = !reason
    ? computeConfidence({
        verdict,
        claim: report.claim as Claim,
        exifDistanceKm: exifKm,
        exifTakenAt: exif.takenAt,
        nearestFireKm,
        previousHardFails,
        aqi,
      })
    : null;
  const review = {
    description: verdict.description ?? "",
    observations: verdict.observations ?? [],
    visible: verdict.visible,
    checks: buildChecks({ verdict, claim: report.claim as Claim, exifKm, nearestFireKm }),
    contradictions: verdict.contradictions,
  };

  const { error: insErr } = await sb.from("report_attempts").insert({
    report_id: report.id,
    attempt_no: attemptNo,
    storage_path: path,
    exif_lat: exif.gps?.lat ?? null,
    exif_lng: exif.gps?.lng ?? null,
    exif_taken_at: exif.takenAt,
    gemini: {
      model: gemini.model,
      verdict: gemini.verdict,
      raw: gemini.raw,
      exif_km: exifKm,
      fire_km: nearestFireKm,
      aqi,
      score_steps: scored?.steps ?? null,
      parts: scored?.parts ?? null,
    },
    hard_fail_reason: reason,
    confidence: scored?.score ?? null,
  });
  if (insErr) return NextResponse.json({ error: "db_error", message: COPY[lang].networkError }, { status: 503 });

  const attemptsRemaining = 3 - attemptNo;
  const t = COPY[lang];
  const assessmentBase = { model: gemini.model, liveLabel: liveModelLabel(gemini.model), parts: scored?.parts ?? emptyParts(), combined: null as { best: number; bonus: number; penalty: number } | null, brief: null as IncidentBrief | null };

  const passing: CombineAttempt[] = (prev.data ?? [])
    .filter((r) => !r.hard_fail_reason && r.confidence != null)
    .map((r) => {
      const g = (r.gemini ?? {}) as { verdict?: { visible?: string; contradictions?: string[] } };
      return {
        score: r.confidence as number,
        visible: g.verdict?.visible ?? "unclear",
        contradictions: g.verdict?.contradictions ?? [],
      };
    });
  if (scored) passing.push({ score: scored.score, visible: verdict.visible, contradictions: verdict.contradictions });

  const shouldPublish = passing.length > 0 && (attemptsRemaining === 0 || (scored !== null && scored.score >= SCORE_RETRY_BELOW));
  if (shouldPublish) {
    const combined = combineAttempts(passing);
    const best = passing.reduce((a, b) => (b.score > a.score ? b : a));
    const pub = await publishReport(report.id, filerToken, { confidence: combined.score, attempt: attemptNo });
    const band = pub.ok ? pub.band : bandFor(combined.score);
    const brief = await writeIncidentBrief({
      lang,
      placeName: report.place_name,
      pin,
      claim: report.claim as Claim,
      verdict,
      score: combined.score,
      band,
      attempts: attemptNo,
      aqi,
      pm25: live ? Math.round(live.pm25) : null,
      windKmh: weather ? Math.round(weather.windKmh) : null,
      windFrom,
      firesWithin15km: fires.length,
      nearestFireKm,
    }).catch(() => null);
    if (brief) {
      await sb
        .from("report_attempts")
        .update({
          gemini: {
            model: gemini.model,
            verdict: gemini.verdict,
            raw: gemini.raw,
            exif_km: exifKm,
            fire_km: nearestFireKm,
            aqi,
            score_steps: scored?.steps ?? null,
            parts: scored?.parts ?? null,
            combined,
            brief,
          },
        })
        .eq("report_id", report.id)
        .eq("attempt_no", attemptNo);
    }
    const message =
      band === "corroborated" ? t.publishedCorroborated : band === "plausible" ? t.publishedPlausible : t.publishedUnverified;
    return reply({
      attempt: attemptNo,
      attemptsRemaining,
      outcome: "published",
      reason: null,
      message,
      confidence: combined.score,
      band,
      status: pub.ok ? "published" : "draft",
      review,
      assessment: { ...assessmentBase, parts: scored?.parts ?? emptyParts(), combined: { best: best.score, bonus: combined.bonus, penalty: combined.penalty }, brief },
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
      confidence: scored?.score ?? null,
      band: null,
      status: "rejected",
      review,
      assessment: { ...assessmentBase, parts: scored?.parts ?? emptyParts() },
    });
  }

  const lowScore = scored !== null && scored.score < SCORE_RETRY_BELOW;
  const geminiLine = verdict.retry_reason.trim();
  const message = geminiLine
    ? geminiLine
    : reason && GEMINI_REASONS.includes(reason)
      ? hardFailMessage(lang, reason, exifKm ?? undefined)
      : lowScore
        ? t.scoreTooLow(scored.score)
        : hardFailMessage(lang, reason ?? "quality", exifKm ?? undefined);
  return reply({
    attempt: attemptNo,
    attemptsRemaining,
    outcome: "retry",
    reason,
    message,
    confidence: scored?.score ?? null,
    band: null,
    status: "draft",
    review,
    assessment: { ...assessmentBase, parts: scored?.parts ?? emptyParts() },
  });
}

function emptyParts(): ScoreParts {
  return { quality: 0, event: 0, location: 0, sensor: 0, report: 0 };
}
