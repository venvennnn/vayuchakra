import { test } from "node:test";
import assert from "node:assert/strict";
import { pm25SubIndex, categoryFromIndex } from "../lib/aqi.ts";
import { bandFor, combineAttempts, computeConfidence, hardFailReason, liveModelLabel, normalizeVerdict, SCORE_RETRY_BELOW, type GeminiVerdict } from "../lib/confidence.ts";

const base: GeminiVerdict = {
  visible: "haze",
  matches_claim: true,
  claim_fit: 0.8,
  outdoor_scene: true,
  looks_like_screenshot_or_stock: false,
  image_quality: "good",
  image_quality_score: 0.9,
  location_consistency: 0,
  event_consistency: 0,
  contradictions: [],
  fire_visible: false,
  smoke_visible: false,
  place_cues: [],
  place_cues_conflict_with_pin: false,
  conflict_reason: "",
  fire_or_smoke_visible: false,
  ask_for_another: false,
  retry_reason: "",
  confidence: 0.72,
};

test("CPCB sub-index breakpoints", () => {
  assert.equal(pm25SubIndex(0), 0);
  assert.equal(pm25SubIndex(30), 50);
  assert.equal(pm25SubIndex(31), 51);
  assert.equal(pm25SubIndex(60), 100);
  assert.equal(pm25SubIndex(90), 200);
  assert.equal(pm25SubIndex(120), 300);
  assert.equal(pm25SubIndex(250), 400);
  assert.equal(pm25SubIndex(380), 500);
  assert.equal(pm25SubIndex(900), 500);
  assert.equal(pm25SubIndex(186), 351);
  assert.equal(categoryFromIndex(351), "very_poor");
  assert.equal(categoryFromIndex(50), "good");
  assert.equal(categoryFromIndex(401), "severe");
});

test("evidence score is 30/25/20/15/10 and is never Gemini's own confidence", () => {
  // quality 0.9×30=27, event 0.8×25=20, location EXIF 0.18km →1.0×20=20, sensor 0.35×15=5.25, report 0.92×10=9.2 → 81
  const a = computeConfidence({ verdict: base, claim: "traffic", exifDistanceKm: 0.18, nearestFireKm: null, previousHardFails: 0 });
  assert.equal(a.score, 81);
  assert.equal(bandFor(a.score), "corroborated");
  assert.ok(a.score !== Math.round(base.confidence * 100));

  const smoke = { ...base, visible: "smoke" as const, claim_fit: 0.5, fire_or_smoke_visible: false };
  // 27 + 12.5 + 10 + 1.5 + 8 = 59
  const b = computeConfidence({ verdict: smoke, claim: "smoke", exifDistanceKm: null, nearestFireKm: null, previousHardFails: 0 });
  assert.equal(b.score, 59);
  assert.equal(b.score < SCORE_RETRY_BELOW, true);
  assert.equal(bandFor(b.score), "plausible");
});

test("FIRMS lifts the sensor slice; contradictions and previous fails cut the report slice", () => {
  const v = { ...base, claim_fit: 0.6, confidence: 0.5, fire_or_smoke_visible: false };
  assert.equal(computeConfidence({ verdict: v, claim: "smoke", exifDistanceKm: null, nearestFireKm: 3, previousHardFails: 0 }).score, 75);
  assert.equal(computeConfidence({ verdict: v, claim: "smoke", exifDistanceKm: null, nearestFireKm: 12, previousHardFails: 0 }).score, 71);
  assert.equal(computeConfidence({ verdict: v, claim: "dust", exifDistanceKm: null, nearestFireKm: 3, previousHardFails: 0 }).score, 66);
  assert.equal(computeConfidence({ verdict: v, claim: "smoke", exifDistanceKm: 1.5, nearestFireKm: null, previousHardFails: 2 }).score, 65);
  assert.equal(computeConfidence({ verdict: { ...v, matches_claim: false, claim_fit: 0.2 }, claim: "dust", exifDistanceKm: null, nearestFireKm: null, previousHardFails: 0 }).score, 47);
});

test("multi-image combine is best + agreement bonus − contradiction penalty", () => {
  const r = combineAttempts([
    { score: 62, visible: "open_burning", contradictions: ["no landmark"] },
    { score: 71, visible: "open_burning", contradictions: ["no landmark"] },
  ]);
  assert.equal(r.best, 71);
  assert.equal(r.bonus, 6);
  assert.equal(r.penalty, 5);
  assert.equal(r.score, 72);
});

test("hard fails", () => {
  assert.equal(hardFailReason(null, null), "gemini_failed");
  assert.equal(hardFailReason({ ...base, looks_like_screenshot_or_stock: true }, null), "stock");
  assert.equal(hardFailReason({ ...base, outdoor_scene: false }, null), "indoor");
  assert.equal(hardFailReason({ ...base, image_quality: "blurry" }, null), "quality");
  assert.equal(hardFailReason({ ...base, place_cues_conflict_with_pin: true }, null), "place_conflict");
  assert.equal(hardFailReason(base, 2.01), "exif_far");
  assert.equal(hardFailReason(base, 2.0), null);
  assert.equal(hardFailReason(base, null), null);
});

test("normalizeVerdict is cautious with missing fields and accepts the demo JSON shape", () => {
  assert.equal(normalizeVerdict("nope"), null);
  const v = normalizeVerdict({ confidence: 4 })!;
  assert.equal(v.confidence, 1);
  assert.equal(v.outdoor_scene, false);
  assert.equal(v.image_quality, "obstructed");
  const demo = normalizeVerdict({
    visible_event: "open_waste_burning",
    fire_visible: true,
    smoke_visible: true,
    image_quality: 0.91,
    location_consistency: 0.78,
    event_consistency: 0.86,
    contradictions: [],
    request_another_image: false,
    reason: "Visible smoke plume agrees with nearby fire and wind signals.",
    outdoor_scene: true,
    matches_claim: true,
  })!;
  assert.equal(demo.visible, "open_burning");
  assert.equal(demo.image_quality, "good");
  assert.equal(demo.image_quality_score, 0.91);
  assert.equal(demo.fire_or_smoke_visible, true);
  assert.equal(demo.retry_reason.startsWith("Visible smoke"), true);
  assert.equal(liveModelLabel("gemini-2.5-flash"), "Gemini 2.5 Flash");
});

test("Gemini model names: env mistakes are cleaned and discovered Flash models are ranked", async () => {
  const { cleanModelName, rankFlashModels } = await import("../lib/geminiModelNames.ts");
  assert.equal(cleanModelName(' "models/gemini-2.5-flash" '), "gemini-2.5-flash");
  assert.equal(cleanModelName(undefined), "");
  const gen = ["generateContent"];
  const ranked = rankFlashModels([
    { name: "models/gemini-2.0-flash", supportedGenerationMethods: gen },
    { name: "models/gemini-3-flash-preview", supportedGenerationMethods: gen },
    { name: "models/gemini-3-flash", supportedGenerationMethods: gen },
    { name: "models/gemini-3-flash-lite", supportedGenerationMethods: gen },
    { name: "models/gemini-3-flash-image", supportedGenerationMethods: gen },
    { name: "models/gemini-3-pro", supportedGenerationMethods: gen },
    { name: "models/gemini-2.5-flash", supportedGenerationMethods: ["embedContent"] },
  ]);
  assert.deepEqual(ranked, ["gemini-3-flash", "gemini-2.0-flash", "gemini-3-flash-lite", "gemini-3-flash-preview"]);
});

test("Gemini quota cooldown follows Google's retry delay, and an hour for daily or zero limits", async () => {
  const { quotaCooldownMs } = await import("../lib/geminiModelNames.ts");
  assert.equal(quotaCooldownMs('{"retryDelay":"37s"}'), 37_000);
  assert.equal(quotaCooldownMs("Please retry in 3.2s."), 15_000);
  assert.equal(quotaCooldownMs("quotaId: GenerateRequestsPerDayPerProjectPerModel-FreeTier"), 3_600_000);
  assert.equal(quotaCooldownMs("limit: 0, model: gemini-2.5-flash"), 3_600_000);
  assert.equal(quotaCooldownMs("RESOURCE_EXHAUSTED"), 60_000);
});
