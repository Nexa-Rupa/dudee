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
  /** Run on this model instead of the employee's own. */
  model?: string | null;
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
  /** Talk to your team from Telegram: chats allowed to message employees and answer approvals. */
  telegram?: { allowedChats: number[]; defaultHire?: string | null; notify?: boolean };
  /** Employees that get Composio connected apps; empty or missing = everyone. */
  composioHires?: string[];
  /** Models to try, in order, when an employee's model fails. */
  fallbackModels: string[];
  /** How long scheduled work waits for an approval or an answer before going on without it. */
  approvalTimeoutMin: number;
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
  presence?: Presence;
  /** App tools found with find_tools in this task. */
  foundTools?: Set<string>;
}

/** Whether someone is likely to be around to answer. Shared by a task and the work it hands to teammates. */
export interface Presence {
  /** Started by a routine or webhook, so nobody may be watching. */
  unattended: boolean;
  /** A card already expired unanswered; don't wait for the next one. */
  gone: boolean;
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
  /** Decide from the actual input (e.g. an account set to post without asking). Undefined falls back to the usual order. */
  dynamicPolicy?: (input: I, ctx: ToolContext) => Policy | undefined;
  summarize?: (input: I) => string;
  execute: (input: I, ctx: ToolContext) => Promise<unknown>;
}

export type Row =
  | {
      kind: "message";
      role: "user" | "assistant";
      text: string;
      from?: string;
      /** Files sent with it, relative to the employee's files folder. */
      attachments?: string[];
      /** Joined a task already in progress. */
      added?: boolean;
    }
  | { kind: "tool"; tool: string; input: unknown; output?: unknown; error?: string; ms: number }
  | { kind: "approval"; tool: string; summary: string; decision: ApprovalDecision; expired?: boolean }
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
  /** The reply so far is now this (a model failed partway through a sentence). */
  | { type: "rewind"; hireId: string; text: string }
  /** Messages the user added that the running task hasn't read yet. */
  | { type: "added"; hireId: string; pending: string[] }
  | { type: "work-changed"; hireId: string }
  | { type: "status"; hireId: string; status: "working" | "tool" | "idle"; detail?: string }
  | { type: "usage"; hireId: string; model: string; inputTokens: number; outputTokens: number }
  | { type: "screen"; hireId: string; mime: string; data: string; at: string }
  | { type: "team-changed" }
  | { type: "routines-changed" }
  | { type: "social-changed" }
  | { type: "connections-changed" };

export interface ApprovalRequest {
  hire: Hire;
  tool: string;
  input: unknown;
  summary: string;
  /** Fires when the card expires (scheduled work only); drop it. */
  signal?: AbortSignal;
}

export type ApprovalDecision = "allow" | "always" | "deny";
export type ApprovalHandler = (req: ApprovalRequest) => Promise<ApprovalDecision>;
export type AskHandler = (hire: Hire, question: string, opts?: { signal?: AbortSignal }) => Promise<string | null>;

/** Billing seam: the cloud plugs a meter here; self-hosted just logs usage locally. */
export interface UsageRecord {
  hireId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** Null when the model has no known price. */
  costUsd?: number | null;
}
