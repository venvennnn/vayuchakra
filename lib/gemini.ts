import "server-only";
import { ApiError, GoogleGenAI } from "@google/genai";
import { normalizeVerdict, type Claim, type GeminiVerdict } from "./confidence";

const SYSTEM_INSTRUCTION = `You check a citizen air-quality photo for Project Vayuchakra in India.
You do not decide the AQI. You only judge the photograph.
The pin is the location the person selected. EXIF may be missing; absence is not fraud.
Signs, scripts, vehicles, and vegetation can suggest a region. A conflict means the photo clearly depicts a different city or country, not merely a generic road.
Stock photos, screenshots, memes, and indoor photos are conflicts.
If the frame is blurry, dark, or too close to tell, set image_quality accordingly, set ask_for_another true, and do not invent smoke.
Reply only with the JSON object.`;

const SCHEMA_HINT = `{
  "visible": "smoke | dust | haze | open_burning | construction | traffic | none | unclear",
  "matches_claim": true,
  "claim_fit": 0.0,
  "outdoor_scene": true,
  "looks_like_screenshot_or_stock": false,
  "image_quality": "good | blurry | dark | too_close | obstructed",
  "place_cues": ["Devanagari shop sign", "yellow-black auto"],
  "place_cues_conflict_with_pin": false,
  "conflict_reason": "",
  "fire_or_smoke_visible": false,
  "ask_for_another": false,
  "retry_reason": "",
  "confidence": 0.0
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
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { ok: false, error: "not_configured", detail: "GEMINI_API_KEY is not set", model };
  const ai = new GoogleGenAI({ apiKey });

  const context = {
    claimed_type: CLAIM_TEXT[input.claim],
    note: input.note || null,
    pin: { latitude: input.pin.lat, longitude: input.pin.lng, place_name: input.pin.placeName },
    exif_gps: input.exif ? { latitude: input.exif.lat, longitude: input.exif.lng } : null,
    exif_time: input.exifTakenAt,
    nearby_fires: input.fires,
    recent_local_news_headlines: input.news,
  };
  const prompt =
    `Judge this photo. The note may be in Hindi or English.\n` +
    `News headlines are background only: judge what the photo itself shows, never what the news says.\n` +
    `Context:\n${JSON.stringify(context, null, 2)}\n\n` +
    `Return one JSON object with exactly these keys:\n${SCHEMA_HINT}\n` +
    `claim_fit and confidence are numbers from 0 to 1. confidence is how sure you are that this is a real outdoor photo of the claimed condition.\n` +
    `If you fill retry_reason, write one short sentence in ${input.replyLanguage === "hi" ? "Hindi" : "English"} telling the person what to retake.`;

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
