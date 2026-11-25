import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { Cron } from "croner";
import type { ToolContext, ToolDef } from "../types.js";
import { phoneTools } from "./phone.js";
import { mediaTools } from "./media.js";
import { shellTools } from "./shell.js";
import { videoTools } from "./video.js";
import { socialTools } from "../social.js";
import { fetchPublic } from "../net.js";
import { readSkillFile, renderSkill, saveSkill } from "../skills.js";

const MAX_TEXT = 20_000;

function define<I>(def: ToolDef<I>): ToolDef<I> {
  return def;
}

// ── files: each employee works in its own folder ───────────────────────────
function safePath(ctx: ToolContext, rel: string) {
  const root = ctx.runtime.filesDir(ctx.hire);
  const full = path.resolve(root, rel);
  if (full !== root && !full.startsWith(root + path.sep)) throw new Error("Path is outside your files folder");
  return { root, full };
}

const files: ToolDef[] = [
  define({
    name: "files_list",
    description: "List the files in your files folder (deliverables, drafts, notes).",
    input: z.object({ dir: z.string().default(".").describe("Sub-folder, relative to your files folder") }),
    risk: "read",
    async execute({ dir }, ctx) {
      const { root, full } = safePath(ctx, dir ?? ".");
      fs.mkdirSync(root, { recursive: true });
      if (!fs.existsSync(full)) return [];
      return fs.readdirSync(full, { withFileTypes: true }).map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
    },
  }),
  define({
    name: "files_read",
    description: "Read a text file from your files folder.",
    input: z.object({ path: z.string() }),
    risk: "read",
    async execute(input, ctx) {
      const { full } = safePath(ctx, input.path);
      const data = fs.readFileSync(full);
      if (data.subarray(0, 8000).includes(0)) return { error: `${input.path} is not a text file (${data.length} bytes). You can only read text.` };
      return data.toString("utf8").slice(0, MAX_TEXT);
    },
  }),
  define({
    name: "files_write",
    description:
      "Save a deliverable (post, plan, report, script) as a file in your files folder. Use Markdown unless asked otherwise.",
    input: z.object({ path: z.string(), content: z.string() }),
    risk: "write",
    defaultPolicy: "auto", // only touches the employee's own folder
    summarize: (i) => `write ${i.path} (${i.content.length} chars)`,
    async execute(input, ctx) {
      const { full } = safePath(ctx, input.path);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, input.content);
      return { saved: full };
    },
  }),
];

// ── memory ─────────────────────────────────────────────────────────────────
const memory: ToolDef[] = [
  define({
    name: "memory_save",
    description:
      "Remember a durable fact for future work: a preference, a decision, a fact about the company, a contact. One short sentence. Not for temporary task state.",
    input: z.object({ fact: z.string() }),
    risk: "read",
    async execute({ fact }, ctx) {
      return ctx.runtime.memoryFor(ctx.hire).save(fact);
    },
  }),
  define({
    name: "memory_update",
    description: "Replace every remembered fact that contains the given text with one new fact: to correct it, or to merge several into one.",
    input: z.object({ match: z.string(), fact: z.string() }),
    risk: "read",
    async execute({ match, fact }, ctx) {
      return ctx.runtime.memoryFor(ctx.hire).update(match, fact);
    },
  }),
  define({
    name: "memory_search",
    description: "Find remembered facts that contain all the given words, including any not shown in your prompt.",
    input: z.object({ query: z.string() }),
    risk: "read",
    async execute({ query }, ctx) {
      return ctx.runtime.memoryFor(ctx.hire).search(query).slice(0, 50);
    },
  }),
  define({
    name: "team_memory_save",
    description: "Remember a fact for every employee: the company, its products, how the user wants work done. One short sentence. Give `replaces` to swap out the team facts that contain that text.",
    input: z.object({ fact: z.string(), replaces: z.string().optional() }),
    risk: "write", // it reaches every employee's prompt, so the user sees it first
    summarize: (i) => `tell every employee to remember: ${i.fact}${i.replaces ? ` (instead of what mentions "${i.replaces}")` : ""}`,
    async execute({ fact, replaces }, ctx) {
      return replaces ? ctx.runtime.teamMemory().update(replaces, fact) : ctx.runtime.teamMemory().save(fact);
    },
  }),
  define({
    name: "memory_forget",
    description: "Forget remembered facts that contain the given text (when something is wrong or outdated).",
    input: z.object({ match: z.string() }),
    risk: "read",
    async execute({ match }, ctx) {
      return { removed: ctx.runtime.memoryFor(ctx.hire).forget(match) };
    },
  }),
];

// ── web ────────────────────────────────────────────────────────────────────
export function htmlToText(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<(br|p|div|li|h[1-6]|tr)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

const webFetch = define({
  name: "web_fetch",
  description: "Fetch a public web page and return its readable text.",
  input: z.object({ url: z.string().url() }),
  risk: "read",
  async execute({ url }, ctx) {
    const res = await fetchPublic(url, {
      headers: { "user-agent": "dude-agent/0.1 (+https://github.com/)" },
      signal: ctx.signal,
    });
    const text = res.contentType.includes("html") ? htmlToText(res.body) : res.body;
    return { status: res.status, url: res.url, text: text.slice(0, MAX_TEXT) };
  },
});

type SearchResult = { title: string; url: string; snippet: string };

async function searchBrave(q: string, key: string): Promise<SearchResult[]> {
  const res = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=8`, {
    headers: { "X-Subscription-Token": key, accept: "application/json" },
  });
  const data: any = await res.json();
  return (data.web?.results ?? []).map((r: any) => ({ title: r.title, url: r.url, snippet: htmlToText(r.description ?? "") }));
}

async function searchTavily(q: string, key: string): Promise<SearchResult[]> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ query: q, max_results: 8 }),
  });
  const data: any = await res.json();
  return (data.results ?? []).map((r: any) => ({ title: r.title, url: r.url, snippet: r.content ?? "" }));
}

async function searchDuckDuckGo(q: string): Promise<SearchResult[]> {
  const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, {
    headers: { "user-agent": "Mozilla/5.0 (compatible; dude-agent/0.1)" },
  });
  const html = await res.text();
  const out: SearchResult[] = [];
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  for (const m of html.matchAll(re)) {
    let url = m[1];
    const uddg = url.match(/uddg=([^&]+)/);
    if (uddg) url = decodeURIComponent(uddg[1]);
    out.push({ title: htmlToText(m[2]), url, snippet: htmlToText(m[3]) });
    if (out.length >= 8) break;
  }
  return out;
}

const webSearch = define({
  name: "web_search",
  description: "Search the web. Returns titles, URLs and snippets; use web_fetch to read a result.",
  input: z.object({ query: z.string() }),
  risk: "read",
  async execute({ query }) {
    const env = process.env;
    if (env.BRAVE_API_KEY) return searchBrave(query, env.BRAVE_API_KEY);
    if (env.TAVILY_API_KEY) return searchTavily(query, env.TAVILY_API_KEY);
    return searchDuckDuckGo(query);
  },
});

// ── skills: playbooks loaded only when needed (Agent Skills format) ────────
const skills: ToolDef[] = [
  define({
    name: "use_skill",
    description:
      "Load a skill (a step-by-step playbook) by name before doing that kind of work. Follow it. It may list bundled files to read with read_skill_file.",
    input: z.object({ name: z.string() }),
    risk: "read",
    async execute({ name }, ctx) {
      const all = ctx.runtime.skillsFor(ctx.pack);
      const skill = all.find((s) => s.name === name);
      if (!skill) return { error: `No skill "${name}". Available: ${all.map((s) => s.name).join(", ")}` };
      return renderSkill(skill);
    },
  }),
  define({
    name: "read_skill_file",
    description: "Read a file bundled with a skill (references/…, templates, examples), when the skill's steps point to it.",
    input: z.object({ skill: z.string(), path: z.string() }),
    risk: "read",
    async execute({ skill, path: rel }, ctx) {
      const s = ctx.runtime.skillsFor(ctx.pack).find((x) => x.name === skill);
      if (!s) return { error: `No skill "${skill}"` };
      return readSkillFile(s, rel);
    },
  }),
  define({
    name: "skill_save",
    description:
      "Save how you did a task as a skill, so you and your teammates can repeat it: when to use it, the steps, and what to check. Saving an existing name replaces that workspace skill.",
    input: z.object({
      name: z.string().describe("short kebab-case name, e.g. weekly-report"),
      description: z.string().describe("one sentence: what it does and when to use it"),
      steps: z.string().describe("the playbook in Markdown"),
    }),
    risk: "write",
    summarize: (i) => `save the skill "${i.name}" for the whole team: ${i.description}`,
    async execute(input, ctx) {
      const { updated } = saveSkill(ctx.runtime.home, { ...input, author: ctx.hire.name });
      ctx.runtime.reloadSkills();
      return { [updated ? "updated" : "saved"]: input.name };
    },
  }),
];

// ── open work: what the employee still has to do ───────────────────────────
const work: ToolDef[] = [
  define({
    name: "work_add",
    description: "Add something to your open work: a task you started and will finish later, or a follow-up you promised.",
    input: z.object({ text: z.string() }),
    risk: "read",
    async execute({ text }, ctx) {
      const item = ctx.runtime.store.addWork(ctx.hire.id, text);
      ctx.runtime.emit({ type: "work-changed", hireId: ctx.hire.id });
      return { id: item.id };
    },
  }),
  define({
    name: "work_done",
    description: "Mark one of your open work items as done, by its id.",
    input: z.object({ id: z.string() }),
    risk: "read",
    async execute({ id }, ctx) {
      const ok = ctx.runtime.store.setWork(ctx.hire.id, id, "done");
      ctx.runtime.emit({ type: "work-changed", hireId: ctx.hire.id });
      return ok ? { done: true } : { error: `No open work "${id}"` };
    },
  }),
  define({
    name: "work_list",
    description: "List your open work.",
    input: z.object({}),
    risk: "read",
    async execute(_i, ctx) {
      return ctx.runtime.store.work(ctx.hire.id, "open").map((w) => ({ id: w.id, text: w.text, since: w.createdAt.slice(0, 10) }));
    },
  }),
];

// ── asking the user ────────────────────────────────────────────────────────
const askUser = define({
  name: "ask_user",
  description:
    "Ask the user a question when you cannot continue without their answer. Do not use for things you can decide or look up yourself.",
  input: z.object({ question: z.string() }),
  risk: "read",
  async execute({ question }, ctx) {
    const answer = await ctx.runtime.ask(ctx.hire, question, ctx);
    return answer ?? "The user is not available right now. Proceed with your best judgment and state your assumptions.";
  },
});

// ── teammates ──────────────────────────────────────────────────────────────
const team: ToolDef[] = [
  define({
    name: "list_teammates",
    description: "List the other employees on the team and what they do.",
    input: z.object({}),
    risk: "read",
    async execute(_input, ctx) {
      return ctx.runtime
        .listHires()
        .filter((h) => h.id !== ctx.hire.id)
        .map((h) => ({ name: h.name, role: ctx.runtime.packFor(h)?.title ?? h.packId }));
    },
  }),
  define({
    name: "send_to_teammate",
    description:
      "Hand a request to a teammate (e.g. ask the content creator for a draft) and get their reply. Give them everything they need in the message.",
    input: z.object({ name: z.string(), message: z.string() }),
    risk: "read",
    async execute({ name, message }, ctx) {
      const target = ctx.runtime.findHire(name);
      if (!target) return { error: `No teammate named ${name}` };
      if (ctx.chain.includes(target.id)) return { error: `${target.name} is already part of this conversation; reply instead.` };
      return ctx.runtime.delegate(ctx, target, message);
    },
  }),
];

// ── routines: recurring work the employee schedules itself ─────────────────
const routines: ToolDef[] = [
  define({
    name: "routine_list",
    description: "List your recurring routines.",
    input: z.object({}),
    risk: "read",
    async execute(_i, ctx) {
      return ctx.runtime.store.routines(ctx.hire.id).map(({ hookKey: _secret, ...r }) => r);
    },
  }),
  define({
    name: "routine_add",
    description:
      "Schedule recurring work for yourself with a cron expression (minute hour day month weekday), e.g. '0 9 * * 1' for Mondays 9:00.",
    input: z.object({
      id: z.string().regex(/^[a-z0-9-]+$/).describe("short kebab-case id"),
      cron: z.string(),
      prompt: z.string().describe("What to do each time, written as an instruction to yourself"),
    }),
    risk: "write",
    summarize: (i) => `schedule "${i.id}" at ${i.cron}: ${i.prompt}`,
    async execute(input, ctx) {
      new Cron(input.cron, { paused: true }).stop(); // validates the expression
      ctx.runtime.store.upsertRoutine({ ...input, hireId: ctx.hire.id, enabled: true, source: "user", lastRunAt: null });
      ctx.runtime.emit({ type: "routines-changed" });
      return { scheduled: input.id };
    },
  }),
  define({
    name: "routine_remove",
    description: "Delete one of your routines.",
    input: z.object({ id: z.string() }),
    risk: "write",
    async execute({ id }, ctx) {
      const removed = ctx.runtime.store.removeRoutine(ctx.hire.id, id);
      ctx.runtime.emit({ type: "routines-changed" });
      return { removed };
    },
  }),
];

/** Tool groups a pack can list under `tools:`. */
export const TOOL_GROUPS: Record<string, ToolDef[]> = {
  files,
  memory,
  work,
  web_search: [webSearch],
  web_fetch: [webFetch],
  web: [webSearch, webFetch],
  skills,
  ask_user: [askUser],
  team,
  routines,
  phone: phoneTools,
  media: mediaTools,
  shell: shellTools,
  video: videoTools,
  social: socialTools,
};

/** Every employee gets these, whatever the pack lists. */
export const ALWAYS_ON = ["memory", "work", "skills", "ask_user", "team", "files"];
