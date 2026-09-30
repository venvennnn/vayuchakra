import { test } from "node:test";
import assert from "node:assert/strict";
import { pm25SubIndex, categoryFromIndex } from "../lib/aqi.ts";
import { bandFor, computeConfidence, hardFailReason, normalizeVerdict, type GeminiVerdict } from "../lib/confidence.ts";

const base: GeminiVerdict = {
  visible: "haze",
  matches_claim: true,
  claim_fit: 0.8,
  outdoor_scene: true,
  looks_like_screenshot_or_stock: false,
  image_quality: "good",
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

test("worked example 1: traffic haze at Connaught Place → 95 corroborated", () => {
  const { score } = computeConfidence({ verdict: base, claim: "traffic", exifDistanceKm: 0.18, nearestFireKm: null, previousHardFails: 0 });
  assert.equal(score, 95);
  assert.equal(bandFor(score), "corroborated");
});

test("worked example 2: smoke claim, no EXIF, no FIRMS → 50 plausible", () => {
  const verdict = { ...base, visible: "smoke" as const, claim_fit: 0.5, confidence: 0.6 };
  const { score } = computeConfidence({ verdict, claim: "smoke", exifDistanceKm: null, nearestFireKm: null, previousHardFails: 0 });
  assert.equal(score, 50);
  assert.equal(bandFor(score), "plausible");
});

test("FIRMS bonuses and penalties", () => {
  const v = { ...base, claim_fit: 0.6, confidence: 0.5 };
  assert.equal(computeConfidence({ verdict: v, claim: "smoke", exifDistanceKm: null, nearestFireKm: 3, previousHardFails: 0 }).score, 62);
  assert.equal(computeConfidence({ verdict: v, claim: "smoke", exifDistanceKm: null, nearestFireKm: 12, previousHardFails: 0 }).score, 56);
  assert.equal(computeConfidence({ verdict: v, claim: "dust", exifDistanceKm: null, nearestFireKm: 3, previousHardFails: 0 }).score, 50);
  assert.equal(computeConfidence({ verdict: v, claim: "smoke", exifDistanceKm: 1.5, nearestFireKm: null, previousHardFails: 2 }).score, 38);
  assert.equal(computeConfidence({ verdict: { ...v, matches_claim: false, claim_fit: 0.2 }, claim: "dust", exifDistanceKm: null, nearestFireKm: null, previousHardFails: 0 }).score, 15);
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

test("normalizeVerdict is cautious with missing fields", () => {
  assert.equal(normalizeVerdict("nope"), null);
  const v = normalizeVerdict({ confidence: 4 })!;
  assert.equal(v.confidence, 1);
  assert.equal(v.outdoor_scene, false);
  assert.equal(v.image_quality, "obstructed");
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
