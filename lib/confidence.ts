export type Claim = "smoke" | "dust" | "traffic" | "construction" | "unsure";
export const CLAIMS: Claim[] = ["smoke", "dust", "traffic", "construction", "unsure"];

export type Band = "corroborated" | "plausible" | "unverified";

export type GeminiVerdict = {
  visible: "smoke" | "dust" | "haze" | "open_burning" | "construction" | "traffic" | "none" | "unclear";
  matches_claim: boolean;
  claim_fit: number;
  outdoor_scene: boolean;
  looks_like_screenshot_or_stock: boolean;
  image_quality: "good" | "blurry" | "dark" | "too_close" | "obstructed";
  place_cues: string[];
  place_cues_conflict_with_pin: boolean;
  conflict_reason: string;
  fire_or_smoke_visible: boolean;
  ask_for_another: boolean;
  retry_reason: string;
  confidence: number;
  /** Plain description of the scene, in the filer's language. Shown publicly with the report. */
  description?: string;
  /** Short things the checker noticed, in the filer's language. */
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
  /** Nearest FIRMS hotspot from the last 48 h, or null if none. */
  nearestFireKm: number | null;
  previousHardFails: number;
};

export type ScoreStep = { signal: string; delta: number };

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function computeConfidence(input: ScoreInput): { score: number; steps: ScoreStep[] } {
  const { verdict, claim, exifDistanceKm, nearestFireKm, previousHardFails } = input;
  const steps: ScoreStep[] = [];
  const base = clamp(Number(verdict.confidence) || 0, 0, 1) * 100;
  let score = base;
  const add = (signal: string, delta: number) => {
    steps.push({ signal, delta });
    score += delta;
  };

  if (exifDistanceKm !== null) {
    if (exifDistanceKm <= 0.5) add("exif_within_0_5km", 15);
    else if (exifDistanceKm <= 2) add("exif_within_2km", 8);
  }

  const fireRelevant = claim === "smoke" || verdict.fire_or_smoke_visible;
  if (fireRelevant && nearestFireKm !== null) {
    if (nearestFireKm <= 5) add("firms_within_5km", 12);
    else if (nearestFireKm <= 15) add("firms_within_15km", 6);
  }

  const noFireWithin15 = nearestFireKm === null || nearestFireKm > 15;
  if (claim === "smoke" && noFireWithin15 && !verdict.fire_or_smoke_visible) {
    add("smoke_claim_uncorroborated", -10);
  }

  const fit = Number(verdict.claim_fit) || 0;
  if (fit >= 0.75) add("claim_fit_high", 8);
  else if (fit < 0.45) add("claim_fit_low", -15);

  if (!verdict.matches_claim) add("does_not_match_claim", -20);

  if (previousHardFails > 0) add("previous_hard_fails", -5 * previousHardFails);

  return { score: Math.round(clamp(score, 0, 100)), steps: [{ signal: "gemini_confidence", delta: base }, ...steps] };
}

export function bandFor(score: number): Band {
  if (score >= 75) return "corroborated";
  if (score >= 50) return "plausible";
  return "unverified";
}

const VISIBLE = ["smoke", "dust", "haze", "open_burning", "construction", "traffic", "none", "unclear"] as const;
const QUALITY = ["good", "blurry", "dark", "too_close", "obstructed"] as const;

/** Coerces a parsed model reply into the schema, or returns null if it is not an object. */
export function normalizeVerdict(raw: unknown): GeminiVerdict | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
  const num = (v: unknown) => clamp(typeof v === "number" && Number.isFinite(v) ? v : 0, 0, 1);
  const str = (v: unknown) => (typeof v === "string" ? v.slice(0, 400) : "");
  const oneOf = <T extends string>(v: unknown, list: readonly T[], fallback: T): T =>
    typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : fallback;
  return {
    visible: oneOf(r.visible, VISIBLE, "unclear"),
    matches_claim: bool(r.matches_claim, false),
    claim_fit: num(r.claim_fit),
    // Missing safety flags default to the cautious value.
    outdoor_scene: bool(r.outdoor_scene, false),
    looks_like_screenshot_or_stock: bool(r.looks_like_screenshot_or_stock, false),
    image_quality: oneOf(r.image_quality, QUALITY, "obstructed"),
    place_cues: Array.isArray(r.place_cues) ? r.place_cues.filter((c) => typeof c === "string").slice(0, 10) : [],
    place_cues_conflict_with_pin: bool(r.place_cues_conflict_with_pin, false),
    conflict_reason: str(r.conflict_reason),
    fire_or_smoke_visible: bool(r.fire_or_smoke_visible, false),
    ask_for_another: bool(r.ask_for_another, false),
    retry_reason: str(r.retry_reason),
    confidence: num(r.confidence),
    description: str(r.description).slice(0, 300),
    observations: Array.isArray(r.observations)
      ? r.observations.filter((o): o is string => typeof o === "string" && o.trim() !== "").map((o) => o.trim().slice(0, 140)).slice(0, 5)
      : [],
  };
}
