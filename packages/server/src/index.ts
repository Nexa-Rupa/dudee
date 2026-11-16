import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
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
  type RuntimeEvent,
  type RuntimeOptions,
} from "@dude/core";

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
        broadcast({ type: "approval", approval: publicApproval(card) });
      }),
    ask: (hire, question) =>
      new Promise<string | null>((resolve) => {
        const card: PendingQuestion = { id: randomUUID(), hireId: hire.id, question, at: new Date().toISOString(), resolve };
        questions.set(card.id, card);
        broadcast({ type: "question", question: publicQuestion(card) });
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
    broadcast(e);
  });

  const scheduler = opts.scheduler === false ? null : new Scheduler(runtime, log);
  scheduler?.start();

  const hireView = (h: Hire) => {
    const pack = runtime.packFor(h);
    return {
      ...h,
      title: pack?.title ?? h.packId,
      model: pack ? runtime.modelFor(h, pack) : h.model,
      ownModel: h.model,
      modelReady: modelReady(pack ? runtime.modelFor(h, pack) : (h.model ?? runtime.config.model)),
      hasBrowser: !!pack?.tools.includes("browser"),
      live: live.get(h.id) ?? null,
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
    const names = new Set<string>(["VAPI_PHONE_NUMBER_ID", "VAPI_ASSISTANT_ID", "TAVILY_API_KEY"]);
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
      const given = req.headers["x-dude-token"] ?? url.searchParams.get("token");
      if (given !== token) return send(res, 401, { error: "Missing or wrong token. Open the link printed by `dudee ui`." });

      const parts = url.pathname.split("/").filter(Boolean).slice(1); // drop "api"
      const method = req.method ?? "GET";

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
        broadcast({ type: "settings-changed" });
        return send(res, 200, providersView());
      }
      if (parts[0] === "settings" && method === "GET") {
        const c = runtime.config;
        // models in use, with the price dudee will charge them at (null = unknown, needs a price)
        const inUse = [...new Set([c.model, ...runtime.listHires().map((h) => {
          const p = runtime.packFor(h);
          return p ? runtime.modelFor(h, p) : c.model;
        })])].map((id) => ({ model: id, price: priceFor(id, c), custom: !!c.prices[id] }));
        return send(res, 200, {
          globalSkills: c.globalSkills, extraTools: c.extraTools, skillDirs: c.skillDirs, company: c.company, model: c.model,
          goals: c.goals, budgetUsd: c.budgetUsd, prices: inUse,
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
          // also the webhook: POST /api/hires/<name>/routines/<id>/run with the x-dude-token header
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
          const text = String(body.text ?? "").trim();
          if (!text) return send(res, 400, { error: "Empty message" });
          runtime.send(hire.id, text).catch((err) => log(`✗ ${hire.name}: ${errorText(err)}`));
          return send(res, 202, { ok: true });
        }
        if (sub === "memory" && method === "GET") return send(res, 200, { text: runtime.memoryFor(hire).read() });
        if (sub === "files" && method === "GET") {
          const root = runtime.filesDir(hire);
          const file = url.searchParams.get("path");
          if (file) {
            const full = path.resolve(root, file);
            if (!full.startsWith(root + path.sep) || !fs.existsSync(full)) return send(res, 404, { error: "No such file" });
            return send(res, 200, { path: file, text: fs.readFileSync(full, "utf8").slice(0, 200_000) });
          }
          return send(res, 200, listFiles(root));
        }
        if (sub === "routines" && !parts[3] && method === "GET") return send(res, 200, runtime.store.routines(hire.id));
        if (sub === "routines" && parts[3] && method === "PATCH") {
          const body = await readJson(req);
          const ok = runtime.store.setRoutineEnabled(hire.id, decodeURIComponent(parts[3]), !!body.enabled);
          if (ok) runtime.emit({ type: "routines-changed" });
          return send(res, ok ? 200 : 404, { ok });
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
    async close() {
      scheduler?.stop();
      for (const id of [...approvals.keys()]) answerApproval(id, "deny");
      for (const id of [...questions.keys()]) answerQuestion(id, null);
      for (const res of clients) res.end();
      await new Promise<void>((resolve) => server.close(() => resolve()));
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
