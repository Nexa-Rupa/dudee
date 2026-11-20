import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import type { DudeConfig } from "./types.js";

export const DEFAULT_MODEL = "anthropic:claude-opus-5-5";

export const DEFAULT_CONFIG: DudeConfig = {
  model: DEFAULT_MODEL,
  maxSteps: 25,
  company: {},
  approvals: {},
  mcpServers: {},
  packDirs: [],
  providers: {},
  skillDirs: [],
  globalSkills: true,
  extraTools: [],
  goals: [],
  budgetUsd: null,
  prices: {},
};

/** The workspace folder: $DUDE_HOME, else ./.dude in the current directory. */
export function resolveHome(cwd = process.cwd()): string {
  return process.env.DUDE_HOME ? path.resolve(process.env.DUDE_HOME) : path.join(cwd, ".dude");
}

export function configPath(home: string) {
  return path.join(home, "config.yaml");
}

export function isInitialized(home: string) {
  return fs.existsSync(configPath(home));
}

export function loadConfig(home: string): DudeConfig {
  const file = configPath(home);
  if (!fs.existsSync(file)) return structuredClone(DEFAULT_CONFIG);
  const raw = (YAML.parse(fs.readFileSync(file, "utf8")) ?? {}) as Partial<DudeConfig>;
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    company: { ...(raw.company ?? {}) },
    approvals: { ...(raw.approvals ?? {}) },
    mcpServers: { ...(raw.mcpServers ?? {}) },
    packDirs: raw.packDirs ?? [],
    providers: { ...(raw.providers ?? {}) },
    skillDirs: raw.skillDirs ?? [],
    globalSkills: raw.globalSkills ?? true,
    extraTools: raw.extraTools ?? [],
    goals: raw.goals ?? [],
    budgetUsd: typeof raw.budgetUsd === "number" ? raw.budgetUsd : null,
    prices: { ...(raw.prices ?? {}) },
    telegram: raw.telegram ? { allowedChats: (raw.telegram.allowedChats ?? []).map(Number), defaultHire: raw.telegram.defaultHire ?? null, notify: raw.telegram.notify ?? true } : undefined,
    composioHires: raw.composioHires ?? [],
  };
}

export function saveConfig(home: string, config: DudeConfig) {
  fs.mkdirSync(home, { recursive: true });
  const header =
    "# dude workspace config. API keys live in .env or .dude/secrets.env, never here.\n" +
    "# model: provider:model, e.g. anthropic:claude-opus-5-5, openai:gpt-5, groq:openai/gpt-oss-120b,\n" +
    "#   deepseek:deepseek-chat, moonshot:kimi-k2-0905-preview, zai:glm-4.6, qwen:qwen3-max, ollama:qwen3\n";
  fs.writeFileSync(configPath(home), header + YAML.stringify(config));
}

export function hireDir(home: string, hireId: string) {
  return path.join(home, "team", hireId);
}
