import fs from "node:fs";
import path from "node:path";
import type { LanguageModel } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

/**
 * Every model provider dude can use with the user's own key. Most speak the OpenAI API,
 * so adding one is a row here. Users can add more in config.yaml under `providers:`.
 */
export interface ProviderInfo {
  id: string;
  name: string;
  /** Which client to use. */
  kind: "anthropic" | "openai" | "google" | "compatible";
  baseURL?: string;
  /** Env var holding the key. Absent for local servers that need none. */
  keyEnv?: string;
  /** Env var that can override the base URL. */
  baseURLEnv?: string;
  /** Where to get a key. */
  keyUrl?: string;
  /** Runs on this computer; the key is optional. */
  local?: boolean;
  /** A few model ids to start with; the full list comes from the provider. */
  models: string[];
  note?: string;
}

export const PROVIDERS: ProviderInfo[] = [
  {
    id: "anthropic", name: "Anthropic (Claude)", kind: "anthropic", keyEnv: "ANTHROPIC_API_KEY",
    keyUrl: "https://console.anthropic.com/settings/keys",
    models: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"],
  },
  {
    id: "openai", name: "OpenAI (GPT, Codex)", kind: "openai", keyEnv: "OPENAI_API_KEY",
    keyUrl: "https://platform.openai.com/api-keys", models: ["gpt-5", "gpt-5-mini", "gpt-5-codex"],
    note: "Codex models work with an API key. To use a ChatGPT subscription, run it through a router such as 9router.",
  },
  {
    id: "google", name: "Google (Gemini)", kind: "google", keyEnv: "GOOGLE_GENERATIVE_AI_API_KEY",
    keyUrl: "https://aistudio.google.com/apikey", models: ["gemini-2.5-pro", "gemini-2.5-flash"],
  },
  {
    id: "groq", name: "Groq", kind: "compatible", baseURL: "https://api.groq.com/openai/v1", keyEnv: "GROQ_API_KEY",
    keyUrl: "https://console.groq.com/keys", models: ["openai/gpt-oss-120b", "moonshotai/kimi-k2-instruct", "llama-3.3-70b-versatile"],
  },
  {
    id: "openrouter", name: "OpenRouter", kind: "compatible", baseURL: "https://openrouter.ai/api/v1", keyEnv: "OPENROUTER_API_KEY",
    keyUrl: "https://openrouter.ai/keys", models: ["openrouter/auto", "anthropic/claude-sonnet-4.5", "google/gemini-2.5-pro"],
    note: "One key for hundreds of models from every lab.",
  },
  {
    id: "deepseek", name: "DeepSeek", kind: "compatible", baseURL: "https://api.deepseek.com/v1", keyEnv: "DEEPSEEK_API_KEY",
    keyUrl: "https://platform.deepseek.com/api_keys", models: ["deepseek-chat", "deepseek-reasoner"],
  },
  {
    id: "moonshot", name: "Moonshot (Kimi)", kind: "compatible", baseURL: "https://api.moonshot.ai/v1", keyEnv: "MOONSHOT_API_KEY",
    baseURLEnv: "MOONSHOT_BASE_URL", keyUrl: "https://platform.moonshot.ai/console/api-keys", models: ["kimi-k2-0905-preview", "kimi-k2-turbo-preview"],
    note: "Keys from platform.moonshot.cn use https://api.moonshot.cn/v1 (set MOONSHOT_BASE_URL).",
  },
  {
    id: "zai", name: "Z.ai (GLM)", kind: "compatible", baseURL: "https://api.z.ai/api/paas/v4", keyEnv: "ZAI_API_KEY",
    baseURLEnv: "ZAI_BASE_URL", keyUrl: "https://z.ai/manage-apikey/apikey-list", models: ["glm-4.6", "glm-4.5-air"],
    note: "BigModel (China) keys use https://open.bigmodel.cn/api/paas/v4 (set ZAI_BASE_URL).",
  },
  {
    id: "qwen", name: "Qwen (Alibaba Cloud)", kind: "compatible",
    baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", keyEnv: "DASHSCOPE_API_KEY", baseURLEnv: "DASHSCOPE_BASE_URL",
    keyUrl: "https://modelstudio.console.alibabacloud.com/", models: ["qwen3-max", "qwen-plus", "qwen3-coder-plus"],
    note: "Mainland China keys use https://dashscope.aliyuncs.com/compatible-mode/v1 (set DASHSCOPE_BASE_URL).",
  },
  {
    id: "xai", name: "xAI (Grok)", kind: "compatible", baseURL: "https://api.x.ai/v1", keyEnv: "XAI_API_KEY",
    keyUrl: "https://console.x.ai", models: ["grok-4", "grok-4-fast"],
  },
  {
    id: "mistral", name: "Mistral", kind: "compatible", baseURL: "https://api.mistral.ai/v1", keyEnv: "MISTRAL_API_KEY",
    keyUrl: "https://console.mistral.ai/api-keys", models: ["mistral-large-latest", "mistral-medium-latest"],
  },
  {
    id: "together", name: "Together AI", kind: "compatible", baseURL: "https://api.together.xyz/v1", keyEnv: "TOGETHER_API_KEY",
    keyUrl: "https://api.together.ai/settings/api-keys", models: ["moonshotai/Kimi-K2-Instruct", "deepseek-ai/DeepSeek-V3"],
  },
  {
    id: "fireworks", name: "Fireworks AI", kind: "compatible", baseURL: "https://api.fireworks.ai/inference/v1", keyEnv: "FIREWORKS_API_KEY",
    keyUrl: "https://fireworks.ai/account/api-keys", models: ["accounts/fireworks/models/kimi-k2-instruct"],
  },
  {
    id: "cerebras", name: "Cerebras", kind: "compatible", baseURL: "https://api.cerebras.ai/v1", keyEnv: "CEREBRAS_API_KEY",
    keyUrl: "https://cloud.cerebras.ai", models: ["gpt-oss-120b", "qwen-3-coder-480b"],
  },
  {
    id: "9router", name: "9router (local router)", kind: "compatible", baseURL: "http://localhost:20128/v1",
    keyEnv: "NINEROUTER_API_KEY", baseURLEnv: "NINEROUTER_BASE_URL", local: true, models: [],
    note: "Routes to subscriptions and keys you set up in 9router. Use the model names 9router shows; set NINEROUTER_BASE_URL if it runs elsewhere.",
  },
  {
    id: "ollama", name: "Ollama (local)", kind: "compatible", baseURL: "http://localhost:11434/v1",
    baseURLEnv: "OLLAMA_BASE_URL", local: true, models: ["qwen3", "llama3.3", "gpt-oss:20b"],
  },
  {
    id: "lmstudio", name: "LM Studio (local)", kind: "compatible", baseURL: "http://localhost:1234/v1",
    baseURLEnv: "LMSTUDIO_BASE_URL", local: true, models: [],
  },
];

/** Media services employees can use as tools (not chat models). */
export const MEDIA_PROVIDERS = [
  {
    id: "fal", name: "fal.ai (images and video)", keyEnv: "FAL_KEY", keyUrl: "https://fal.ai/dashboard/keys",
    note: "Lets employees generate images and videos with Flux, Kling, Veo, Seedream and more.",
  },
  {
    id: "vapi", name: "Vapi (phone calls)", keyEnv: "VAPI_API_KEY", keyUrl: "https://dashboard.vapi.ai",
    note: "Also set VAPI_PHONE_NUMBER_ID and VAPI_ASSISTANT_ID.",
  },
  {
    id: "brave", name: "Brave Search", keyEnv: "BRAVE_API_KEY", keyUrl: "https://brave.com/search/api/",
    note: "Better web search than the free fallback.",
  },
] as const;

export interface CustomProvider {
  name?: string;
  baseURL: string;
  keyEnv?: string;
}

let custom: Record<string, CustomProvider> = {};

/** Register providers from config.yaml (any OpenAI-compatible endpoint). */
export function setCustomProviders(map: Record<string, CustomProvider> = {}) {
  custom = map;
}

export function allProviders(): ProviderInfo[] {
  const extra: ProviderInfo[] = Object.entries(custom).map(([id, c]) => ({
    id, name: c.name ?? id, kind: "compatible", baseURL: c.baseURL, keyEnv: c.keyEnv, models: [], local: !c.keyEnv,
  }));
  const ids = new Set(extra.map((p) => p.id));
  return [...PROVIDERS.filter((p) => !ids.has(p.id)), ...extra];
}

export function getProvider(id: string) {
  return allProviders().find((p) => p.id === id);
}

export function parseModelId(id: string): { provider: string; model: string } {
  const i = id.indexOf(":");
  if (i < 0) throw new Error(`Model "${id}" must look like provider:model, e.g. anthropic:claude-opus-5-5`);
  const provider = id.slice(0, i);
  if (!getProvider(provider)) {
    throw new Error(`Unknown provider "${provider}". Known: ${allProviders().map((p) => p.id).join(", ")}`);
  }
  return { provider, model: id.slice(i + 1) };
}

function baseURL(p: ProviderInfo, env: NodeJS.ProcessEnv) {
  return (p.baseURLEnv && env[p.baseURLEnv]) || p.baseURL;
}

/** Is this provider usable right now (key present, or local)? */
export function isConfigured(p: ProviderInfo, env: NodeJS.ProcessEnv = process.env) {
  return p.local || !p.keyEnv || !!env[p.keyEnv];
}

/** Resolve `provider:model` with the user's own keys. */
export function resolveModel(id: string, env: NodeJS.ProcessEnv = process.env): LanguageModel {
  const { provider, model } = parseModelId(id);
  const p = getProvider(provider)!;
  const apiKey = p.keyEnv ? env[p.keyEnv] : undefined;
  if (p.keyEnv && !apiKey && !p.local) {
    throw new Error(`${p.name} has no key. Add ${p.keyEnv} in Settings → Models, or run: dudee keys set ${p.id}`);
  }
  switch (p.kind) {
    case "anthropic":
      return createAnthropic({ apiKey })(model);
    case "openai":
      return createOpenAI({ apiKey, baseURL: baseURL(p, env) })(model);
    case "google":
      return createGoogleGenerativeAI({ apiKey })(model);
    case "compatible":
      return createOpenAICompatible({
        name: p.id,
        baseURL: baseURL(p, env)!,
        apiKey: apiKey || undefined,
        headers: p.id === "openrouter" ? { "X-Title": "dude" } : undefined,
      })(model);
  }
}

/** Ask the provider which models this key can use. Doubles as a key check. */
export async function listModels(id: string, env: NodeJS.ProcessEnv = process.env): Promise<string[]> {
  const p = getProvider(id);
  if (!p) throw new Error(`Unknown provider ${id}`);
  const key = p.keyEnv ? env[p.keyEnv] : undefined;
  if (p.keyEnv && !key && !p.local) throw new Error(`No key set for ${p.name}`);
  try {
    return await fetchModels(p, key, env);
  } catch (err) {
    if (err instanceof TypeError || (err as Error).name === "TimeoutError") {
      const where = p.kind === "compatible" || p.kind === "openai" ? ` at ${baseURL(p, env) ?? "api.openai.com"}` : "";
      throw new Error(`Couldn't reach ${p.name}${where}.${p.local ? " Is it running?" : " Check your connection."}`);
    }
    throw err;
  }
}

async function fetchModels(p: ProviderInfo, key: string | undefined, env: NodeJS.ProcessEnv): Promise<string[]> {
  let res: Response;
  if (p.kind === "anthropic") {
    res = await fetch("https://api.anthropic.com/v1/models?limit=100", {
      headers: { "x-api-key": key!, "anthropic-version": "2023-06-01" },
      signal: AbortSignal.timeout(15_000),
    });
  } else if (p.kind === "google") {
    res = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", {
      headers: { "x-goog-api-key": key! },
      signal: AbortSignal.timeout(15_000),
    });
  } else {
    const base = baseURL(p, env) ?? "https://api.openai.com/v1";
    res = await fetch(`${base.replace(/\/$/, "")}/models`, {
      headers: key ? { authorization: `Bearer ${key}` } : {},
      signal: AbortSignal.timeout(15_000),
    });
  }
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message ?? data?.message ?? (typeof data?.error === "string" ? data.error : "");
    throw new Error(`${p.name} said ${res.status}${msg ? `: ${msg}` : ""}`);
  }
  if (p.kind === "google") {
    return (data.models ?? [])
      .filter((m: any) => (m.supportedGenerationMethods ?? []).includes("generateContent"))
      .map((m: any) => String(m.name).replace(/^models\//, ""));
  }
  return (data.data ?? data.models ?? []).map((m: any) => String(m.id ?? m.name)).filter(Boolean).sort();
}

// ── keys saved by dude (for people who don't keep a .env) ──────────────────

export function secretsPath(home: string) {
  return path.join(home, "secrets.env");
}

export function readSecrets(home: string): Record<string, string> {
  const file = secretsPath(home);
  if (!fs.existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

/** Put saved keys into the environment. Keys already set in the real environment win. */
export function loadSecrets(home: string, env: NodeJS.ProcessEnv = process.env) {
  for (const [k, v] of Object.entries(readSecrets(home))) if (!env[k]) env[k] = v;
}

/** Save or remove (value null) one key, in the file and in this process. */
export function setSecret(home: string, name: string, value: string | null, env: NodeJS.ProcessEnv = process.env) {
  if (!/^[A-Z0-9_]+$/.test(name)) throw new Error(`Bad key name ${name}`);
  if (value !== null && /[\r\n]/.test(value)) throw new Error("A key can't contain line breaks");
  const all = readSecrets(home);
  if (value === null) {
    // only forget the in-process value if it came from this file, not the real environment
    if (all[name] !== undefined && env[name] === all[name]) delete env[name];
    delete all[name];
  } else {
    all[name] = value.trim();
    env[name] = value.trim();
  }
  fs.mkdirSync(home, { recursive: true });
  const body = "# Keys saved by dude. Keep this file private; it is ignored by git.\n" +
    Object.entries(all).map(([k, v]) => `${k}=${v}`).join("\n") + "\n";
  fs.writeFileSync(secretsPath(home), body, { mode: 0o600 });
}

/** Where a key comes from, for display. Never returns the key itself. */
export function keySource(home: string, name: string, env: NodeJS.ProcessEnv = process.env): "saved" | "env" | null {
  if (readSecrets(home)[name]) return "saved";
  return env[name] ? "env" : null;
}

export function maskKey(value: string | undefined) {
  if (!value) return null;
  return value.length <= 8 ? "••••" : `${value.slice(0, 4)}••••${value.slice(-4)}`;
}
