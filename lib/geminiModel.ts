import "server-only";
import { cleanModelName, rankFlashModels, type ListedModel } from "./geminiModelNames";

const DEFAULT_MODELS = ["gemini-2.5-flash", "gemini-flash-latest"];
const LIST_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const MAX_DISCOVERED = 3;

// Per server instance: skip names Google already answered 404 for, and start from the last one that worked.
let working: string | null = null;
const notFound = new Set<string>();
let discovered: Promise<string[]> | null = null;

export function configuredModels(): string[] {
  const env = cleanModelName(process.env.GEMINI_MODEL);
  return [...new Set([env, ...DEFAULT_MODELS].filter(Boolean))];
}

async function discoverModels(apiKey: string): Promise<string[]> {
  discovered ??= fetch(`${LIST_URL}?pageSize=1000&key=${encodeURIComponent(apiKey)}`, { signal: AbortSignal.timeout(8000), cache: "no-store" })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`list models HTTP ${r.status}`))))
    .then((d: { models?: ListedModel[] }) => rankFlashModels(d.models ?? []))
    .catch((e) => {
      console.error(`[gemini] could not list models: ${e instanceof Error ? e.message : e}`);
      discovered = null;
      return [];
    });
  return discovered;
}

/**
 * Model names to try, in order. The consumer stops pulling once a model answers,
 * so the model list is only fetched after every configured name returned 404.
 */
export async function* modelCandidates(apiKey: string): AsyncGenerator<string> {
  const tried = new Set<string>();
  for (const m of [working, ...configuredModels()]) {
    if (!m || tried.has(m) || notFound.has(m)) continue;
    tried.add(m);
    yield m;
  }
  let extra = 0;
  for (const m of await discoverModels(apiKey)) {
    if (extra >= MAX_DISCOVERED) break;
    if (tried.has(m) || notFound.has(m)) continue;
    tried.add(m);
    extra++;
    yield m;
  }
}

export function markModelWorking(model: string) {
  if (working !== model && !configuredModels().slice(0, 1).includes(model)) {
    console.warn(`[gemini] GEMINI_MODEL "${process.env.GEMINI_MODEL ?? ""}" not usable; using ${model}`);
  }
  working = model;
}

export function markModelNotFound(model: string) {
  notFound.add(model);
  if (working === model) working = null;
}
