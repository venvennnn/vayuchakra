import "server-only";
import { cached } from "./cache";
import { haversineKm, type LatLng } from "./geo";

// SerpApi's free plan is 100 searches a month: NCR shares one query for 8 h, other places keep results for a day.
const NCR_TTL_MS = 8 * 3600 * 1000;
const TTL_MS = 24 * 3600 * 1000;
const ERROR_BACKOFF_MS = 10 * 60 * 1000;
const HUB_MAX_KM = 250;
const NCR = ["delhi", "new delhi", "gurugram", "gurgaon", "noida", "greater noida", "ghaziabad", "faridabad"];

export type Article = {
  title: string;
  link: string;
  source: string | null;
  sourceIcon: string | null;
  publishedAt: string | null;
  thumbnail: string | null;
};

export type News = { area: string; query: string; articles: Article[]; fetchedAt: string };

/** "Hanuman Road Area, New Delhi" → "Delhi NCR"; "Civil Lines, Lucknow" → "Lucknow". */
export function newsArea(placeName: string | null): string {
  const city = placeName?.split(",").pop()?.trim() ?? "";
  if (!city || NCR.includes(city.toLowerCase())) return "Delhi NCR";
  return city;
}

// Cities with regular air-quality coverage, used when a small place has no news of its own.
const HUBS: (LatLng & { name: string })[] = [
  { name: "Delhi NCR", lat: 28.61, lng: 77.23 },
  { name: "Agra", lat: 27.18, lng: 78.01 },
  { name: "Mathura", lat: 27.49, lng: 77.67 },
  { name: "Aligarh", lat: 27.88, lng: 78.08 },
  { name: "Meerut", lat: 28.98, lng: 77.71 },
  { name: "Moradabad", lat: 28.84, lng: 78.77 },
  { name: "Bareilly", lat: 28.37, lng: 79.43 },
  { name: "Jaipur", lat: 26.91, lng: 75.79 },
  { name: "Alwar", lat: 27.55, lng: 76.63 },
  { name: "Gwalior", lat: 26.22, lng: 78.18 },
  { name: "Panipat", lat: 29.39, lng: 76.97 },
  { name: "Karnal", lat: 29.69, lng: 76.99 },
  { name: "Rohtak", lat: 28.9, lng: 76.61 },
  { name: "Hisar", lat: 29.15, lng: 75.72 },
  { name: "Chandigarh", lat: 30.73, lng: 76.78 },
  { name: "Patiala", lat: 30.34, lng: 76.39 },
  { name: "Ludhiana", lat: 30.9, lng: 75.86 },
  { name: "Jalandhar", lat: 31.33, lng: 75.58 },
  { name: "Amritsar", lat: 31.63, lng: 74.87 },
  { name: "Bathinda", lat: 30.21, lng: 74.95 },
  { name: "Dehradun", lat: 30.32, lng: 78.03 },
  { name: "Lucknow", lat: 26.85, lng: 80.95 },
  { name: "Kanpur", lat: 26.45, lng: 80.33 },
];

export function nearestNewsHub(p: LatLng): string | null {
  let best: { name: string; km: number } | null = null;
  for (const h of HUBS) {
    const km = haversineKm(p, h);
    if (km <= HUB_MAX_KM && (!best || km < best.km)) best = { name: h.name, km };
  }
  return best?.name ?? null;
}

export type NewsError = "not_configured" | "bad_key" | "out_of_searches" | "failed";
export type NewsResult = { ok: true; news: News } | { ok: false; error: NewsError; detail: string };

class SerpError extends Error {
  code: NewsError;
  constructor(code: NewsError, message: string) {
    super(message);
    this.code = code;
  }
}

/** SerpApi reports "no results" as an error; that is an empty list, not a failure. */
export function classifySerpError(message: string, status: number): NewsError | "empty" {
  if (/hasn.t returned any results|no results/i.test(message)) return "empty";
  if (status === 401 || /invalid api key|api key/i.test(message)) return "bad_key";
  if (status === 429 || /run out of searches|searches per|plan|limit/i.test(message)) return "out_of_searches";
  return "failed";
}

type SerpItem = {
  title?: string;
  link?: string;
  date?: string;
  iso_date?: string;
  thumbnail?: string;
  source?: { name?: string; icon?: string } | string;
  stories?: SerpItem[];
  highlight?: SerpItem;
};

/** SerpApi Google News dates look like "09/30/2026, 07:00 AM, +0000 UTC". */
function parseDate(item: SerpItem): string | null {
  if (item.iso_date) {
    const d = new Date(item.iso_date);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  const m = item.date?.match(/(\d{2})\/(\d{2})\/(\d{4}),\s*(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!m) return null;
  let h = Number(m[4]) % 12;
  if (m[6].toUpperCase() === "PM") h += 12;
  const d = new Date(Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2]), h, Number(m[5])));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function toArticle(item: SerpItem): Article | null {
  if (!item.title || !item.link) return null;
  const src = typeof item.source === "string" ? { name: item.source } : item.source;
  return {
    title: item.title,
    link: item.link,
    source: src?.name ?? null,
    sourceIcon: src && "icon" in src ? src.icon ?? null : null,
    publishedAt: parseDate(item),
    thumbnail: item.thumbnail ?? null,
  };
}

async function search(area: string, key: string): Promise<News | null> {
  const q = `${area} (pollution OR "air quality" OR AQI OR smog OR "stubble burning" OR fire) when:7d`;
  const url = `https://serpapi.com/search.json?engine=google_news&gl=in&hl=en&q=${encodeURIComponent(q)}&api_key=${key}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000), cache: "no-store" });
  const data: { news_results?: SerpItem[]; error?: string } = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (data.error || !res.ok) {
    const message = data.error ?? `HTTP ${res.status}`;
    const kind = classifySerpError(message, res.status);
    if (kind === "empty") return { area, query: q, articles: [], fetchedAt: new Date().toISOString() };
    throw new SerpError(kind, message);
  }
  const flat: SerpItem[] = [];
  for (const item of data.news_results ?? []) {
    if (item.highlight) flat.push(item.highlight);
    if (item.stories?.length) flat.push(...item.stories);
    else flat.push(item);
  }
  const seen = new Set<string>();
  const articles = flat
    .map(toArticle)
    .filter((a): a is Article => {
      if (!a || seen.has(a.link)) return false;
      seen.add(a.link);
      return true;
    })
    .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""))
    .slice(0, 8);
  return { area, query: q, articles, fetchedAt: new Date().toISOString() };
}

export function newsConfigured(): boolean {
  return !!process.env.SERPAPI_API_KEY;
}

const lastError = new Map<string, { at: number; error: NewsError; detail: string }>();

export async function getNewsResult(area: string): Promise<NewsResult> {
  const key = process.env.SERPAPI_API_KEY?.trim();
  if (!key) return { ok: false, error: "not_configured", detail: "SERPAPI_API_KEY is not set" };
  const id = area.toLowerCase();
  const recent = lastError.get(id);
  if (recent && Date.now() - recent.at < ERROR_BACKOFF_MS) return { ok: false, error: recent.error, detail: recent.detail };
  let failure: { error: NewsError; detail: string } | null = null;
  const news = await cached(`news:v2:${id}`, "news", area === "Delhi NCR" ? NCR_TTL_MS : TTL_MS, () =>
    search(area, key).catch((e) => {
      failure = e instanceof SerpError ? { error: e.code, detail: e.message } : { error: "failed", detail: String(e).slice(0, 300) };
      return null;
    }),
  );
  if (news) return { ok: true, news };
  const f: { error: NewsError; detail: string } = failure ?? { error: "failed", detail: "no response" };
  lastError.set(id, { at: Date.now(), ...f });
  console.error(`[news] SerpApi failed for ${area}: ${f.error} ${f.detail}`);
  return { ok: false, ...f };
}

export async function getNews(area: string): Promise<News | null> {
  const r = await getNewsResult(area);
  return r.ok ? r.news : null;
}
