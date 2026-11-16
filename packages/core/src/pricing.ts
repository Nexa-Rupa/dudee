import type { DudeConfig, ModelPrice } from "./types.js";

/**
 * Prices dude knows, per million tokens in US dollars. Only list prices you can verify;
 * everything else is priced by the user in Settings (config `prices`). Local models are free.
 */
export const KNOWN_PRICES: Record<string, ModelPrice> = {
  "anthropic:claude-opus-5-5": { in: 4, out: 20 },
  "anthropic:claude-sonnet-5-5": { in: 2, out: 10 },
  "anthropic:claude-haiku-5-5": { in: 0.1, out: 0.5 },
};

const FREE_PROVIDERS = new Set(["ollama", "lmstudio"]);

/** Price for a model: the user's own price wins, then a known price, then free for local models. */
export function priceFor(modelId: string, config: Pick<DudeConfig, "prices">): ModelPrice | null {
  if (config.prices[modelId]) return config.prices[modelId];
  if (KNOWN_PRICES[modelId]) return KNOWN_PRICES[modelId];
  if (FREE_PROVIDERS.has(modelId.split(":")[0])) return { in: 0, out: 0 };
  return null;
}

/** Cost of one turn, or null when the model has no price yet. */
export function costOf(modelId: string, inputTokens: number, outputTokens: number, config: Pick<DudeConfig, "prices">) {
  const p = priceFor(modelId, config);
  if (!p) return null;
  return (inputTokens * p.in + outputTokens * p.out) / 1_000_000;
}

/** First moment of the current calendar month, local time, as ISO. */
export function monthStart(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
}
