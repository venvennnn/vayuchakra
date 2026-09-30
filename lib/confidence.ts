export type Claim = "smoke" | "dust" | "traffic" | "construction" | "unsure";
export const CLAIMS: Claim[] = ["smoke", "dust", "traffic", "construction", "unsure"];

export type Band = "corroborated" | "plausible" | "unverified";

export type VisibleEvent =
  | "smoke"
  | "dust"
  | "haze"
  | "open_burning"
  | "construction"
  | "traffic"
  | "none"
  | "unclear";

export type GeminiVerdict = {
  visible: VisibleEvent;
  matches_claim: boolean;
  claim_fit: number;
  outdoor_scene: boolean;
  looks_like_screenshot_or_stock: boolean;
  image_quality: "good" | "blurry" | "dark" | "too_close" | "obstructed";
  /** 0–1 from Gemini when it sends a numeric quality; otherwise derived from the enum. */
  image_quality_score: number;
  location_consistency: number;
  event_consistency: number;
  contradictions: string[];
  fire_visible: boolean;
  smoke_visible: boolean;
  place_cues: string[];
  place_cues_conflict_with_pin: boolean;
  conflict_reason: string;
  fire_or_smoke_visible: boolean;
  ask_for_another: boolean;
  retry_reason: string;
  /** Gemini's own certainty. Never used as the published score. */
  confidence: number;
  description?: string;
  observations?: string[];
};

export type HardFailReason =
  | "stock"
  | "indoor"
  | "quality"
  | "place_conflict"
  | "exif_far"
  | "gemini_failed";

export const EXIF_MAX_KM = 2.0;

/** First hard-fail rule that trips, or null for a soft pass. */
export function hardFailReason(
  verdict: GeminiVerdict | null,
  exifDistanceKm: number | null,
): HardFailReason | null {
  if (!verdict) return "gemini_failed";
  if (verdict.looks_like_screenshot_or_stock) return "stock";
  if (!verdict.outdoor_scene) return "indoor";
  if (verdict.image_quality !== "good") return "quality";
  if (verdict.place_cues_conflict_with_pin) return "place_conflict";
  if (exifDistanceKm !== null && exifDistanceKm > EXIF_MAX_KM) return "exif_far";
  return null;
}

export type ScoreInput = {
  verdict: GeminiVerdict;
  claim: Claim;
  exifDistanceKm: number | null;
  exifTakenAt?: string | null;
  nearestFireKm: number | null;
  previousHardFails: number;
  aqi?: number | null;
};

export type ScoreStep = { signal: string; delta: number };

export const SCORE_WEIGHTS = { quality: 30, event: 25, location: 20, sensor: 15, report: 10 } as const;
export type ScoreKey = keyof typeof SCORE_WEIGHTS;
/** Soft-pass photos below this are asked for another shot, then combined across up to 3 attempts. */
export const SCORE_RETRY_BELOW = 60;

export type ScoreParts = Record<ScoreKey, number>;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

const QUALITY_SCORE: Record<GeminiVerdict["image_quality"], number> = {
  good: 0.9,
  blurry: 0.4,
  dark: 0.35,
  too_close: 0.4,
  obstructed: 0.25,
};

function qualityUnit(v: GeminiVerdict): number {
  if (v.looks_like_screenshot_or_stock || !v.outdoor_scene) return 0;
  return clamp(v.image_quality_score || QUALITY_SCORE[v.image_quality], 0, 1);
}

function eventUnit(v: GeminiVerdict, claim: Claim): number {
  let e = v.event_consistency > 0 ? v.event_consistency : v.claim_fit;
  if (!v.matches_claim) e *= 0.4;
  if ((v.visible === "none" || v.visible === "unclear") && claim !== "unsure") e *= 0.5;
  if ((claim === "smoke" || v.fire_or_smoke_visible) && v.fire_or_smoke_visible) e = Math.min(1, e + 0.08);
  return clamp(e, 0, 1);
}

function locationUnit(v: GeminiVerdict, exifKm: number | null, takenAt: string | null | undefined): number {
  let loc = v.location_consistency > 0 ? v.location_consistency : 0.5;
  if (exifKm !== null) {
    if (exifKm <= 0.5) loc = Math.max(loc, 1);
    else if (exifKm <= 2) loc = Math.max(loc, 0.8);
  }
  if (takenAt) {
    const ageH = (Date.now() - new Date(takenAt).getTime()) / 3600000;
    if (Number.isFinite(ageH) && ageH >= 0 && ageH <= 24) loc = Math.min(1, loc + 0.1);
    else if (ageH > 168) loc *= 0.7;
  }
  return clamp(loc, 0, 1);
}

function sensorUnit(v: GeminiVerdict, claim: Claim, nearestFireKm: number | null, aqi: number | null | undefined): number {
  const fireRelevant = claim === "smoke" || v.fire_or_smoke_visible;
  if (fireRelevant) {
    if (nearestFireKm !== null && nearestFireKm <= 5) return 1;
    if (nearestFireKm !== null && nearestFireKm <= 15) return 0.7;
    return v.fire_or_smoke_visible ? 0.35 : 0.1;
  }
  if (aqi != null && aqi >= 200) return 0.85;
  if (aqi != null && aqi >= 100) return 0.55;
  return 0.35;
}

function reportUnit(v: GeminiVerdict, previousHardFails: number): number {
  let r = (v.matches_claim ? 0.6 : 0.2) + v.claim_fit * 0.4;
  r -= 0.15 * previousHardFails;
  r -= 0.1 * Math.min(4, v.contradictions.length);
  return clamp(r, 0, 1);
}

/**
 * Evidence score owned by this app, not by Gemini. Weights: 30% image quality, 25% visual-event
 * match, 20% location/time, 15% satellite/sensor, 10% report consistency.
 */
export function computeConfidence(input: ScoreInput): { score: number; steps: ScoreStep[]; parts: ScoreParts } {
  const { verdict, claim, exifDistanceKm, nearestFireKm, previousHardFails } = input;
  const units: ScoreParts = {
    quality: qualityUnit(verdict),
    event: eventUnit(verdict, claim),
    location: locationUnit(verdict, exifDistanceKm, input.exifTakenAt),
    sensor: sensorUnit(verdict, claim, nearestFireKm, input.aqi),
    report: reportUnit(verdict, previousHardFails),
  };
  const parts: ScoreParts = {
    quality: units.quality * SCORE_WEIGHTS.quality,
    event: units.event * SCORE_WEIGHTS.event,
    location: units.location * SCORE_WEIGHTS.location,
    sensor: units.sensor * SCORE_WEIGHTS.sensor,
    report: units.report * SCORE_WEIGHTS.report,
  };
  const score = Math.round(clamp(parts.quality + parts.event + parts.location + parts.sensor + parts.report, 0, 100));
  const steps: ScoreStep[] = (Object.keys(SCORE_WEIGHTS) as ScoreKey[]).map((k) => ({
    signal: k,
    delta: Math.round(parts[k] * 10) / 10,
  }));
  return { score, steps, parts };
}

export type CombineAttempt = { score: number; visible: VisibleEvent | string; contradictions: string[] };

/** Final confidence = best image score + multi-image consistency bonus − contradiction penalty. */
export function combineAttempts(attempts: CombineAttempt[]): { score: number; bonus: number; penalty: number; best: number } {
  if (!attempts.length) return { score: 0, bonus: 0, penalty: 0, best: 0 };
  const best = Math.max(...attempts.map((a) => a.score));
  const winner = attempts.find((a) => a.score === best) ?? attempts[0];
  const matching = attempts.filter((a) => a.visible === winner.visible).length;
  const bonus = matching >= 2 ? Math.min(12, 6 * (matching - 1)) : 0;
  const unique = new Set(attempts.flatMap((a) => a.contradictions.map((c) => c.toLowerCase().trim()).filter(Boolean)));
  const penalty = Math.min(15, unique.size * 5);
  return { score: Math.round(clamp(best + bonus - penalty, 0, 100)), bonus, penalty, best };
}

export function bandFor(score: number): Band {
  if (score >= 75) return "corroborated";
  if (score >= 50) return "plausible";
  return "unverified";
}

const VISIBLE: VisibleEvent[] = ["smoke", "dust", "haze", "open_burning", "construction", "traffic", "none", "unclear"];
const QUALITY = ["good", "blurry", "dark", "too_close", "obstructed"] as const;

const VISIBLE_ALIAS: Record<string, VisibleEvent> = {
  open_waste_burning: "open_burning",
  fire: "smoke",
  burning: "open_burning",
  smog: "haze",
  visible_event: "unclear",
};

function asVisible(v: unknown): VisibleEvent {
  if (typeof v !== "string") return "unclear";
  const k = v.trim().toLowerCase().replace(/\s+/g, "_");
  if ((VISIBLE as string[]).includes(k)) return k as VisibleEvent;
  return VISIBLE_ALIAS[k] ?? "unclear";
}

function asQuality(raw: unknown): { image_quality: GeminiVerdict["image_quality"]; image_quality_score: number } {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const image_quality_score = clamp(raw, 0, 1);
    const image_quality: GeminiVerdict["image_quality"] =
      image_quality_score >= 0.7 ? "good" : image_quality_score >= 0.5 ? "blurry" : image_quality_score >= 0.35 ? "dark" : "obstructed";
    return { image_quality, image_quality_score };
  }
  const image_quality =
    typeof raw === "string" && (QUALITY as readonly string[]).includes(raw) ? (raw as GeminiVerdict["image_quality"]) : "obstructed";
  return { image_quality, image_quality_score: QUALITY_SCORE[image_quality] };
}

/** Coerces a parsed model reply into the schema, or returns null if it is not an object. */
export function normalizeVerdict(raw: unknown): GeminiVerdict | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
  const num = (v: unknown) => clamp(typeof v === "number" && Number.isFinite(v) ? v : 0, 0, 1);
  const str = (v: unknown) => (typeof v === "string" ? v.slice(0, 400) : "");
  const strings = (v: unknown, max: number, len: number) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim().slice(0, len)).slice(0, max) : [];
  const quality = asQuality(r.image_quality_score ?? r.image_quality);
  const fire_visible = bool(r.fire_visible, false);
  const smoke_visible = bool(r.smoke_visible, false);
  const fire_or_smoke_visible = bool(r.fire_or_smoke_visible, false) || fire_visible || smoke_visible;
  return {
    visible: asVisible(r.visible_event ?? r.visible),
    matches_claim: bool(r.matches_claim, false),
    claim_fit: num(r.claim_fit ?? r.event_consistency),
    outdoor_scene: bool(r.outdoor_scene, false),
    looks_like_screenshot_or_stock: bool(r.looks_like_screenshot_or_stock, false),
    image_quality: quality.image_quality,
    image_quality_score: typeof r.image_quality_score === "number" ? num(r.image_quality_score) : quality.image_quality_score,
    location_consistency: num(r.location_consistency),
    event_consistency: num(r.event_consistency ?? r.claim_fit),
    contradictions: strings(r.contradictions, 6, 160),
    fire_visible,
    smoke_visible,
    place_cues: strings(r.place_cues, 10, 80),
    place_cues_conflict_with_pin: bool(r.place_cues_conflict_with_pin, false),
    conflict_reason: str(r.conflict_reason),
    fire_or_smoke_visible,
    ask_for_another: bool(r.ask_for_another, false) || bool(r.request_another_image, false),
    retry_reason: str(r.retry_reason) || str(r.reason),
    confidence: num(r.confidence),
    description: str(r.description).slice(0, 300),
    observations: strings(r.observations, 5, 140),
  };
}

export function liveModelLabel(model: string): string {
  const rest = model.replace(/^models\//, "").replace(/^gemini-?/i, "");
  if (!rest) return "Gemini";
  const pretty = rest
    .split("-")
    .map((w) => (w === "latest" ? "latest" : w.replace(/^\w/, (c) => c.toUpperCase())))
    .join(" ");
  return `Gemini ${pretty}`;
}
