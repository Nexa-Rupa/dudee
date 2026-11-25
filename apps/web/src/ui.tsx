import { useEffect, useState, type CSSProperties } from "react";
import type { AppState, HireView } from "./api";

// ── the credential system: role bands, numbers, status ─────────────────────

const ROLE: Record<string, string> = {
  "marketing-manager": "#c8402b",
  "content-creator": "#5b3ac0",
  caller: "#0b7a55",
  researcher: "#2459c4",
};
const EXTRA = ["#8a4b0f", "#0f6e7a", "#a0306e", "#3f4a5c"];

/** Flat role colour for a pack; every role colour carries white text at 4.5:1 or better. */
export function roleColor(packId: string) {
  if (ROLE[packId]) return ROLE[packId];
  let h = 0;
  for (const c of packId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return EXTRA[h % EXTRA.length];
}

export function roleStyle(packId: string): CSSProperties {
  return { ["--role" as string]: roleColor(packId) };
}

/** Employee numbers follow hiring order: EMP-001, EMP-002… */
export function empNo(state: AppState, id: string) {
  const i = state.hires.findIndex((h) => h.id === id);
  return `EMP-${String(i + 1).padStart(3, "0")}`;
}

export function deliverableNo(n: number) {
  return `D-${String(n).padStart(3, "0")}`;
}

export type Status = "needs" | "working" | "idle" | "paused";

export function statusOf(state: AppState, h: HireView): Status {
  if (state.approvals.some((a) => a.hireId === h.id) || state.questions.some((q) => q.hireId === h.id)) return "needs";
  if (h.live) return "working";
  return h.paused ? "paused" : "idle";
}

export const STATUS_LABEL: Record<Status, string> = { needs: "Needs you", working: "Working", idle: "Idle", paused: "Paused" };

/** Dollars for people: $0.42, $12.50, $1,240. */
export function usd(n: number) {
  return n >= 1000 ? `$${Math.round(n).toLocaleString()}` : `$${n.toFixed(2)}`;
}

/** The badge's status mark: solid when working, striped when it needs you, ring when idle, bars when paused. */
export function StatusMark({ status, size = "sm" }: { status: Status; size?: "sm" | "lg" }) {
  const label = STATUS_LABEL[status];
  return <span className={`mark ${status} ${size}`} role="img" aria-label={label} title={label} />;
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "0 9 * * 1" → "every Monday at 9:00". Falls back to the raw schedule when it is unusual. */
export function cronToText(cron: string) {
  const p = cron.trim().split(/\s+/);
  if (p.length !== 5) return `on the schedule ${cron}`;
  const [min, hour, dom, mon, dow] = p;
  if (!/^\d+$/.test(min) || !/^\d+$/.test(hour) || mon !== "*") return `on the schedule ${cron}`;
  const at = `${Number(hour)}:${min.padStart(2, "0")}`;
  if (dom === "*" && dow === "*") return `every day at ${at}`;
  if (dom === "*" && dow === "1-5") return `every weekday at ${at}`;
  if (dom === "*" && /^[0-7](,[0-7])*$/.test(dow)) {
    const names = dow.split(",").map((d) => DAYS[Number(d) % 7]);
    return `every ${names.join(" and ")} at ${at}`;
  }
  if (/^\d+$/.test(dom) && dow === "*") return `on day ${dom} of every month at ${at}`;
  return `on the schedule ${cron}`;
}

/** Approval summaries in owner language: schedules spelled out, tool ids hidden. */
export function plainSummary(summary: string) {
  return summary
    .replace(/schedule "([^"]+)" at (\S+ \S+ \S+ \S+ \S+): /, (_m, id, cron) => `run "${id}" ${cronToText(cron)}: `)
    .replace(/^run: /, "run the command: ")
    .replace(/^(\w+) → (\w+) /, (_m, app, tool) => `use ${app} (${String(tool).replace(/_/g, " ").toLowerCase()}) `);
}

/** First sentence of a role description, for badge second lines. */
export function roleLine(description: string) {
  const first = description.split(/(?<=\.)\s/)[0] ?? description;
  return first.length > 70 ? `${first.slice(0, 68).trimEnd()}…` : first;
}

/** The employee's monogram on their role colour. */
export function Avatar({ name, packId, size = 32 }: { name: string; packId: string; size?: number }) {
  return (
    <span className="avatar" aria-hidden style={{ width: size, height: size, fontSize: size * 0.46, ...roleStyle(packId) }}>
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

/** Re-renders every second while mounted, for running timers. */
export function useTick(active: boolean) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => set((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [active]);
}

export function duration(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${String(s % 60).padStart(2, "0")}s`;
}

export function timeOf(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Turn "web_search" or "browser_navigate" into a phrase people read. */
export function stepLabel(tool: string) {
  const known: Record<string, string> = {
    web_search: "Searched the web",
    web_fetch: "Read a page",
    files_write: "Saved a file",
    files_read: "Opened a file",
    files_list: "Looked at files",
    memory_save: "Remembered something",
    memory_forget: "Forgot something",
    memory_update: "Corrected a memory",
    memory_search: "Searched memory",
    team_memory_save: "Told the whole team",
    work_add: "Noted open work",
    work_done: "Finished open work",
    work_list: "Checked open work",
    skill_save: "Saved a skill",
    find_tools: "Looked for a tool",
    use_skill: "Opened a playbook",
    ask_user: "Asked you",
    send_to_teammate: "Asked a teammate",
    list_teammates: "Checked the team",
    routine_add: "Scheduled a routine",
    routine_remove: "Removed a routine",
    routine_list: "Checked routines",
    phone_call: "Placed a call",
    phone_call_status: "Checked a call",
    browser_navigate: "Opened a page in the browser",
    browser_click: "Clicked",
    browser_type: "Typed",
    browser_snapshot: "Looked at the screen",
    browser_take_screenshot: "Took a screenshot",
    browser_fill_form: "Filled a form",
  };
  if (known[tool]) return known[tool];
  const app = tool.includes("__") ? tool.split("__")[0] : null;
  const action = (app ? tool.split("__")[1] : tool).replace(/^browser_/, "").replace(/_/g, " ");
  return app ? `${app}: ${action}` : action.charAt(0).toUpperCase() + action.slice(1);
}

/** A permission in plain words: what the employee may now do without asking. */
export function allowLabel(tool: string) {
  const known: Record<string, string> = {
    routine_add: "Schedule routines",
    routine_remove: "Remove routines",
    files_write: "Save files",
    generate_image: "Generate images",
    fal_run: "Run fal.ai models",
    run_command: "Run commands",
    team_memory_save: "Add to team memory",
    skill_save: "Save skills",
    browser_click: "Click in the browser",
    browser_type: "Type in the browser",
    browser_fill_form: "Fill forms in the browser",
  };
  if (known[tool]) return known[tool];
  return tool.includes("__") ? `${tool.split("__")[0]}: ${tool.split("__")[1].replace(/_/g, " ")}` : tool.replace(/_/g, " ");
}

/** One-line hint of what a step was about, from its input. */
export function stepHint(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const o = input as Record<string, unknown>;
  const v = o.query ?? o.url ?? o.path ?? o.name ?? o.fact ?? o.element ?? o.question ?? o.id ?? o.to;
  return typeof v === "string" ? v : "";
}
