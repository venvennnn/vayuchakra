/** Tolerates the usual env mistakes: quotes, spaces, and a "models/" prefix. */
export function cleanModelName(v: string | undefined | null): string {
  return (v ?? "").trim().replace(/^["']|["']$/g, "").trim().replace(/^models\//, "");
}

export type ListedModel = { name?: string; supportedGenerationMethods?: string[] };

/** Flash models this key can call, stable before preview, non-lite before lite, newest first. */
export function rankFlashModels(models: ListedModel[]): string[] {
  const rank = (n: string) => {
    const version = Number(n.match(/gemini-(\d+(?:\.\d+)?)/)?.[1] ?? 0);
    return [/preview|exp/.test(n) ? 1 : 0, /lite/.test(n) ? 1 : 0, -version] as const;
  };
  return models
    .filter((m) => m.name && m.supportedGenerationMethods?.includes("generateContent"))
    .map((m) => cleanModelName(m.name))
    .filter((n) => /^gemini-.*flash/.test(n) && !/(tts|image|live|audio|embedding|thinking)/.test(n))
    .sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      return ra[0] - rb[0] || ra[1] - rb[1] || ra[2] - rb[2] || a.localeCompare(b);
    });
}

/** How long to skip a model after a 429: Google's retryDelay when given, an hour for daily or zero limits. */
export function quotaCooldownMs(detail: string): number {
  if (/PerDay|per day|limit: 0\b/i.test(detail)) return 60 * 60 * 1000;
  const m = detail.match(/retry(?:Delay)?[^0-9]{0,12}(\d+(?:\.\d+)?)\s*s/i);
  const s = m ? Number(m[1]) : 60;
  return Math.min(60 * 60, Math.max(15, Math.ceil(s))) * 1000;
}
