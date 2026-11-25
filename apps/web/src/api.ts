// Types mirror @dude/core and @dude/server; kept local so the web bundle has no Node deps.

export type Row =
  | { kind: "message"; role: "user" | "assistant"; text: string; from?: string; attachments?: string[]; added?: boolean }
  | { kind: "tool"; tool: string; input: unknown; output?: unknown; error?: string; ms: number }
  | { kind: "approval"; tool: string; summary: string; decision: "allow" | "always" | "deny"; expired?: boolean }
  | { kind: "notice"; text: string };

export interface StoredRow {
  seq: number;
  hireId: string;
  at: string;
  row: Row;
}

export interface Live {
  status: "working" | "tool" | "idle";
  detail?: string;
  since: string;
  text: string;
  /** What you added that they haven't read yet. */
  pending?: string[];
}

export interface HireView {
  id: string;
  name: string;
  packId: string;
  title: string;
  model: string;
  createdAt: string;
  hasBrowser: boolean;
  ownModel: string | null;
  modelReady: boolean;
  live: Live | null;
  paused: boolean;
  budgetUsd: number | null;
  spend: Spend;
}

export interface Spend {
  usd: number;
  turns: number;
  unpricedTurns: number;
  tokens: number;
}

export interface ChatProvider {
  id: string;
  name: string;
  local: boolean;
  keyEnv: string | null;
  keyUrl: string | null;
  baseURL: string | null;
  baseURLEnv: string | null;
  note: string | null;
  models: string[];
  configured: boolean;
  keySource: "saved" | "env" | null;
  masked: string | null;
}

export interface MediaProvider {
  id: string;
  name: string;
  keyEnv: string;
  keyUrl: string;
  note: string;
  configured: boolean;
  keySource: "saved" | "env" | null;
  masked: string | null;
}

export interface ProvidersView {
  defaultModel: string;
  chat: ChatProvider[];
  media: MediaProvider[];
}

export interface SkillView {
  name: string;
  description: string;
  argumentHint: string | null;
  source: "pack" | "workspace" | "project" | "global";
  userInvocable: boolean;
  files: number;
}

export interface PackView {
  id: string;
  title: string;
  description: string;
  defaultName: string;
  tools: string[];
  requires: { env?: string[] };
  skills: Array<{ name: string; description: string }>;
}

export interface Approval {
  id: string;
  hireId: string;
  tool: string;
  summary: string;
  input: unknown;
  at: string;
}

export interface Question {
  id: string;
  hireId: string;
  question: string;
  at: string;
}

export interface AppState {
  company: { name?: string; website?: string; about?: string };
  model: string;
  modelReady: boolean;
  /** Demo server: replies are scripted, whatever model is connected. */
  demo?: boolean;
  goals: string[];
  budgetUsd: number | null;
  spend: Spend;
  packs: PackView[];
  hires: HireView[];
  approvals: Approval[];
  questions: Question[];
}

export interface Routine {
  id: string;
  hireId: string;
  cron: string;
  prompt: string;
  enabled: boolean;
  source: "pack" | "user" | "autopost";
  lastRunAt: string | null;
  model: string | null;
  hookKey: string | null;
}

export interface RoutineRun {
  id: string;
  startedAt: string;
  endedAt: string | null;
  status: "running" | "done" | "failed" | "stopped" | "interrupted";
  trigger: "schedule" | "manual" | "webhook";
  summary: string | null;
}

export interface WorkItem {
  id: string;
  text: string;
  status: "open" | "done";
  createdAt: string;
  doneAt: string | null;
}

export interface Screen {
  mime: string;
  data: string;
  at: string;
}

export type ServerEvent =
  | { type: "hello" }
  | { type: "row"; hireId: string; row: StoredRow }
  | { type: "delta"; hireId: string; text: string }
  | { type: "rewind"; hireId: string; text: string }
  | { type: "added"; hireId: string; pending: string[] }
  | { type: "work-changed"; hireId: string }
  | { type: "status"; hireId: string; status: Live["status"]; detail?: string }
  | { type: "usage"; hireId: string }
  | ({ type: "screen"; hireId: string } & Screen)
  | { type: "team-changed" }
  | { type: "settings-changed" }
  | { type: "routines-changed" }
  | { type: "connections-changed" }
  | { type: "social-changed" }
  | { type: "approval"; approval: Approval }
  | { type: "approval-closed"; id: string }
  | { type: "question"; question: Question }
  | { type: "question-closed"; id: string };

// The server prints a link with ?token=…; keep it for this tab and tidy the address bar.
function readToken() {
  const fromUrl = new URLSearchParams(location.search).get("token");
  try {
    if (fromUrl) {
      sessionStorage.setItem("dude-token", fromUrl);
      history.replaceState(null, "", location.pathname);
    }
    return fromUrl ?? sessionStorage.getItem("dude-token") ?? "";
  } catch {
    return fromUrl ?? "";
  }
}

export const token = readToken();

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api/${path}`, {
    method: init.method ?? "GET",
    headers: { "x-dude-token": token, ...(init.body ? { "content-type": "application/json" } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(data?.error ?? `Request failed (${res.status})`, res.status);
  return data as T;
}

/** Put a file in an employee's uploads folder. Returns its path in their files. */
export async function upload(hireId: string, file: File): Promise<string> {
  const res = await fetch(`/api/hires/${hireId}/uploads?name=${encodeURIComponent(file.name || "pasted.png")}`, {
    method: "POST",
    headers: { "x-dude-token": token, "content-type": "application/octet-stream" },
    body: file,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(data?.error ?? `Upload failed (${res.status})`, res.status);
  return data.path as string;
}

/** A link to one of an employee's files, for pictures, players and downloads. */
export function fileUrl(hireId: string, path: string, download = false) {
  return `/api/hires/${hireId}/raw?path=${encodeURIComponent(path)}&token=${encodeURIComponent(token)}${download ? "&download=1" : ""}`;
}

export function fileKind(path: string): "image" | "video" | "audio" | "pdf" | "other" {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  if (["png", "jpg", "jpeg", "webp", "gif"].includes(ext)) return "image";
  if (["mp4", "webm", "mov"].includes(ext)) return "video";
  if (["mp3", "wav", "m4a"].includes(ext)) return "audio";
  return ext === "pdf" ? "pdf" : "other";
}

export function subscribe(onEvent: (e: ServerEvent) => void, onStatus: (connected: boolean) => void) {
  const source = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
  source.onopen = () => onStatus(true);
  source.onerror = () => onStatus(false);
  source.onmessage = (m) => onEvent(JSON.parse(m.data));
  return () => source.close();
}
