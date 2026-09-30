import "server-only";
import { GoogleGenAI } from "@google/genai";
import { liveModelLabel, type Claim, type GeminiVerdict } from "./confidence";
import { markModelNotFound, markModelQuota, markModelWorking, modelCandidates } from "./geminiModel";

export type IncidentBrief = {
  happened: string;
  where: string;
  evidence: string[];
  exposed: string;
  action: string;
  uncertainty: string;
  model: string;
};

export type BriefInput = {
  lang: "en" | "hi";
  placeName: string | null;
  pin: { lat: number; lng: number };
  claim: Claim;
  verdict: GeminiVerdict;
  score: number;
  band: string;
  attempts: number;
  aqi: number | null;
  pm25: number | null;
  windKmh: number | null;
  windFrom: string | null;
  firesWithin15km: number;
  nearestFireKm: number | null;
};

const SYSTEM = `You write a short incident brief for municipal and CPCB officers in India for Project Vayuchakra.
Use only the evidence given. Never invent a fire, a sensor reading, a crowd size, or a place that was not supplied.
No people's identities, faces, number plates or house numbers.
The evidence score was calculated by the application, not by you.
Reply only with the JSON object.`;

function normalize(raw: unknown, model: string): IncidentBrief | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
  const happened = str(r.happened, 280);
  const where = str(r.where, 160);
  const action = str(r.action, 200);
  if (!happened || !where || !action) return null;
  const evidence = (Array.isArray(r.evidence) ? r.evidence : [])
    .filter((x): x is string => typeof x === "string" && x.trim() !== "")
    .map((x) => x.trim().slice(0, 180))
    .slice(0, 5);
  return {
    happened,
    where,
    evidence,
    exposed: str(r.exposed, 200),
    action,
    uncertainty: str(r.uncertainty, 220),
    model: liveModelLabel(model),
  };
}

/** Second Gemini call after a photo is accepted: an officer-facing summary, text only. */
export async function writeIncidentBrief(input: BriefInput): Promise<IncidentBrief | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  const lang = input.lang === "hi" ? "Hindi" : "English";
  const evidence = {
    place: input.placeName,
    coordinates: input.pin,
    claimed: input.claim,
    visible_event: input.verdict.visible,
    fire_visible: input.verdict.fire_visible,
    smoke_visible: input.verdict.smoke_visible,
    description: input.verdict.description,
    observations: input.verdict.observations,
    contradictions: input.verdict.contradictions,
    evidence_score: input.score,
    band: input.band,
    photo_attempts: input.attempts,
    nearby_hourly_pm25_india_aqi_scale: input.aqi,
    nearby_pm25_ugm3: input.pm25,
    wind_kmh: input.windKmh,
    wind_from: input.windFrom,
    satellite_fires_within_15km: input.firesWithin15km,
    nearest_satellite_fire_km: input.nearestFireKm,
  };
  const prompt =
    `Evidence:\n${JSON.stringify(evidence, null, 2)}\n\n` +
    `Return JSON: {"happened":"one or two sentences","where":"place and area","evidence":["short bullet","…"],"exposed":"who or which neighbouring areas, or unknown","action":"one recommended local action and a time window","uncertainty":"what is missing"}.\n` +
    `Write every string in ${lang}.`;

  const ai = new GoogleGenAI({ apiKey });
  for await (const model of modelCandidates(apiKey)) {
    try {
      const res = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          systemInstruction: SYSTEM,
          temperature: 0.2,
          responseMimeType: "application/json",
          httpOptions: { timeout: 20_000 },
        },
      });
      const parsed = normalize(JSON.parse(res.text ?? ""), model);
      if (parsed) {
        markModelWorking(model);
        return parsed;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/NOT_FOUND|404/.test(msg)) {
        markModelNotFound(model);
        continue;
      }
      if (/RESOURCE_EXHAUSTED|429/.test(msg)) {
        markModelQuota(model, msg);
        return null;
      }
      console.error(`[brief] Gemini failed: ${msg.slice(0, 300)}`);
      return null;
    }
  }
  return null;
}
