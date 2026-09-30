import "server-only";
import { cleanModelName, quotaCooldownMs, rankFlashModels, type ListedModel } from "./geminiModelNames";

// Each model has its own free-tier quota, so the lite models are a real fallback when Flash is exhausted.
const DEFAULT_MODELS = ["gemini-2.5-flash", "gemini-flash-latest", "gemini-2.5-flash-lite", "gemini-flash-lite-latest"];
const LIST_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const MAX_DISCOVERED = 3;

// Per server instance: skip names Google already answered 404 for, and start from the last one that worked.
let working: string | null = null;
const notFound = new Set<string>();
const coolingUntil = new Map<string, number>();
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
  const skip = (m: string) => tried.has(m) || notFound.has(m) || isCooling(m);
  for (const m of [working, ...configuredModels()]) {
    if (!m || skip(m)) continue;
    tried.add(m);
    yield m;
  }
  let extra = 0;
  for (const m of await discoverModels(apiKey)) {
    if (extra >= MAX_DISCOVERED) break;
    if (skip(m)) continue;
    tried.add(m);
    extra++;
    yield m;
  }
}

export function markModelWorking(model: string) {
  if (working !== model && !configuredModels().slice(0, 1).includes(model)) {
    console.warn(`[gemini] ${configuredModels()[0]} unavailable (not found or out of quota); using ${model}`);
  }
  working = model;
}

export function markModelNotFound(model: string) {
  notFound.add(model);
  if (working === model) working = null;
}

function isCooling(model: string): boolean {
  const until = coolingUntil.get(model);
  if (until === undefined) return false;
  if (until > Date.now()) return true;
  coolingUntil.delete(model);
  return false;
}

/** After a 429, leave the model alone until Google's retry delay has passed. */
export function markModelQuota(model: string, detail: string) {
  const ms = quotaCooldownMs(detail);
  coolingUntil.set(model, Date.now() + ms);
  if (working === model) working = null;
  console.warn(`[gemini] quota hit on ${model}; skipping it for ${Math.round(ms / 1000)} s`);
}

/** True while any model is cooling down; optional Gemini work should wait so photo checks keep the quota. */
export function quotaPressure(): boolean {
  for (const m of [...coolingUntil.keys()]) if (isCooling(m)) return true;
  return false;
}
