import "server-only";
import { ApiError, GoogleGenAI } from "@google/genai";
import { normalizeVerdict, type Claim, type GeminiVerdict } from "./confidence";
import { configuredModels, markModelNotFound, markModelQuota, markModelWorking, modelCandidates } from "./geminiModel";

const SYSTEM_INSTRUCTION = `You check a citizen air-quality photo for Project Vayuchakra in India.
You do not decide the AQI and you do not invent a confidence score for publication. You only judge the photograph and how it sits with the sensors you are given.
The pin is the location the person selected. EXIF may be missing; absence is not fraud.
Signs, scripts, vehicles, and vegetation can suggest a region. A conflict means the photo clearly depicts a different city or country, not merely a generic road.
Stock photos, screenshots, memes, and indoor photos are conflicts.
Nearby AQI, wind and satellite fires are corroboration only: never report a fire or a pollutant that the photo does not itself show.
If the frame is blurry, dark, or too close to tell, set image_quality to that enum, set request_another_image true, and write a precise retry instruction.
Reply only with the JSON object.`;

const SCHEMA_HINT = `{
  "visible_event": "smoke | dust | haze | open_burning | open_waste_burning | construction | traffic | none | unclear",
  "fire_visible": false,
  "smoke_visible": false,
  "image_quality": "good | blurry | dark | too_close | obstructed",
  "image_quality_score": 0.0,
  "location_consistency": 0.0,
  "event_consistency": 0.0,
  "contradictions": [],
  "request_another_image": false,
  "reason": "Visible smoke plume agrees with a nearby satellite fire and the wind.",
  "matches_claim": true,
  "claim_fit": 0.0,
  "outdoor_scene": true,
  "looks_like_screenshot_or_stock": false,
  "place_cues": ["Devanagari shop sign"],
  "place_cues_conflict_with_pin": false,
  "conflict_reason": "",
  "description": "Dark grey smoke rising from a roof behind a row of houses; flames visible at the top floor.",
  "observations": ["Image is sharp and well lit", "Smoke is dense and dark, typical of an active fire"]
}`;

const CLAIM_TEXT: Record<Claim, string> = {
  smoke: "Smoke or burning",
  dust: "Dust",
  traffic: "Traffic haze",
  construction: "Construction",
  unsure: "Not sure",
};

export type GeminiInput = {
  image: Buffer;
  mimeType: string;
  claim: Claim;
  note: string | null;
  pin: { lat: number; lng: number; placeName: string | null };
  exif: { lat: number; lng: number } | null;
  exifTakenAt: string | null;
  /** Language for retry_reason, which is shown to the filer. */
  replyLanguage: "en" | "hi";
  fires: { distance_km: number; frp: number | null; confidence: string; acquired_at: string }[];
  /** Recent local pollution headlines. Background only; they never change the score rules. */
  news: string[];
  air: { pm25: number; aqi: number; source: string; observedAt: string } | null;
  weather: { windKmh: number; windFrom: string | null; temperatureC: number | null } | null;
};

/** Why the checker could not run. Shown to the filer as a code and stored on the attempt. */
export type CheckerError =
  | "not_configured"
  | "bad_key"
  | "quota"
  | "model_not_found"
  | "bad_request"
  | "timeout"
  | "unavailable"
  | "bad_response"
  | "unknown";

export type GeminiResult =
  | { ok: true; verdict: GeminiVerdict; raw: unknown; model: string }
  | { ok: false; error: CheckerError; detail: string; model: string };

const CALL_TIMEOUT_MS = 25_000;
// Worth a second call; the rest will fail the same way again.
const RETRYABLE: CheckerError[] = ["timeout", "unavailable", "bad_response", "unknown"];

export function classifyGeminiError(e: unknown): CheckerError {
  const msg = e instanceof Error ? e.message : String(e);
  const name = e instanceof Error ? e.name : "";
  const status = e instanceof ApiError ? e.status : undefined;
  if (/API_KEY_INVALID|API key not valid|API_KEY_SERVICE_BLOCKED|PERMISSION_DENIED/i.test(msg)) return "bad_key";
  if (status === 401 || status === 403) return "bad_key";
  if (status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(msg)) return "quota";
  if (status === 404) return "model_not_found";
  if (status !== undefined && status >= 500) return "unavailable";
  if (status === 400) return "bad_request";
  if (name === "AbortError" || name === "TimeoutError" || /timed? ?out|aborted/i.test(msg)) return "timeout";
  if (/fetch failed|ECONNRESET|ENOTFOUND|network/i.test(msg)) return "unavailable";
  return "unknown";
}

export async function checkPhoto(input: GeminiInput): Promise<GeminiResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { ok: false, error: "not_configured", detail: "GEMINI_API_KEY is not set", model: configuredModels()[0] };
  const ai = new GoogleGenAI({ apiKey });

  const lang = input.replyLanguage === "hi" ? "Hindi" : "English";
  const context = {
    claimed_type: CLAIM_TEXT[input.claim],
    note: input.note || null,
    pin: { latitude: input.pin.lat, longitude: input.pin.lng, place_name: input.pin.placeName },
    capture_timestamp: input.exifTakenAt,
    exif_gps: input.exif ? { latitude: input.exif.lat, longitude: input.exif.lng } : null,
    nearby_aqi: input.air,
    wind: input.weather,
    nearby_fires: input.fires,
    recent_local_news_headlines: input.news,
  };
  const prompt =
    `Judge this photo. The note may be in Hindi or English.\n` +
    `The published evidence score is calculated by our application from your fields plus EXIF, AQI and FIRMS. Do not invent that score.\n` +
    `News headlines are background only: judge what the photo itself shows, never what the news says.\n` +
    `Context:\n${JSON.stringify(context, null, 2)}\n\n` +
    `Return one JSON object with these keys:\n${SCHEMA_HINT}\n` +
    `image_quality_score, location_consistency, event_consistency and claim_fit are numbers from 0 to 1.\n` +
    `contradictions: short phrases for anything that does not line up (wrong place, indoor, stock, no smoke when smoke was claimed).\n` +
    `If request_another_image is true, reason must be one precise instruction in ${lang}, for example: "Move closer without entering the hazardous area.", "Capture the smoke source and a surrounding landmark.", "The image is too dark; take another photograph."\n` +
    `description: one or two plain sentences on what the photo shows, as a neutral observer. No people's identities, faces, number plates or house numbers.\n` +
    `observations: 2 to 4 short phrases on what you checked and saw.\n` +
    `Write description, observations, reason and contradictions in ${lang}.`;

  let error: CheckerError = "quota";
  let detail = "every model is cooling down after a quota error";
  let model = configuredModels()[0];
  const skipped: string[] = [];
  // A 404 or a quota error moves on to the next model name; anything else is final for this photo.
  for await (const candidate of modelCandidates(apiKey)) {
    model = candidate;
    const r = await callModel(ai, model, input, prompt);
    if (r.ok) {
      markModelWorking(model);
      return r;
    }
    if (r.error === "model_not_found") markModelNotFound(model);
    else if (r.error === "quota") markModelQuota(model, r.detail);
    else return r;
    skipped.push(`${model} ${r.error}`);
    error = r.error;
    detail = r.detail;
  }
  if (skipped.length) detail = `no usable model (${skipped.join(", ")}): ${detail}`.slice(0, 500);
  return { ok: false, error, detail, model };
}

async function callModel(ai: GoogleGenAI, model: string, input: GeminiInput, prompt: string): Promise<GeminiResult> {
  let error: CheckerError = "unknown";
  let detail = "";
  // One call plus one retry, whether the call errors or returns unparseable JSON.
  for (let i = 0; i < 2; i++) {
    try {
      const res = await ai.models.generateContent({
        model,
        contents: [
          {
            role: "user",
            parts: [{ inlineData: { mimeType: input.mimeType, data: input.image.toString("base64") } }, { text: prompt }],
          },
        ],
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          temperature: 0.2,
          responseMimeType: "application/json",
          httpOptions: { timeout: CALL_TIMEOUT_MS },
        },
      });
      const text = res.text ?? "";
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        error = "bad_response";
        detail = `invalid JSON: ${text.slice(0, 200)}`;
        continue;
      }
      const verdict = normalizeVerdict(parsed);
      if (!verdict) {
        error = "bad_response";
        detail = `unexpected shape: ${text.slice(0, 200)}`;
        continue;
      }
      return { ok: true, verdict, raw: parsed, model };
    } catch (e) {
      error = classifyGeminiError(e);
      detail = (e instanceof Error ? e.message : String(e)).slice(0, 500);
      if (!RETRYABLE.includes(error)) break;
    }
  }
  return { ok: false, error, detail, model };
}
