import type { z } from "zod";
import type { Runtime } from "./runtime.js";

/** How a tool call is gated. `auto` runs at once, `ask` waits for the user, `deny` refuses. */
export type Policy = "auto" | "ask" | "deny";

/** `read` tools observe; `write` tools change something outside the employee's own folder. */
export type Risk = "read" | "write";

export interface RoutineSpec {
  id: string;
  cron: string;
  prompt: string;
  enabled?: boolean;
}

/** A skill in the Agent Skills format (SKILL.md + optional bundled files). */
export interface SkillSpec {
  name: string;
  description: string;
  body: string;
  /** Folder holding SKILL.md and bundled files; null for a single .md file. */
  dir?: string | null;
  /** Bundled files, relative to dir. */
  files?: string[];
  source?: "pack" | "workspace" | "project" | "global";
  argumentHint?: string;
  /** Can the user run it as /name. Default true. */
  userInvocable?: boolean;
  license?: string;
}

/** An employee pack: a role definition anyone can share, fork and install. */
export interface EmployeePack {
  id: string;
  title: string;
  description: string;
  defaultName: string;
  model?: string;
  tools: string[];
  approvals: Record<string, Policy>;
  routines: RoutineSpec[];
  requires: { env?: string[]; mcp?: string[] };
  instructions: string;
  skills: SkillSpec[];
  dir: string;
}

/** A hired employee: one instance of a pack, with its own name, memory and files. */
export interface Hire {
  id: string;
  name: string;
  packId: string;
  model: string | null;
  createdAt: string;
  /** Paused employees take no work and run no routines. */
  paused: boolean;
  /** Monthly spend limit in US dollars; null = no limit. */
  budgetUsd: number | null;
}

/** Price per million tokens, in US dollars. */
export interface ModelPrice {
  in: number;
  out: number;
}

export type McpServerConfig =
  | { command: string; args?: string[]; env?: Record<string, string>; hires?: string[] }
  | { url: string; headers?: Record<string, string>; hires?: string[] };

export interface DudeConfig {
  /** Default model as `provider:model`, e.g. `anthropic:claude-opus-5-5`. */
  model: string;
  maxSteps: number;
  company: { name?: string; website?: string; about?: string };
  /** Workspace-wide approval overrides by tool name. */
  approvals: Record<string, Policy>;
  mcpServers: Record<string, McpServerConfig>;
  /** Extra folders to load employee packs from (your own or community packs). */
  packDirs: string[];
  /** Extra OpenAI-compatible providers: { myproxy: { baseURL, keyEnv } }. */
  providers: Record<string, { name?: string; baseURL: string; keyEnv?: string }>;
  /** Extra skill folders shared by every employee. */
  skillDirs: string[];
  /** Load the user's global skills from ~/.claude/skills and ~/.agents/skills. */
  globalSkills: boolean;
  /** Tool groups every employee gets on top of their pack's, e.g. [shell, media]. */
  extraTools: string[];
  /** Company goals every employee works toward. */
  goals: string[];
  /** Monthly spend limit for the whole team, in US dollars; null = no limit. */
  budgetUsd: number | null;
  /** Your own model prices (per million tokens) for models dude has no price for. */
  prices: Record<string, ModelPrice>;
}

export interface ToolContext {
  hire: Hire;
  pack: EmployeePack;
  runtime: Runtime;
  /** Hire ids already in this conversation chain, to stop teammates looping. */
  chain: string[];
  signal?: AbortSignal;
}

export interface ToolDef<I = any> {
  name: string;
  description: string;
  /** Zod schema, or a raw JSON schema (used for MCP tools). */
  input: z.ZodType<I> | { jsonSchema: Record<string, unknown> };
  risk: Risk;
  defaultPolicy?: Policy;
  /** Always ask, even if the user chose "always allow" (calls, payments). */
  alwaysAsk?: boolean;
  summarize?: (input: I) => string;
  execute: (input: I, ctx: ToolContext) => Promise<unknown>;
}

export type Row =
  | { kind: "message"; role: "user" | "assistant"; text: string; from?: string }
  | { kind: "tool"; tool: string; input: unknown; output?: unknown; error?: string; ms: number }
  | { kind: "approval"; tool: string; summary: string; decision: ApprovalDecision }
  | { kind: "notice"; text: string };

export interface StoredRow {
  seq: number;
  hireId: string;
  at: string;
  row: Row;
}

export type RuntimeEvent =
  | { type: "row"; hireId: string; row: StoredRow }
  | { type: "delta"; hireId: string; text: string }
  | { type: "status"; hireId: string; status: "working" | "tool" | "idle"; detail?: string }
  | { type: "usage"; hireId: string; model: string; inputTokens: number; outputTokens: number }
  | { type: "screen"; hireId: string; mime: string; data: string; at: string }
  | { type: "team-changed" }
  | { type: "routines-changed" };

export interface ApprovalRequest {
  hire: Hire;
  tool: string;
  input: unknown;
  summary: string;
}

export type ApprovalDecision = "allow" | "always" | "deny";
export type ApprovalHandler = (req: ApprovalRequest) => Promise<ApprovalDecision>;
export type AskHandler = (hire: Hire, question: string) => Promise<string | null>;

/** Billing seam: the cloud plugs a meter here; self-hosted just logs usage locally. */
export interface UsageRecord {
  hireId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** Null when the model has no known price. */
  costUsd?: number | null;
}
