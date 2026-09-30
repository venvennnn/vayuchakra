import { EXIF_MAX_KM, type Claim, type GeminiVerdict, type ScoreStep } from "./confidence";

export type CheckKey =
  | "quality"
  | "outdoor"
  | "authentic"
  | "claim_match"
  | "smoke_visible"
  | "place"
  | "exif"
  | "satellite_fire";

export type CheckStatus = "pass" | "warn" | "fail" | "info";

export type Check = { key: CheckKey; status: CheckStatus; value?: string | number | null };

export type ChecksInput = {
  verdict: GeminiVerdict;
  claim: Claim;
  exifKm: number | null;
  /** Nearest FIRMS hotspot in km, or a bucket ("5", "15") when only the score steps are known. */
  nearestFireKm: number | null;
};

/** What was checked on a photo, in display order. Shared by the filer's result and the public feed. */
export function buildChecks({ verdict, claim, exifKm, nearestFireKm }: ChecksInput): Check[] {
  const fit = Math.round((Number(verdict.claim_fit) || 0) * 100);
  const checks: Check[] = [
    { key: "quality", status: verdict.image_quality === "good" ? "pass" : "fail", value: verdict.image_quality },
    { key: "outdoor", status: verdict.outdoor_scene ? "pass" : "fail" },
    { key: "authentic", status: verdict.looks_like_screenshot_or_stock ? "fail" : "pass" },
    {
      key: "claim_match",
      status: verdict.matches_claim && fit >= 45 ? "pass" : verdict.matches_claim ? "warn" : "fail",
      value: fit,
    },
  ];
  if (claim === "smoke" || verdict.fire_or_smoke_visible) {
    checks.push({ key: "smoke_visible", status: verdict.fire_or_smoke_visible ? "pass" : "warn" });
  }
  checks.push({
    key: "place",
    status: verdict.place_cues_conflict_with_pin ? "fail" : "pass",
    value: verdict.place_cues_conflict_with_pin ? verdict.conflict_reason || null : verdict.place_cues.slice(0, 3).join(", ") || null,
  });
  checks.push(
    exifKm === null
      ? { key: "exif", status: "info" }
      : { key: "exif", status: exifKm <= EXIF_MAX_KM ? "pass" : "fail", value: Math.round(exifKm * 10) / 10 },
  );
  if (claim === "smoke" || verdict.fire_or_smoke_visible) {
    checks.push(
      nearestFireKm !== null && nearestFireKm <= 15
        ? { key: "satellite_fire", status: "pass", value: Math.round(nearestFireKm * 10) / 10 }
        : { key: "satellite_fire", status: "info" },
    );
  }
  return checks;
}

/** Older attempts stored only score steps, not the fire distance; recover the band they fell in. */
export function fireKmFromSteps(steps: ScoreStep[] | null | undefined): number | null {
  if (!steps) return null;
  if (steps.some((s) => s.signal === "firms_within_5km")) return 5;
  if (steps.some((s) => s.signal === "firms_within_15km")) return 15;
  return null;
}
