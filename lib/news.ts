import "server-only";
import { cached } from "./cache";

// SerpApi's free plan is 100 searches a month; NCR shares one query and results live 8 h.
const TTL_MS = 8 * 3600 * 1000;
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
  if (!res.ok) return null;
  const data: { news_results?: SerpItem[]; error?: string } = await res.json();
  if (data.error) return null;
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

export async function getNews(area: string): Promise<News | null> {
  const key = process.env.SERPAPI_API_KEY;
  if (!key) return null;
  return cached(`news:v1:${area.toLowerCase()}`, "news", TTL_MS, () => search(area, key).catch(() => null));
}
