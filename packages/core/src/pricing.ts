import fs from "node:fs";
import path from "node:path";
import type { DudeConfig, ModelPrice } from "./types.js";

/**
 * Prices dude knows, per million tokens in US dollars. Only list prices you can verify;
 * everything else is priced by the user in Settings (config `prices`), or by the provider's own
 * published price list (OpenRouter has one). Local models are free.
 */
export const KNOWN_PRICES: Record<string, ModelPrice> = {
  "anthropic:claude-opus-5-5": { in: 4, out: 20 },
  "anthropic:claude-sonnet-5-5": { in: 2, out: 10 },
  "anthropic:claude-haiku-5-5": { in: 0.1, out: 0.5 },
};

const FREE_PROVIDERS = new Set(["ollama", "lmstudio"]);

/** Providers that publish their prices, so spend counts without the user typing prices in. */
export const PRICED_PROVIDERS = new Set(["openrouter"]);

/** Prices providers reported themselves, by full model id (provider:model). */
const providerPrices = new Map<string, ModelPrice>();

/** Price for a model: the user's own price wins, then a known price, then the provider's own, then free for local models. */
export function priceFor(modelId: string, config: Pick<DudeConfig, "prices">): ModelPrice | null {
  if (config.prices[modelId]) return config.prices[modelId];
  if (KNOWN_PRICES[modelId]) return KNOWN_PRICES[modelId];
  const reported = providerPrices.get(modelId);
  if (reported) return reported;
  if (FREE_PROVIDERS.has(modelId.split(":")[0])) return { in: 0, out: 0 };
  return null;
}

/** Cost of one turn, or null when the model has no price yet. */
export function costOf(modelId: string, inputTokens: number, outputTokens: number, config: Pick<DudeConfig, "prices">) {
  const p = priceFor(modelId, config);
  if (!p) return null;
  return (inputTokens * p.in + outputTokens * p.out) / 1_000_000;
}

/** Dollars for people. Spend under a cent keeps two digits so it doesn't read as $0.00. */
export function formatUsd(n: number) {
  return n > 0 && n < 0.01 ? `$${n.toPrecision(2)}` : `$${n.toFixed(2)}`;
}

/** First moment of the current calendar month, local time, as ISO. */
export function monthStart(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
}

// ── prices providers report, cached in the workspace ───────────────────────

type PriceCache = { fetchedAt: Record<string, string>; prices: Record<string, ModelPrice> };

function cachePath(home: string) {
  return path.join(home, "provider-prices.json");
}

function readCache(home: string): PriceCache {
  try {
    const raw = JSON.parse(fs.readFileSync(cachePath(home), "utf8"));
    return { fetchedAt: raw.fetchedAt ?? {}, prices: raw.prices ?? {} };
  } catch {
    return { fetchedAt: {}, prices: {} };
  }
}

/** Load the prices providers reported earlier into memory. Returns when each provider was last fetched. */
export function loadProviderPrices(home: string): Record<string, Date> {
  const cache = readCache(home);
  for (const [id, p] of Object.entries(cache.prices)) providerPrices.set(id, p);
  return Object.fromEntries(Object.entries(cache.fetchedAt).map(([k, v]) => [k, new Date(v)]));
}

/** Save a provider's prices (model id without the provider prefix → price) and use them at once. */
export function rememberProviderPrices(home: string, provider: string, prices: Record<string, ModelPrice>, now = new Date()) {
  const cache = readCache(home);
  const prefix = `${provider}:`;
  for (const id of Object.keys(cache.prices)) if (id.startsWith(prefix)) delete cache.prices[id];
  for (const id of [...providerPrices.keys()]) if (id.startsWith(prefix)) providerPrices.delete(id);
  for (const [model, p] of Object.entries(prices)) {
    cache.prices[prefix + model] = p;
    providerPrices.set(prefix + model, p);
  }
  cache.fetchedAt[provider] = now.toISOString();
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(cachePath(home), JSON.stringify(cache));
}

/** Forget the reported prices held in memory (tests). */
export function clearProviderPrices() {
  providerPrices.clear();
}

/**
 * OpenRouter's /models list as prices per million tokens. It gives dollars per token as strings;
 * models priced per request (negative or missing numbers, like openrouter/auto) are left out.
 */
export function parseOpenRouterPrices(data: any): Record<string, ModelPrice> {
  const out: Record<string, ModelPrice> = {};
  for (const m of data?.data ?? []) {
    const p = m?.pricing;
    if (!m?.id || p?.prompt == null || p?.completion == null) continue;
    const input = Number(p.prompt);
    const output = Number(p.completion);
    if (!Number.isFinite(input) || !Number.isFinite(output) || input < 0 || output < 0) continue;
    out[String(m.id)] = { in: perMillion(input), out: perMillion(output) };
  }
  return out;
}

function perMillion(perToken: number) {
  return Math.round(perToken * 1e12) / 1e6; // avoids 0.15000000000000002
}

/** Fetch a provider's published prices. OpenRouter's list is public, so no key is sent. */
export async function fetchProviderPrices(provider: string): Promise<Record<string, ModelPrice>> {
  if (provider !== "openrouter") return {};
  const res = await fetch("https://openrouter.ai/api/v1/models", { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`OpenRouter said ${res.status}`);
  return parseOpenRouterPrices(await res.json());
}
