import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import {
  MEDIA_PROVIDERS,
  Runtime,
  Scheduler,
  allProviders,
  errorText,
  getProvider,
  isConfigured,
  keySource,
  listModels,
  maskKey,
  parseModelId,
  saveConfig,
  setSecret,
  exportTeam,
  importTeam,
  priceFor,
  type ApprovalDecision,
  type Hire,
  type Memory,
  type RuntimeEvent,
  type RuntimeOptions,
} from "@dude/core";
import { TelegramBridge } from "./telegram.js";
import { handleConnections } from "./connections.js";

export interface ServerOptions {
  home: string;
  packDirs: string[];
  port?: number;
  host?: string;
  /** Built web app to serve at /. Optional (in development Vite serves it). */
  webDir?: string;
  /** Secret the browser must send. Random per run unless given. */
  token?: string;
  /** Extra runtime options (tests pass a scripted model here). */
  runtime?: Partial<RuntimeOptions>;
  /** Run scheduled routines. Default true. */
  scheduler?: boolean;
  /** Extra Host names accepted when listening beyond loopback ("*" for any). */
  allowedHosts?: string[];
  /** Run the Telegram bridge when TELEGRAM_BOT_TOKEN is set. Default true; tests turn it off. */
  telegram?: boolean;
  /** Demo mode: a scripted stand-in model answers; the app says so on every screen. */
  demo?: boolean;
  log?: (line: string) => void;
}

interface PendingApproval {
  id: string;
  hireId: string;
  tool: string;
  summary: string;
  input: unknown;
  at: string;
  resolve: (d: ApprovalDecision) => void;
}

interface PendingQuestion {
  id: string;
  hireId: string;
  question: string;
  at: string;
  resolve: (answer: string | null) => void;
}

export interface Live {
  status: "working" | "tool" | "idle";
  detail?: string;
  since: string;
  text: string;
}

/**
 * The local server behind the web app: JSON API, one Server-Sent Events stream with every
 * runtime event, and approvals and questions held as cards until someone answers them.
 * Binds to 127.0.0.1 and requires a per-run token, so other sites and machines can't drive it.
 */
export async function startServer(opts: ServerOptions) {
  const token = opts.token ?? randomBytes(18).toString("base64url");
  const hostOk = makeHostCheck(opts.host ?? "127.0.0.1", opts.allowedHosts);
  const log = opts.log ?? (() => {});
  const approvals = new Map<string, PendingApproval>();
  const questions = new Map<string, PendingQuestion>();
  const live = new Map<string, Live>();
  const clients = new Set<http.ServerResponse>();

  const broadcast = (event: object) => {
    const line = `data: ${JSON.stringify(event)}\n\n`;
    for (const res of clients) res.write(line);
  };

  const runtime = new Runtime(opts.home, {
    packDirs: opts.packDirs,
    ...opts.runtime,
    approve: (req) =>
      new Promise<ApprovalDecision>((resolve) => {
        const card: PendingApproval = {
          id: randomUUID(),
          hireId: req.hire.id,
          tool: req.tool,
          summary: req.summary,
          input: req.input,
          at: new Date().toISOString(),
          resolve,
        };
        approvals.set(card.id, card);
        req.signal?.addEventListener("abort", () => answerApproval(card.id, "deny"));
        broadcast({ type: "approval", approval: publicApproval(card) });
        void telegram.notifyApproval(card).catch(() => {});
      }),
    ask: (hire, question, askOpts) =>
      new Promise<string | null>((resolve) => {
        const card: PendingQuestion = { id: randomUUID(), hireId: hire.id, question, at: new Date().toISOString(), resolve };
        questions.set(card.id, card);
        askOpts?.signal?.addEventListener("abort", () => answerQuestion(card.id, null));
        broadcast({ type: "question", question: publicQuestion(card) });
        void telegram.notifyQuestion(card).catch(() => {});
      }),
  });

  runtime.on((e: RuntimeEvent) => {
    if (e.type === "status") {
      const prev = live.get(e.hireId);
      if (e.status === "idle") live.delete(e.hireId);
      else
        live.set(e.hireId, {
          status: e.status,
          detail: e.detail,
          since: prev?.since ?? new Date().toISOString(),
          text: prev?.text ?? "",
        });
    }
    if (e.type === "delta") {
      const l = live.get(e.hireId);
      if (l) l.text += e.text;
    }
    if (e.type === "rewind") {
      const l = live.get(e.hireId);
      if (l) l.text = e.text;
    }
    broadcast(e);
  });

  const scheduler = opts.scheduler === false ? null : new Scheduler(runtime, log);
  scheduler?.start();

  const telegram = new TelegramBridge(runtime, opts.home, {
    approvals: () => [...approvals.values()].map((a) => ({ id: a.id, hireId: a.hireId, summary: a.summary })),
    answerApproval: (id, d) => answerApproval(id, d),
    answerQuestion: (id, a) => answerQuestion(id, a),
    broadcast,
    log,
  });
  if (opts.telegram !== false) telegram.start();
  const conn = { runtime, home: opts.home, telegram, broadcast, log, send, readJson };

  const hireView = (h: Hire) => {
    const pack = runtime.packFor(h);
    return {
      ...h,
      title: pack?.title ?? h.packId,
      model: pack ? runtime.modelFor(h, pack) : h.model,
      ownModel: h.model,
      modelReady: modelReady(pack ? runtime.modelFor(h, pack) : (h.model ?? runtime.config.model)),
      hasBrowser: !!pack?.tools.includes("browser"),
      live: live.has(h.id) ? { ...live.get(h.id)!, pending: runtime.pendingFor(h.id) } : null,
      spend: runtime.spendThisMonth(h.id),
    };
  };

  const modelReady = (id: string) => {
    try {
      return isConfigured(getProvider(parseModelId(id).provider)!);
    } catch {
      return false;
    }
  };

  // Keys the web app may set: provider keys and base URLs, media keys, and a few tool settings.
  const settableKeys = () => {
    const names = new Set<string>([
      "VAPI_PHONE_NUMBER_ID", "VAPI_ASSISTANT_ID", "TAVILY_API_KEY", "BRAVE_API_KEY",
      "COMPOSIO_API_KEY", "ELEVENLABS_API_KEY", "TELEGRAM_BOT_TOKEN",
    ]);
    for (const p of allProviders()) {
      if (p.keyEnv) names.add(p.keyEnv);
      if (p.baseURLEnv) names.add(p.baseURLEnv);
    }
    for (const m of MEDIA_PROVIDERS) names.add(m.keyEnv);
    return names;
  };

  const providersView = () => ({
    defaultModel: runtime.config.model,
    chat: allProviders().map((p) => ({
      id: p.id,
      name: p.name,
      local: !!p.local,
      keyEnv: p.keyEnv ?? null,
      keyUrl: p.keyUrl ?? null,
      baseURL: (p.baseURLEnv && process.env[p.baseURLEnv]) || p.baseURL || null,
      baseURLEnv: p.baseURLEnv ?? null,
      note: p.note ?? null,
      models: p.models,
      configured: isConfigured(p) && (!!p.local || !!p.keyEnv),
      keySource: p.keyEnv ? keySource(opts.home, p.keyEnv) : null,
      masked: p.keyEnv ? maskKey(process.env[p.keyEnv]) : null,
    })),
    media: MEDIA_PROVIDERS.map((m) => ({
      id: m.id,
      name: m.name,
      keyEnv: m.keyEnv,
      keyUrl: m.keyUrl,
      note: m.note,
      configured: !!process.env[m.keyEnv],
      keySource: keySource(opts.home, m.keyEnv),
      masked: maskKey(process.env[m.keyEnv]),
    })),
  });

  const state = () => ({
    company: runtime.config.company,
    model: runtime.config.model,
    modelReady: modelReady(runtime.config.model),
    demo: !!opts.demo,
    goals: runtime.config.goals,
    budgetUsd: runtime.config.budgetUsd,
    spend: runtime.spendThisMonth(),
    packs: [...runtime.packs.values()].map((p) => ({
      id: p.id,
      title: p.title,
      description: p.description,
      defaultName: p.defaultName,
      tools: p.tools,
      requires: p.requires,
      skills: p.skills.map((s) => ({ name: s.name, description: s.description })),
    })),
    hires: runtime.listHires().map(hireView),
    approvals: [...approvals.values()].map(publicApproval),
    questions: [...questions.values()].map(publicQuestion),
  });

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (!url.pathname.startsWith("/api/")) return serveStatic(opts.webDir, url.pathname, res);

      if (!hostOk(req.headers.host)) return send(res, 403, { error: "This address isn't allowed. Add it to DUDE_ALLOWED_HOSTS." });
      const parts = url.pathname.split("/").filter(Boolean).slice(1); // drop "api"
      const method = req.method ?? "GET";

      // A routine's webhook has its own key, which starts that routine and opens nothing else.
      if (parts[0] === "hooks" && parts.length === 3 && method === "POST") return await runHook(parts, url, req, res);

      const given = req.headers["x-dude-token"] ?? url.searchParams.get("token");
      if (given !== token) return send(res, 401, { error: "Missing or wrong token. Open the link printed by `dudee ui`." });

      if (parts[0] === "events" && method === "GET") {
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        res.write(`data: ${JSON.stringify({ type: "hello" })}\n\n`);
        clients.add(res);
        const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
        req.on("close", () => {
          clearInterval(ping);
          clients.delete(res);
        });
        return;
      }

      if (parts[0] === "state" && method === "GET") return send(res, 200, state());
      if (await handleConnections(conn, parts, method, url, req, res)) return;

      // ── models, keys and settings ─────────────────────────────────────────
      if (parts[0] === "providers" && !parts[1] && method === "GET") return send(res, 200, providersView());
      if (parts[0] === "providers" && parts[1] && parts[2] === "models" && method === "GET") {
        try {
          return send(res, 200, { models: await listModels(decodeURIComponent(parts[1])) });
        } catch (err) {
          return send(res, 200, { error: errorText(err), models: [] });
        }
      }
      if (parts[0] === "keys" && parts[1] && (method === "PUT" || method === "DELETE")) {
        const name = decodeURIComponent(parts[1]);
        if (!settableKeys().has(name)) return send(res, 400, { error: `${name} can't be set here` });
        if (method === "DELETE") setSecret(opts.home, name, null);
        else {
          const body = await readJson(req);
          const value = String(body.value ?? "").trim();
          if (!value) return send(res, 400, { error: "Empty value" });
          setSecret(opts.home, name, value);
        }
        if (name === "COMPOSIO_API_KEY") {
          await runtime.resetConnections();
          runtime.composio.forgetSession();
        }
        if (name === "TELEGRAM_BOT_TOKEN" && opts.telegram !== false) await telegram.restart();
        broadcast({ type: "settings-changed" });
        broadcast({ type: "connections-changed" });
        return send(res, 200, providersView());
      }
      if (parts[0] === "settings" && method === "GET") {
        const c = runtime.config;
        // models in use, with the price dudee will charge them at (null = unknown, needs a price)
        const models = [...new Set([c.model, ...c.fallbackModels, ...runtime.listHires().map((h) => {
          const p = runtime.packFor(h);
          return p ? runtime.modelFor(h, p) : c.model;
        })])];
        await runtime.ensurePrices(models); // OpenRouter publishes its prices; fetch them if we have none yet
        const inUse = models.map((id) => ({ model: id, price: priceFor(id, c), custom: !!c.prices[id] }));
        return send(res, 200, {
          globalSkills: c.globalSkills, extraTools: c.extraTools, skillDirs: c.skillDirs, company: c.company, model: c.model,
          goals: c.goals, budgetUsd: c.budgetUsd, prices: inUse, fallbackModels: c.fallbackModels,
        });
      }
      if (parts[0] === "team" && parts[1] === "export" && method === "GET") {
        const data = exportTeam(runtime, { withMemory: url.searchParams.get("memory") === "1" });
        res.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
          "content-disposition": `attachment; filename="dudee-team-${new Date().toISOString().slice(0, 10)}.json"`,
        });
        return res.end(JSON.stringify(data, null, 2));
      }
      if (parts[0] === "team" && parts[1] === "import" && method === "POST") {
        const result = importTeam(runtime, await readJson(req, 10_000_000));
        saveConfig(opts.home, runtime.config);
        broadcast({ type: "team-changed" });
        return send(res, 200, result);
      }
      if (parts[0] === "config" && method === "PATCH") {
        const body = await readJson(req);
        if (body.model !== undefined) {
          parseModelId(String(body.model));
          runtime.config.model = String(body.model);
        }
        if (body.globalSkills !== undefined) runtime.config.globalSkills = !!body.globalSkills;
        if (Array.isArray(body.extraTools)) runtime.config.extraTools = body.extraTools.map(String);
        if (body.company && typeof body.company === "object") runtime.config.company = { ...runtime.config.company, ...body.company };
        if (Array.isArray(body.goals)) runtime.config.goals = body.goals.map((g: unknown) => String(g).trim()).filter(Boolean);
        if (body.budgetUsd !== undefined) runtime.config.budgetUsd = money(body.budgetUsd);
        if (Array.isArray(body.fallbackModels)) {
          const list: string[] = body.fallbackModels.map((m: unknown) => String(m).trim()).filter(Boolean);
          for (const m of list) parseModelId(m);
          runtime.config.fallbackModels = [...new Set(list)].slice(0, 5);
        }
        if (body.price && typeof body.price === "object") {
          const { model, in: pin, out: pout } = body.price;
          parseModelId(String(model));
          if (pin === null) delete runtime.config.prices[String(model)];
          else runtime.config.prices[String(model)] = { in: money(pin) ?? 0, out: money(pout) ?? 0 };
        }
        saveConfig(opts.home, runtime.config);
        runtime.reloadSkills();
        broadcast({ type: "team-changed" });
        return send(res, 200, state());
      }
      if (parts[0] === "skills" && parts[1] === "reload" && method === "POST") {
        runtime.reloadSkills();
        return send(res, 200, { ok: true });
      }

      if (parts[0] === "memory" && method === "GET") return send(res, 200, { text: runtime.teamMemory().text() });
      if (parts[0] === "memory" && method === "PUT") return saveMemory(runtime.teamMemory(), await readJson(req), res);

      if (parts[0] === "hires" && parts.length === 1 && method === "POST") {
        const body = await readJson(req);
        const hire = runtime.hire(String(body.packId), {
          name: body.name ? String(body.name) : undefined,
          model: body.model ? String(body.model) : undefined,
        });
        return send(res, 201, hireView(hire));
      }

      if (parts[0] === "hires" && parts[1]) {
        const hire = runtime.findHire(decodeURIComponent(parts[1]));
        if (!hire) return send(res, 404, { error: "No such employee" });
        const sub = parts[2];

        if (!sub && method === "DELETE") {
          for (const a of approvals.values()) if (a.hireId === hire.id) answerApproval(a.id, "deny");
          for (const q of questions.values()) if (q.hireId === hire.id) answerQuestion(q.id, null);
          await runtime.fire(hire.id);
          return send(res, 200, { ok: true });
        }
        if (!sub && method === "PATCH") {
          const body = await readJson(req);
          if (body.model !== undefined) {
            const model = body.model ? String(body.model) : null;
            if (model) parseModelId(model);
            runtime.store.setHireModel(hire.id, model);
          }
          if (body.budgetUsd !== undefined) runtime.setBudget(hire.id, money(body.budgetUsd));
          if (body.paused !== undefined && !!body.paused !== hire.paused) runtime.setPaused(hire.id, !!body.paused);
          broadcast({ type: "team-changed" });
          return send(res, 200, hireView(runtime.findHire(hire.id)!));
        }
        if (sub === "policies" && !parts[3] && method === "GET") return send(res, 200, runtime.store.policies(hire.id));
        if (sub === "policies" && parts[3] && method === "DELETE") {
          const ok = runtime.store.removePolicy(hire.id, decodeURIComponent(parts[3]));
          return send(res, ok ? 200 : 404, { ok });
        }
        if (sub === "routines" && parts[3] && parts[4] === "run" && method === "POST") {

          runtime.runRoutine(hire.id, decodeURIComponent(parts[3])).catch((err) => log(`✗ ${hire.name}: ${errorText(err)}`));
          return send(res, 202, { ok: true });
        }
        if (sub === "skills" && method === "GET") {
          const pack = runtime.packFor(hire);
          return send(
            res,
            200,
            pack
              ? runtime.skillsFor(pack).map((s) => ({
                  name: s.name,
                  description: s.description,
                  argumentHint: s.argumentHint ?? null,
                  source: s.source ?? "pack",
                  userInvocable: s.userInvocable !== false,
                  files: s.files?.length ?? 0,
                }))
              : []
          );
        }
        if (sub === "rows" && method === "GET") {
          return send(res, 200, runtime.store.rows(hire.id, Number(url.searchParams.get("limit") ?? 200)));
        }
        if (sub === "messages" && method === "POST") {
          const body = await readJson(req);
          const root = runtime.filesDir(hire);
          const attachments: string[] = (Array.isArray(body.attachments) ? body.attachments.map(String) : []).slice(0, 10);
          for (const a of attachments) if (!insideFile(root, a)) return send(res, 400, { error: `No file ${a}` });
          const text = String(body.text ?? "").trim() || (attachments.length ? "Take a look at this." : "");
          if (!text) return send(res, 400, { error: "Empty message" });
          const told = runtime.tell(hire.id, text, { attachments });
          told.done?.catch((err) => log(`✗ ${hire.name}: ${errorText(err)}`));
          return send(res, 202, { ok: true, added: told.added });
        }
        if (sub === "stop" && method === "POST") return send(res, 200, { stopped: runtime.stop(hire.id) });
        if (sub === "uploads" && method === "POST") {
          const name = uploadName(url.searchParams.get("name") ?? "");
          const dir = path.join(runtime.filesDir(hire), "uploads");
          const data = await readBody(req, MAX_UPLOAD);
          if (!data.length) return send(res, 400, { error: "The file is empty" });
          fs.mkdirSync(dir, { recursive: true });
          const ext = path.extname(name);
          let file = name;
          for (let i = 2; fs.existsSync(path.join(dir, file)); i++) file = `${path.basename(name, ext)}-${i}${ext}`;
          fs.writeFileSync(path.join(dir, file), data);
          return send(res, 201, { path: `uploads/${file}`, size: data.length });
        }
        if (sub === "raw" && method === "GET") {
          const full = insideFile(runtime.filesDir(hire), url.searchParams.get("path") ?? "");
          return full ? sendFile(full, req, res, url.searchParams.has("download")) : send(res, 404, { error: "No such file" });
        }
        if (sub === "work") {
          const changed = () => runtime.emit({ type: "work-changed", hireId: hire.id });
          if (method === "GET") return send(res, 200, runtime.store.work(hire.id));
          if (method === "POST" && !parts[3]) {
            const text = String((await readJson(req)).text ?? "").trim();
            if (!text) return send(res, 400, { error: "Say what needs doing" });
            const item = runtime.store.addWork(hire.id, text);
            changed();
            return send(res, 201, item);
          }
          if (method === "PATCH" && parts[3]) {
            const ok = runtime.store.setWork(hire.id, parts[3], (await readJson(req)).done ? "done" : "open");
            changed();
            return send(res, ok ? 200 : 404, { ok });
          }
          if (method === "DELETE" && parts[3]) {
            const ok = runtime.store.removeWork(hire.id, parts[3]);
            changed();
            return send(res, ok ? 200 : 404, { ok });
          }
        }
        if (sub === "memory" && method === "PUT") return saveMemory(runtime.memoryFor(hire), await readJson(req), res);
        if (sub === "memory" && method === "GET") return send(res, 200, { text: runtime.memoryFor(hire).text() });
        if (sub === "files" && method === "GET") {
          const root = runtime.filesDir(hire);
          const file = url.searchParams.get("path");
          if (file) {
            const full = insideFile(root, file);
            if (!full) return send(res, 404, { error: "No such file" });
            const data = fs.readFileSync(full);
            if (data.subarray(0, 8000).includes(0)) return send(res, 200, { path: file, text: null });
            return send(res, 200, { path: file, text: data.toString("utf8").slice(0, 200_000) });
          }
          return send(res, 200, listFiles(root));
        }
        if (sub === "routines" && !parts[3] && method === "GET") return send(res, 200, runtime.store.routines(hire.id));
        if (sub === "routines" && parts[3] && method === "PATCH") {
          const body = await readJson(req);
          const rid = decodeURIComponent(parts[3]);
          if (!runtime.store.routines(hire.id).some((r) => r.id === rid)) return send(res, 404, { ok: false });
          if (body.enabled !== undefined) runtime.store.setRoutineEnabled(hire.id, rid, !!body.enabled);
          if (body.model !== undefined) {
            const model = body.model ? String(body.model).trim() : null;
            if (model) parseModelId(model);
            runtime.store.setRoutineModel(hire.id, rid, model);
          }
          // true makes a webhook (or a new key for it); false turns it off
          if (body.webhook !== undefined) runtime.store.setRoutineHook(hire.id, rid, body.webhook ? randomBytes(24).toString("base64url") : null);
          runtime.emit({ type: "routines-changed" });
          return send(res, 200, runtime.store.routines(hire.id).find((r) => r.id === rid));
        }
        if (sub === "routines" && parts[3] && parts[4] === "runs" && method === "GET") {
          return send(res, 200, runtime.store.runs(hire.id, decodeURIComponent(parts[3])));
        }
        if (sub === "screen" && method === "GET") {
          const shot = runtime.screens.get(hire.id);
          return shot ? send(res, 200, shot) : send(res, 200, null);
        }
      }

      if (parts[0] === "approvals" && parts[1] && method === "POST") {
        const body = await readJson(req);
        const decision = body.decision as ApprovalDecision;
        if (!["allow", "always", "deny"].includes(decision)) return send(res, 400, { error: "Bad decision" });
        return send(res, answerApproval(parts[1], decision) ? 200 : 404, { ok: true });
      }

      if (parts[0] === "questions" && parts[1] && method === "POST") {
        const body = await readJson(req);
        const answer = body.answer ? String(body.answer) : null;
        return send(res, answerQuestion(parts[1], answer) ? 200 : 404, { ok: true });
      }

      return send(res, 404, { error: "Not found" });
    } catch (err) {
      return send(res, 400, { error: errorText(err) });
    }
  });

  const hooksRunning = new Map<string, number>();

  async function runHook(parts: string[], url: URL, req: http.IncomingMessage, res: http.ServerResponse) {
    const [hireRef, rid] = parts.slice(1).map(decodeURIComponent);
    const hire = runtime.findHire(hireRef);
    const routine = hire && runtime.store.routines(hire.id).find((r) => r.id === rid);
    const auth = String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    const given = String(req.headers["x-hook-key"] ?? "") || auth || url.searchParams.get("key") || "";
    // one answer for "no such routine" and "wrong key", so a stranger learns nothing
    if (!hire || !routine?.hookKey || !sameSecret(given, routine.hookKey)) return send(res, 404, { error: "No such webhook" });
    if (!routine.enabled) return send(res, 409, { error: "This routine is off" });
    if (hire.paused) return send(res, 409, { error: `${hire.name} is paused` });
    const id = `${hire.id}/${rid}`;
    const busy = hooksRunning.get(id) ?? 0;
    if (busy >= MAX_HOOKS_WAITING) return send(res, 429, { error: "Too many runs are waiting" });
    hooksRunning.set(id, busy + 1);
    let data = "";
    try {
      data = (await readBody(req, MAX_HOOK_BODY)).toString("utf8").trim();
    } catch (err) {
      hooksRunning.set(id, (hooksRunning.get(id) ?? 1) - 1);
      throw err;
    }
    runtime
      .runRoutine(hire.id, rid, { trigger: "webhook", data })
      .catch((err) => log(`✗ ${hire.name}: ${errorText(err)}`))
      .finally(() => hooksRunning.set(id, (hooksRunning.get(id) ?? 1) - 1));
    return send(res, 202, { ok: true });
  }

  function saveMemory(memory: Memory, body: any, res: http.ServerResponse) {
    const ok = memory.replace(String(body.text ?? ""), String(body.base ?? ""));
    if (!ok) return send(res, 409, { error: "These notes changed while you were editing. Copy your edits, reload and try again." });
    return send(res, 200, { text: memory.text() });
  }

  function answerApproval(id: string, decision: ApprovalDecision) {
    const card = approvals.get(id);
    if (!card) return false;
    approvals.delete(id);
    card.resolve(decision);
    broadcast({ type: "approval-closed", id, decision });
    return true;
  }

  function answerQuestion(id: string, answer: string | null) {
    const card = questions.get(id);
    if (!card) return false;
    questions.delete(id);
    card.resolve(answer);
    broadcast({ type: "question-closed", id });
    return true;
  }

  const host = opts.host ?? "127.0.0.1";
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 4777, host, () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : opts.port ?? 4777;
  const url = `http://${host === "0.0.0.0" || host === "::" ? "localhost" : host}:${port}`;

  return {
    url,
    token,
    runtime,
    telegram,
    async close() {
      scheduler?.stop();
      await telegram.stop();
      for (const id of [...approvals.keys()]) answerApproval(id, "deny");
      for (const id of [...questions.keys()]) answerQuestion(id, null);
      for (const res of clients) res.end();
      const closed = new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeAllConnections();
      await closed;
      await runtime.close();
    },
  };
}

function publicApproval(a: PendingApproval) {
  return { id: a.id, hireId: a.hireId, tool: a.tool, summary: a.summary, input: a.input, at: a.at };
}

function publicQuestion(q: PendingQuestion) {
  return { id: q.id, hireId: q.hireId, question: q.question, at: q.at };
}

/**
 * Host header check (defence against DNS rebinding, on top of the token). Local addresses always pass.
 * When listening beyond loopback (Docker, a server) other names pass if listed, or any name when no list is given.
 */
function makeHostCheck(bind: string, allowed?: string[]) {
  const loopbackOnly = bind === "127.0.0.1" || bind === "localhost" || bind === "::1";
  const extra = new Set((allowed ?? []).map((h) => h.toLowerCase()));
  return (host: string | undefined) => {
    if (!host) return false;
    const name = host.toLowerCase().replace(/:\d+$/, "");
    if (name === "127.0.0.1" || name === "localhost" || name === "[::1]") return true;
    if (extra.has("*") || extra.has(name)) return true;
    return !loopbackOnly && extra.size === 0;
  };
}

function send(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

const MAX_UPLOAD = 25 * 1024 * 1024;
const MAX_HOOK_BODY = 100_000;
const MAX_HOOKS_WAITING = 5;

async function readBody(req: http.IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    // read on without keeping it, so the sender gets the answer instead of a broken connection
    if (size <= limit) chunks.push(chunk);
    else if (size > limit * 4) break;
  }
  if (size > limit) throw new Error(`Too large: the limit is ${limit >= 1024 * 1024 ? `${Math.round(limit / 1024 / 1024)} MB` : `${Math.round(limit / 1000)} KB`}`);
  return Buffer.concat(chunks);
}

function sameSecret(a: string, b: string) {
  const [x, y] = [Buffer.from(a), Buffer.from(b)];
  return x.length === y.length && timingSafeEqual(x, y);
}

/** The full path of an existing file inside a folder, following links, or null. */
function insideFile(root: string, rel: string): string | null {
  const full = path.resolve(root, rel);
  if (!rel || !full.startsWith(root + path.sep)) return null;
  try {
    const real = fs.realpathSync(full);
    if (!real.startsWith(fs.realpathSync(root) + path.sep) || !fs.statSync(real).isFile()) return null;
    return full;
  } catch {
    return null;
  }
}

/** A plain file name: no folders, no odd characters, not hidden. */
function uploadName(raw: string) {
  const base = raw.split(/[\\/]/).pop() ?? "";
  const clean = base.normalize("NFC").replace(/[^\p{L}\p{N} ._()-]/gu, "_").replace(/^[.\s]+/, "").replace(/[.\s]+$/, "");
  const ext = path.extname(clean).slice(0, 12);
  const stem = path.basename(clean, path.extname(clean)).slice(0, 80);
  return `${/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(stem) || !stem ? `file-${stem}` : stem}${ext}`;
}

/** Types shown in the page. Anything else downloads, so a file an employee saved never runs as part of this app. */
const VIEWABLE: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".pdf": "application/pdf",
};

function sendFile(full: string, req: http.IncomingMessage, res: http.ServerResponse, download: boolean) {
  const type = download ? undefined : VIEWABLE[path.extname(full).toLowerCase()];
  const size = fs.statSync(full).size;
  const headers: Record<string, string | number> = {
    "content-type": type ?? "application/octet-stream",
    "content-disposition": `${type ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(path.basename(full)).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16)}`)}`,
    "x-content-type-options": "nosniff",
    "cache-control": "private, no-cache",
    "accept-ranges": "bytes",
    // the link carries the token, so it must not leave with a referrer
    "referrer-policy": "no-referrer",
  };
  if (type !== "application/pdf") headers["content-security-policy"] = "sandbox; default-src 'none'";
  // video players ask for pieces
  const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ""));
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start > end || start >= size) {
      res.writeHead(416, { "content-range": `bytes */${size}` });
      return res.end();
    }
    res.writeHead(206, { ...headers, "content-range": `bytes ${start}-${end}/${size}`, "content-length": end - start + 1 });
    return fs.createReadStream(full, { start, end }).on("error", () => res.destroy()).pipe(res);
  }
  res.writeHead(200, { ...headers, "content-length": size });
  return fs.createReadStream(full).on("error", () => res.destroy()).pipe(res);
}

async function readJson(req: http.IncomingMessage, limit = 1_000_000): Promise<any> {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > limit) throw new Error("Body too large");
  }
  return raw ? JSON.parse(raw) : {};
}

function listFiles(root: string, rel = ""): Array<{ path: string; size: number; modified: string }> {
  const dir = path.join(root, rel);
  if (!fs.existsSync(dir)) return [];
  const out: Array<{ path: string; size: number; modified: string }> = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...listFiles(root, p));
    else {
      const st = fs.statSync(path.join(root, p));
      out.push({ path: p, size: st.size, modified: st.mtime.toISOString() });
    }
  }
  return out.sort((a, b) => b.modified.localeCompare(a.modified));
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".woff2": "font/woff2",
};

function serveStatic(webDir: string | undefined, pathname: string, res: http.ServerResponse) {
  if (!webDir || !fs.existsSync(path.join(webDir, "index.html"))) {
    res.writeHead(404, { "content-type": "text/plain" });
    return res.end("The web app is not built. Run `pnpm build` in the repo.");
  }
  const root = path.resolve(webDir);
  let file = path.resolve(root, "." + decodeURIComponent(pathname));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(webDir, "index.html");
  }
  res.writeHead(200, {
    "content-type": MIME[path.extname(file)] ?? "application/octet-stream",
    "cache-control": file.endsWith("index.html") ? "no-cache" : "public, max-age=31536000, immutable",
  });
  fs.createReadStream(file).pipe(res);
}

/** A dollar amount from a form: empty or null clears it, anything else must be a non-negative number. */
function money(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error("Amounts must be a number of dollars, 0 or more");
  return Math.round(n * 100) / 100;
}
