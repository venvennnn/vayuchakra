import "server-only";
import { GoogleGenAI } from "@google/genai";
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
};

export type GeminiResult =
  | { ok: true; verdict: GeminiVerdict; raw: unknown; model: string }
  | { ok: false; error: string; model: string };

export async function checkPhoto(input: GeminiInput): Promise<GeminiResult> {
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { ok: false, error: "gemini_not_configured", model };
  const ai = new GoogleGenAI({ apiKey });

  const context = {
    claimed_type: CLAIM_TEXT[input.claim],
    note: input.note || null,
    pin: { latitude: input.pin.lat, longitude: input.pin.lng, place_name: input.pin.placeName },
    exif_gps: input.exif ? { latitude: input.exif.lat, longitude: input.exif.lng } : null,
    exif_time: input.exifTakenAt,
    nearby_fires: input.fires,
  };
  const prompt =
    `Judge this photo. The note may be in Hindi or English.\n` +
    `Context:\n${JSON.stringify(context, null, 2)}\n\n` +
    `Return one JSON object with exactly these keys:\n${SCHEMA_HINT}\n` +
    `claim_fit and confidence are numbers from 0 to 1. confidence is how sure you are that this is a real outdoor photo of the claimed condition.\n` +
    `If you fill retry_reason, write one short sentence in ${input.replyLanguage === "hi" ? "Hindi" : "English"} telling the person what to retake.`;

  let lastError = "unknown";
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
        config: { systemInstruction: SYSTEM_INSTRUCTION, temperature: 0.2, responseMimeType: "application/json" },
      });
      const text = res.text ?? "";
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        lastError = "invalid_json";
        continue;
      }
      const verdict = normalizeVerdict(parsed);
      if (!verdict) {
        lastError = "invalid_shape";
        continue;
      }
      return { ok: true, verdict, raw: parsed, model };
    } catch (e) {
      lastError = e instanceof Error ? e.message.slice(0, 300) : "call_failed";
    }
  }
  return { ok: false, error: lastError, model };
}
