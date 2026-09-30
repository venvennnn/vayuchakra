import "server-only";
import { GoogleGenAI } from "@google/genai";
import { ApiError } from "@google/genai";
import { cached } from "./cache";
import { markModelNotFound, markModelQuota, markModelWorking, modelCandidates, quotaPressure } from "./geminiModel";
import type { Lang } from "./copy";
import type { Article } from "./news";

const TTL_MS = 3 * 3600 * 1000;
// Failures are not cached by `cached`, so without this every map click would call Gemini again.
const FAILURE_BACKOFF_MS = 20 * 60 * 1000;
const failedAt = new Map<string, number>();

export type CauseKey =
  | "crop_burning"
  | "other_fires"
  | "traffic"
  | "construction_dust"
  | "industry"
  | "firecrackers"
  | "weather"
  | "other";

export type Insight = {
  summary: string;
  causes: { key: CauseKey; label: string; evidence: string; articles: number[] }[];
  confidence: "low" | "medium" | "high";
  /** Always English, simple, as if talking to an eight-year-old. */
  forAKid: string;
  model: string;
  generatedAt: string;
};

export type InsightInput = {
  area: string;
  lang: Lang;
  aqi: number;
  category: string;
  pm25: number;
  source: string;
  trend: { at: string; pm25: number }[];
  windKmh: number | null;
  windFrom: string | null;
  temperatureC: number | null;
  firesWithin50km: number;
  firesUpwind: number;
  articles: Article[];
};

const SYSTEM = `You explain the likely drivers of today's air quality for Project Vayuchakra in India.
Use only the evidence given: the reading, the 24 h trend, wind, satellite fire counts, and the numbered news headlines.
Never invent numbers, places, or events. If the evidence is thin, say so and set confidence to "low".
Upwind satellite fires with wind blowing toward the area support crop or open burning. Low wind speed supports stagnant air trapping local pollution.
Cite headlines only by their number.
Also write for_a_kid: 4 to 6 short sentences in simple English, as if talking to an eight-year-old about this place right now. No jargon (say "tiny bits of dirt in the air" not PM2.5). No scary words. Say whether it is a better day to play outside or to stay in, using only the category you were given. Do not invent fires or news. Reply only with the JSON object.`;

const CAUSES: CauseKey[] = ["crop_burning", "other_fires", "traffic", "construction_dust", "industry", "firecrackers", "weather", "other"];

function normalize(raw: unknown, articleCount: number): Omit<Insight, "model" | "generatedAt"> | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const summary = typeof r.summary === "string" ? r.summary.trim().slice(0, 400) : "";
  if (!summary) return null;
  const causes = (Array.isArray(r.causes) ? r.causes : [])
    .map((c) => {
      const o = (c ?? {}) as Record<string, unknown>;
      const key = CAUSES.includes(o.key as CauseKey) ? (o.key as CauseKey) : "other";
      const label = typeof o.label === "string" ? o.label.slice(0, 40) : "";
      const evidence = typeof o.evidence === "string" ? o.evidence.slice(0, 200) : "";
      const articles = (Array.isArray(o.articles) ? o.articles : [])
        .map(Number)
        .filter((n) => Number.isInteger(n) && n >= 1 && n <= articleCount)
        .slice(0, 3);
      return label ? { key, label, evidence, articles } : null;
    })
    .filter((c): c is Insight["causes"][number] => c !== null)
    .slice(0, 4);
  const confidence = ["low", "medium", "high"].includes(r.confidence as string) ? (r.confidence as Insight["confidence"]) : "low";
  const forAKid = typeof r.for_a_kid === "string" ? r.for_a_kid.trim().slice(0, 700) : "";
  return { summary, causes, confidence, forAKid };
}

async function generate(input: InsightInput): Promise<Insight | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  const ai = new GoogleGenAI({ apiKey });
  const headlines = input.articles.slice(0, 8).map((a, i) => `${i + 1}. ${a.title}${a.source ? ` (${a.source}` : ""}${a.publishedAt ? `, ${a.publishedAt.slice(0, 10)})` : a.source ? ")" : ""}`);
  const evidence = {
    area: input.area,
    reading: { hourly_pm25_ugm3: input.pm25, india_aqi_scale: input.aqi, category: input.category, source: input.source },
    next_24h_pm25: input.trend.map((h) => ({ at: h.at, pm25: h.pm25 })),
    wind: { from: input.windFrom, speed_kmh: input.windKmh },
    temperature_c: input.temperatureC,
    satellite_fires_last_48h: { within_50_km: input.firesWithin50km, upwind_within_400_km: input.firesUpwind },
  };
  const prompt =
    `Evidence:\n${JSON.stringify(evidence, null, 2)}\n\nNews headlines from the last 7 days:\n${headlines.length ? headlines.join("\n") : "(none)"}\n\n` +
    `Return JSON: {"summary": "two short sentences", "causes": [{"key": "${CAUSES.join(" | ")}", "label": "2-4 words", "evidence": "one short sentence", "articles": [1]}], "confidence": "low | medium | high", "for_a_kid": "4-6 short sentences in simple English for an eight-year-old"}.\n` +
    `Give at most 3 causes, most likely first. Write summary, label and evidence in ${input.lang === "hi" ? "Hindi" : "English"}. Write for_a_kid in English even if the rest is Hindi.`;

  // Only 404s move on; after a quota error the summary waits so photo checks keep what is left.
  for await (const model of modelCandidates(apiKey)) {
    const r = await callModel(ai, model, input, prompt, headlines.length);
    if (r === "not_found") {
      markModelNotFound(model);
      continue;
    }
    if (r && typeof r === "object" && "quota" in r) {
      markModelQuota(model, r.quota);
      return null;
    }
    if (r) markModelWorking(model);
    return r;
  }
  return null;
}

async function callModel(
  ai: GoogleGenAI,
  model: string,
  input: InsightInput,
  prompt: string,
  articleCount: number,
): Promise<Insight | null | "not_found" | { quota: string }> {
  for (let i = 0; i < 2; i++) {
    try {
      const res = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          systemInstruction: SYSTEM,
          temperature: 0.3,
          responseMimeType: "application/json",
          httpOptions: { timeout: 20_000 },
        },
      });
      const parsed = normalize(JSON.parse(res.text ?? ""), articleCount);
      if (parsed) return { ...parsed, model, generatedAt: new Date().toISOString() };
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return "not_found";
      const msg = e instanceof Error ? e.message : String(e);
      if ((e instanceof ApiError && e.status === 429) || /RESOURCE_EXHAUSTED/.test(msg)) return { quota: msg.slice(0, 500) };
      console.error(`[insight] Gemini failed for ${input.area}: ${e instanceof Error ? e.message.slice(0, 300) : e}`);
    }
  }
  return null;
}

export async function getInsight(input: InsightInput): Promise<Insight | null> {
  const bucket = Math.floor(Date.now() / TTL_MS);
  const key = `insight:v2:${input.area.toLowerCase()}:${input.lang}:${bucket}`;
  const skip = quotaPressure() || Date.now() - (failedAt.get(key) ?? 0) < FAILURE_BACKOFF_MS;
  const result = await cached(key, "insight", TTL_MS, () => (skip ? Promise.resolve(null) : generate(input)));
  if (!result && !skip) failedAt.set(key, Date.now());
  return result;
}
