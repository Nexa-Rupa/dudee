import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { jsonSchema, stepCountIs, streamText, tool, type LanguageModel, type ModelMessage, type ToolSet } from "ai";
import { Memory } from "./memory.js";
import { McpHub } from "./mcp.js";
import { loadSecrets, resolveModel, setCustomProviders } from "./providers.js";
import { renderSkill, sharedSkills } from "./skills.js";
import { costOf, monthStart } from "./pricing.js";
import { loadPacks } from "./packs.js";
import { Store } from "./store.js";
import { ALWAYS_ON, TOOL_GROUPS } from "./tools/builtin.js";
import { browserPolicy, browserServer, changesScreen } from "./tools/browser.js";
import { hireDir, loadConfig } from "./workspace.js";
import { Vault } from "./vault.js";
import { Composio, composioKey, composioPolicy } from "./composio.js";
import type { McpSource } from "./mcp.js";
import type {
  ApprovalDecision,
  ApprovalHandler,
  AskHandler,
  SkillSpec,
  DudeConfig,
  EmployeePack,
  Hire,
  Policy,
  Row,
  RuntimeEvent,
  StoredRow,
  ToolContext,
  ToolDef,
  UsageRecord,
} from "./types.js";

export interface RuntimeOptions {
  /** Folders holding employee packs, in priority order (later wins). */
  packDirs: string[];
  /** Called when a tool needs the user's OK. Without one, such tools are refused. */
  approve?: ApprovalHandler;
  /** Called when an employee asks the user a question. */
  ask?: AskHandler;
  /** Billing seam: called after every turn with token usage. */
  meter?: (u: UsageRecord) => void | Promise<void>;
  /** Override model resolution (tests, gateways, the cloud's metered proxy). */
  resolveModel?: (id: string) => LanguageModel;
  config?: DudeConfig;
  /** Start a browser for packs that list `browser`. Default true; tests turn it off. */
  browser?: boolean;
}

export interface SendOptions {
  /** Who is speaking: a teammate's name, "routine:<id>", or undefined for the user. */
  from?: string;
  chain?: string[];
  signal?: AbortSignal;
}

const HISTORY_ROWS = 40;

/**
 * The runtime runs a team of employees. One serial queue per employee; every step of a
 * turn becomes a transcript row and an event, so a CLI, a web UI or the cloud can follow along.
 */
export class Runtime {
  readonly store: Store;
  readonly config: DudeConfig;
  readonly packs: Map<string, EmployeePack>;
  private mcp: McpHub;
  /** Saved logins for social accounts and sites, encrypted on disk. */
  readonly vault: Vault;
  /** Connected apps (OAuth) through Composio. */
  readonly composio: Composio;
  /** Until when each employee may publish an approved post without further prompts. */
  private postingWindows = new Map<string, number>();
  private listeners = new Set<(e: RuntimeEvent) => void>();
  private queues = new Map<string, Promise<unknown>>();
  /** Latest browser screenshot per employee, for the Screen panel. */
  readonly screens = new Map<string, { mime: string; data: string; at: string }>();

  constructor(
    readonly home: string,
    private opts: RuntimeOptions
  ) {
    fs.mkdirSync(home, { recursive: true });
    this.config = opts.config ?? loadConfig(home);
    loadSecrets(home);
    setCustomProviders(this.config.providers);
    this.packs = loadPacks([...opts.packDirs, ...this.config.packDirs.map((d) => path.resolve(home, d))]);
    this.reloadSkills();
    this.store = new Store(path.join(home, "dude.db"));
    this.mcp = new McpHub(this.config.mcpServers);
    this.vault = new Vault(home);
    this.composio = new Composio(home);
  }

  // ── events ───────────────────────────────────────────────────────────────
  on(listener: (e: RuntimeEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(e: RuntimeEvent) {
    for (const l of this.listeners) l(e);
  }

  private record(hireId: string, row: Row): StoredRow {
    const stored = this.store.appendRow(hireId, row);
    this.emit({ type: "row", hireId, row: stored });
    return stored;
  }

  // ── team ─────────────────────────────────────────────────────────────────
  listHires() {
    return this.store.listHires();
  }

  findHire(ref: string) {
    return this.store.findHire(ref);
  }

  packFor(hire: Hire) {
    return this.packs.get(hire.packId);
  }

  // ── skills ───────────────────────────────────────────────────────────────
  private shared: SkillSpec[] = [];

  /** Re-scan shared skill folders (workspace, project, global). */
  reloadSkills() {
    this.shared = sharedSkills({ home: this.home, dirs: this.config.skillDirs, global: this.config.globalSkills });
  }

  /** Every skill an employee can use: shared ones plus the pack's own (which win on name). */
  skillsFor(pack: EmployeePack): SkillSpec[] {
    const byName = new Map<string, SkillSpec>();
    for (const s of this.shared) byName.set(s.name, s);
    for (const s of pack.skills) byName.set(s.name, s);
    return [...byName.values()];
  }

  /** `/skill-name args` runs a skill directly, like a slash command in Claude Code. */
  private expandCommand(pack: EmployeePack, text: string): string {
    const m = text.match(/^\/([a-zA-Z0-9][\w:.-]*)(?:\s+([\s\S]*))?$/);
    if (!m) return text;
    const skill = this.skillsFor(pack).find((s) => s.name === m[1] && s.userInvocable !== false);
    if (!skill) return text;
    const args = m[2]?.trim();
    return `The user ran /${skill.name}${args ? ` ${args}` : ""}. Do it now, following this skill.\n\n${renderSkill(skill, args)}`;
  }

  private workspaceInstructions() {
    const file = path.join(this.home, "AGENTS.md");
    return fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim().slice(0, 12_000) : "";
  }

  filesDir(hire: Hire) {
    return path.join(hireDir(this.home, hire.id), "files");
  }

  memoryFor(hire: Hire) {
    return new Memory(hireDir(this.home, hire.id));
  }

  hire(packId: string, opts: { name?: string; model?: string; budgetUsd?: number | null } = {}): Hire {
    const pack = this.packs.get(packId);
    if (!pack) throw new Error(`No employee pack "${packId}". Available: ${[...this.packs.keys()].join(", ")}`);
    const name = (opts.name ?? pack.defaultName).trim();
    if (this.findHire(name)) throw new Error(`Someone named ${name} already works here. Pick another name.`);
    const hire: Hire = {
      id: randomUUID().slice(0, 8),
      name,
      packId,
      model: opts.model ?? null,
      createdAt: new Date().toISOString(),
      paused: false,
      budgetUsd: opts.budgetUsd ?? null,
    };
    this.store.addHire(hire);
    fs.mkdirSync(this.filesDir(hire), { recursive: true });
    for (const r of pack.routines) {
      this.store.upsertRoutine({ ...r, hireId: hire.id, enabled: r.enabled ?? false, source: "pack", lastRunAt: null });
    }
    this.emit({ type: "routines-changed" });
    this.emit({ type: "team-changed" });
    return hire;
  }

  async fire(ref: string) {
    const hire = this.findHire(ref);
    if (!hire) throw new Error(`No employee named ${ref}`);
    await this.mcp.closeKey(`browser:${hire.id}`);
    this.store.removeHire(hire.id);
    for (const a of this.store.socialAccounts()) if (a.hireId === hire.id) this.store.saveSocialAccount({ ...a, hireId: null });
    this.screens.delete(hire.id);
    // On Windows the browser can hold its profile for a moment after closing; retry briefly.
    try {
      fs.rmSync(hireDir(this.home, hire.id), { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    } catch {
      /* leftover files are harmless; the employee is already removed */
    }
    this.emit({ type: "routines-changed" });
    this.emit({ type: "team-changed" });
  }

  modelFor(hire: Hire, pack: EmployeePack) {
    return hire.model ?? pack.model ?? this.config.model;
  }

  // ── budgets and pausing ──────────────────────────────────────────────────
  /** Spend this calendar month for one employee, or the whole team. */
  spendThisMonth(hireId?: string) {
    return this.store.spendSince(monthStart(), hireId);
  }

  setPaused(ref: string, paused: boolean, reason?: string) {
    const hire = this.findHire(ref);
    if (!hire) throw new Error(`No employee named ${ref}`);
    this.store.setHirePaused(hire.id, paused);
    this.record(hire.id, { kind: "notice", text: paused ? `Paused${reason ? `: ${reason}` : "."}` : "Back at work." });
    this.emit({ type: "team-changed" });
  }

  setBudget(ref: string, budgetUsd: number | null) {
    const hire = this.findHire(ref);
    if (!hire) throw new Error(`No employee named ${ref}`);
    if (budgetUsd !== null && (!Number.isFinite(budgetUsd) || budgetUsd < 0)) throw new Error("A budget must be a positive amount");
    this.store.setHireBudget(hire.id, budgetUsd);
    this.emit({ type: "team-changed" });
  }

  /** Why an employee can't work right now, or null. */
  private blockedReason(hire: Hire): string | null {
    if (hire.paused) return `${hire.name} is paused. Resume them to give them work.`;
    if (hire.budgetUsd !== null && this.spendThisMonth(hire.id).usd >= hire.budgetUsd) {
      this.store.setHirePaused(hire.id, true);
      this.emit({ type: "team-changed" });
      return `${hire.name} reached their $${hire.budgetUsd} monthly budget and is paused.`;
    }
    if (this.config.budgetUsd !== null && this.spendThisMonth().usd >= this.config.budgetUsd) {
      return `The team reached its $${this.config.budgetUsd} monthly budget. Raise it in Settings to continue.`;
    }
    return null;
  }

  /** After a turn: warn at 80% of a budget, pause at 100%. */
  private checkBudgetAfter(hire: Hire, before: number, after: number) {
    const fresh = this.findHire(hire.id);
    const limit = fresh?.budgetUsd ?? null;
    if (limit === null || limit <= 0) return;
    if (after >= limit) {
      this.store.setHirePaused(hire.id, true);
      this.record(hire.id, {
        kind: "notice",
        text: `Paused: reached the $${limit} monthly budget ($${after.toFixed(2)} spent). Raise the budget or resume to continue.`,
      });
      this.emit({ type: "team-changed" });
    } else if (before < limit * 0.8 && after >= limit * 0.8) {
      this.record(hire.id, { kind: "notice", text: `Heads up: $${after.toFixed(2)} of the $${limit} monthly budget used.` });
    }
  }

  /** Run one routine right away (the "Run now" button, or a webhook). */
  runRoutine(ref: string, routineId: string): Promise<string> {
    const hire = this.findHire(ref);
    if (!hire) return Promise.reject(new Error(`No employee named ${ref}`));
    const routine = this.store.routines(hire.id).find((r) => r.id === routineId);
    if (!routine) return Promise.reject(new Error(`${hire.name} has no routine "${routineId}"`));
    this.store.markRoutineRun(hire.id, routine.id);
    return this.send(hire.id, routine.prompt, { from: `routine:${routine.id}` });
  }

  // ── turns ────────────────────────────────────────────────────────────────
  /** Send a message to an employee and resolve with their final reply. Turns per employee run one at a time. */
  send(ref: string, text: string, opts: SendOptions = {}): Promise<string> {
    const hire = this.findHire(ref);
    if (!hire) return Promise.reject(new Error(`No employee named ${ref}`));
    const prev = this.queues.get(hire.id) ?? Promise.resolve();
    // Re-read the employee when the turn starts, so pausing or a new budget applies to queued work.
    const next = prev.catch(() => {}).then(() => this.turn(this.findHire(hire.id) ?? hire, text, opts));
    this.queues.set(hire.id, next);
    return next;
  }

  private async turn(hire: Hire, text: string, opts: SendOptions): Promise<string> {
    const pack = this.packFor(hire);
    if (!pack) throw new Error(`${hire.name}'s pack "${hire.packId}" is not installed`);
    const blocked = this.blockedReason(hire);
    if (blocked) {
      this.record(hire.id, { kind: "notice", text: blocked });
      throw new Error(blocked);
    }
    const spentBefore = hire.budgetUsd !== null ? this.spendThisMonth(hire.id).usd : 0;

    const history = this.history(hire.id);
    this.record(hire.id, { kind: "message", role: "user", text, from: opts.from });
    this.emit({ type: "status", hireId: hire.id, status: "working" });

    const ctx: ToolContext = { hire, pack, runtime: this, chain: opts.chain ?? [], signal: opts.signal };
    const modelId = this.modelFor(hire, pack);
    const started = new Map<string, number>();
    let reply = "";

    try {
      const model = (this.opts.resolveModel ?? resolveModel)(modelId);
      const tools = await this.buildTools(ctx);
      const result = streamText({
        model,
        system: this.systemPrompt(hire, pack),
        messages: [...history, { role: "user", content: speaker(opts.from, this.expandCommand(pack, text)) }],
        tools,
        stopWhen: stepCountIs(this.config.maxSteps),
        abortSignal: opts.signal,
      });

      for await (const part of result.fullStream) {
        switch (part.type) {
          case "text-delta":
            reply += part.text;
            this.emit({ type: "delta", hireId: hire.id, text: part.text });
            break;
          case "tool-call":
            started.set(part.toolCallId, Date.now());
            this.emit({ type: "status", hireId: hire.id, status: "tool", detail: part.toolName });
            break;
          case "tool-result":
            this.record(hire.id, {
              kind: "tool",
              tool: part.toolName,
              input: part.input,
              output: clip(this.vault.redact(part.output)),
              ms: Date.now() - (started.get(part.toolCallId) ?? Date.now()),
            });
            this.emit({ type: "status", hireId: hire.id, status: "working" });
            break;
          case "tool-error":
            this.record(hire.id, {
              kind: "tool",
              tool: part.toolName,
              input: part.input,
              error: errorText(part.error),
              ms: Date.now() - (started.get(part.toolCallId) ?? Date.now()),
            });
            break;
          case "finish-step":
            // keep a visible break between text written before and after tool calls
            if (reply && !reply.endsWith("\n\n")) {
              const gap = reply.endsWith("\n") ? "\n" : "\n\n";
              reply += gap;
              this.emit({ type: "delta", hireId: hire.id, text: gap });
            }
            break;
          case "finish": {
            const inputTokens = part.totalUsage.inputTokens ?? 0;
            const outputTokens = part.totalUsage.outputTokens ?? 0;
            const usage: UsageRecord = {
              hireId: hire.id,
              model: modelId,
              inputTokens,
              outputTokens,
              costUsd: costOf(modelId, inputTokens, outputTokens, this.config),
            };
            this.store.recordUsage(usage);
            this.emit({ type: "usage", ...usage });
            await this.opts.meter?.(usage);
            if (usage.costUsd) this.checkBudgetAfter(hire, spentBefore, spentBefore + usage.costUsd);
            break;
          }
          case "error":
            throw part.error;
        }
      }
    } catch (err) {
      this.record(hire.id, { kind: "notice", text: `Turn failed: ${errorText(err)}` });
      this.emit({ type: "status", hireId: hire.id, status: "idle" });
      throw err;
    }

    reply = reply.trim();
    this.record(hire.id, { kind: "message", role: "assistant", text: reply });
    this.emit({ type: "status", hireId: hire.id, status: "idle" });
    return reply;
  }

  private history(hireId: string): ModelMessage[] {
    const msgs: ModelMessage[] = [];
    for (const { row } of this.store.rows(hireId, HISTORY_ROWS)) {
      if (row.kind !== "message" || !row.text) continue;
      msgs.push(
        row.role === "user" ? { role: "user", content: speaker(row.from, row.text) } : { role: "assistant", content: row.text }
      );
    }
    while (msgs.length && msgs[0].role !== "user") msgs.shift();
    return msgs;
  }

  systemPrompt(hire: Hire, pack: EmployeePack): string {
    const c = this.config.company;
    const company = c.name ?? "the company";
    const teammates = this.listHires()
      .filter((h) => h.id !== hire.id)
      .map((h) => `- ${h.name}: ${this.packFor(h)?.title ?? h.packId}`);
    const memory = this.memoryFor(hire).read();
    const parts = [
      `You are ${hire.name}, the ${pack.title} at ${company}. You are an AI employee: you do the work, not just advise on it.`,
      pack.instructions,
      [
        "## How you work",
        "- Do the task with your tools, then report briefly what you did and what you found. Lead with the result.",
        "- Save deliverables (drafts, plans, reports, scripts) with files_write and mention the file name.",
        "- Save durable facts you learn about the company, people and preferences with memory_save.",
        "- Some actions need the user's approval; the system asks them for you. If they decline, do not retry the same action.",
        "- Ask the user only when you truly cannot proceed; otherwise make a reasonable call and state your assumption.",
        "- Never invent numbers, quotes, customers or results. Say what you could not verify.",
        pack.tools.includes("browser")
          ? "- You have your own browser (browser_* tools). Use web_fetch for plain reading; use the browser for pages that need scrolling, clicks, forms or a login. The user can watch your screen. If a site needs the user to sign in, ask them to sign in on your screen, then continue."
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
      c.name || c.website || c.about
        ? ["## Company", c.name && `Name: ${c.name}`, c.website && `Website: ${c.website}`, c.about].filter(Boolean).join("\n")
        : "",
      this.config.goals.length
        ? ["## Company goals (connect your work to these and say which one it serves)", ...this.config.goals.map((g) => `- ${g}`)].join("\n")
        : "",
      this.workspaceInstructions() ? `## Workspace instructions\n${this.workspaceInstructions()}` : "",
      skillList(this.skillsFor(pack)),
      teammates.length ? ["## Teammates (reach them with send_to_teammate)", ...teammates].join("\n") : "",
      memory ? `## What you remember\n${memory}` : "",
      `Today is ${new Date().toISOString().slice(0, 10)}.`,
    ];
    return parts.filter(Boolean).join("\n\n");
  }

  // ── tools & approvals ────────────────────────────────────────────────────
  private async buildTools(ctx: ToolContext): Promise<ToolSet> {
    const defs = new Map<string, ToolDef>();
    for (const group of new Set([...ALWAYS_ON, ...ctx.pack.tools, ...this.config.extraTools])) {
      if (group === "browser") continue; // an MCP server, connected below
      const list = TOOL_GROUPS[group];
      if (!list) {
        this.record(ctx.hire.id, { kind: "notice", text: `Unknown tool group "${group}" in pack ${ctx.pack.id}` });
        continue;
      }
      for (const d of list) defs.set(d.name, d);
    }
    const hireId = ctx.hire.id;
    const extra: McpSource[] = [];
    if (this.hasBrowser(ctx.pack)) extra.push(this.browserSource(hireId));
    const apps = await this.composioSource(ctx.hire);
    if (apps) extra.push(apps);
    const mcpTools = await this.mcp.toolsFor(
      ctx.hire,
      (server, err) =>
        this.record(ctx.hire.id, {
          kind: "notice",
          text:
            server === "browser"
              ? `Could not start the browser (${errorText(err)}). It needs npx and Chrome; set DUDE_BROWSER=chromium after running "npx playwright install chromium" to use Playwright's own browser.`
              : `Could not reach app server "${server}": ${errorText(err)}`,
        }),
      extra
    );
    for (const d of mcpTools) defs.set(d.name, d);

    const set: ToolSet = {};
    for (const def of defs.values()) {
      if (this.policyFor(ctx, def) === "deny") continue;
      set[def.name] = tool({
        description: def.description,
        inputSchema: "jsonSchema" in def.input ? jsonSchema(def.input.jsonSchema as any) : (def.input as any),
        execute: (input: unknown) => this.runTool(def, input, ctx),
      } as any);
    }
    return set;
  }

  policyFor(ctx: ToolContext, def: ToolDef, input?: unknown): Policy {
    const configured = this.config.approvals[def.name] ?? ctx.pack.approvals[def.name];
    if (configured === "deny") return "deny";
    if (def.alwaysAsk) return "ask";
    if (input !== undefined) {
      const dynamic = def.dynamicPolicy?.(input as any, ctx);
      if (dynamic) return dynamic;
    }
    // An approved post may be published without a prompt for every click it takes.
    if (this.postingOpen(ctx.hire.id) && postingTool(def.name) && (def.defaultPolicy ?? "ask") !== "deny") return "auto";
    return (
      this.store.getPolicy(ctx.hire.id, def.name) ??
      configured ??
      def.defaultPolicy ??
      (def.risk === "read" ? "auto" : "ask")
    );
  }

  private async runTool(def: ToolDef, input: unknown, ctx: ToolContext): Promise<unknown> {
    if (this.policyFor(ctx, def, input) === "ask") {
      const summary = def.summarize?.(input as any) ?? `${def.name} ${JSON.stringify(input).slice(0, 300)}`;
      let decision: ApprovalDecision = "deny";
      if (this.opts.approve) decision = await this.opts.approve({ hire: ctx.hire, tool: def.name, input, summary });
      this.record(ctx.hire.id, { kind: "approval", tool: def.name, summary, decision });
      if (decision === "always" && !def.alwaysAsk) this.store.setPolicy(ctx.hire.id, def.name, "auto");
      if (decision === "deny") {
        return {
          refused: true,
          message: this.opts.approve
            ? "The user did not allow this action. Do not retry it; continue without it or tell the user what you need."
            : "This action needs the user's approval and nobody is available to approve it now. Do not retry; tell the user what you wanted to do so they can approve it in chat.",
        };
      }
    }
    try {
      // Saved passwords never reach the model or the transcript, whatever a page echoes back.
      return this.vault.redact(await def.execute(input, ctx));
    } catch (err) {
      return { error: this.vault.redact(errorText(err)) };
    }
  }

  // ── browser, connected apps and posting ──────────────────────────────────
  private hasBrowser(pack: EmployeePack) {
    return pack.tools.includes("browser") && this.opts.browser !== false;
  }

  private browserSource(hireId: string): McpSource {
    return {
      name: "browser",
      key: `browser:${hireId}`,
      config: browserServer(hireDir(this.home, hireId)),
      bareNames: true,
      policy: browserPolicy,
      after: (toolName: string, client: any) => {
        if (changesScreen(toolName)) void this.captureScreen(hireId, client);
      },
    };
  }

  /** Call a tool on an employee's own browser from inside the runtime (vault_fill types secrets this way). */
  async browserCall(hire: Hire, tool: string, args: Record<string, unknown>) {
    const pack = this.packFor(hire);
    if (!pack || !this.hasBrowser(pack)) throw new Error(`${hire.name} has no browser`);
    const client = await this.mcp.client(this.browserSource(hire.id));
    const res: any = await client.callTool({ name: tool, arguments: args });
    if (changesScreen(tool)) void this.captureScreen(hire.id, client as any);
    if (res?.isError) throw new Error(this.vault.redact(JSON.stringify(res.content ?? res).slice(0, 500)));
    return this.vault.redact(res?.structuredContent ?? res?.content);
  }

  /** Composio's MCP endpoint as `apps__*` tools, when a key is set. Makes the session on first use. */
  private async composioSource(hire: Hire): Promise<McpSource | null> {
    if (!composioKey()) return null;
    const allow = this.config.composioHires ?? [];
    if (allow.length && !allow.includes(hire.id) && !allow.includes(hire.name)) return null;
    let mcp = this.composio.cachedMcp();
    if (!mcp) {
      try {
        await this.composio.session();
        mcp = this.composio.cachedMcp();
      } catch (err) {
        this.record(hire.id, { kind: "notice", text: `Connected apps are unavailable: ${errorText(err)}` });
        return null;
      }
    }
    if (!mcp) return null;
    return { name: "apps", key: `composio:${mcp.url}`, config: { url: mcp.url, headers: mcp.headers }, policy: composioPolicy };
  }

  /** Drop cached app connections (after the Composio key or session changes). */
  async resetConnections() {
    const mcp = this.composio.cachedMcp();
    if (mcp) await this.mcp.closeKey(`composio:${mcp.url}`);
    this.emit({ type: "connections-changed" });
  }

  openPostingWindow(hireId: string, ms: number) {
    this.postingWindows.set(hireId, Date.now() + ms);
  }

  closePostingWindow(hireId: string) {
    this.postingWindows.delete(hireId);
  }

  postingOpen(hireId: string) {
    const until = this.postingWindows.get(hireId);
    if (!until) return false;
    if (Date.now() > until) {
      this.postingWindows.delete(hireId);
      return false;
    }
    return true;
  }

  /** Grab a screenshot after a browser step so front ends can show the employee's screen. */
  private async captureScreen(hireId: string, client: { callTool: (p: any) => Promise<any> }) {
    try {
      const res = await client.callTool({ name: "browser_take_screenshot", arguments: { type: "jpeg" } });
      const image = (res.content ?? []).find((c: any) => c.type === "image");
      if (!image) return;
      const shot = { mime: image.mimeType ?? "image/jpeg", data: image.data as string, at: new Date().toISOString() };
      this.screens.set(hireId, shot);
      this.emit({ type: "screen", hireId, ...shot });
    } catch {
      /* the page may be mid-navigation; the next step will try again */
    }
  }

  // ── conveniences for front ends ──────────────────────────────────────────
  ask(hire: Hire, question: string) {
    return this.opts.ask ? this.opts.ask(hire, question) : Promise.resolve(null);
  }

  async close() {
    await Promise.allSettled([...this.queues.values()]);
    await this.mcp.close();
    this.store.close();
  }
}

/** Tools an employee needs to publish an approved post: its browser, the saved login, connected apps. */
function postingTool(name: string) {
  return name.startsWith("browser_") || name === "vault_fill" || name.startsWith("apps__");
}

function skillList(skills: SkillSpec[]) {
  if (!skills.length) return "";
  const own = skills.filter((s) => s.source === "pack");
  const shared = skills.filter((s) => s.source !== "pack");
  const line = (s: SkillSpec) => `- ${s.name}: ${s.description.replace(/\s+/g, " ").slice(0, 300)}`;
  return [
    "## Skills",
    "Before doing work a skill covers, load it with use_skill and follow it. Skills may mention tools you do not have; use the closest tool you do have, or say what is missing.",
    ...own.map(line),
    ...(shared.length ? ["Shared skills:", ...shared.map(line)] : []),
  ].join("\n");
}

function speaker(from: string | undefined, text: string) {
  return from ? `[from ${from}] ${text}` : text;
}

function clip(value: unknown) {
  const s = typeof value === "string" ? value : JSON.stringify(value);
  if (s === undefined) return value;
  return s.length > 4000 ? `${s.slice(0, 4000)}…` : value;
}

export function errorText(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}
