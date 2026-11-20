import type http from "node:http";
import {
  McpHub,
  PLATFORMS,
  PLATFORM_LIST,
  errorText,
  maskKey,
  normalizePlan,
  removeAutopost,
  routineIdFor,
  saveConfig,
  slugId,
  syncAutopost,
  type Hire,
  type McpServerConfig,
  type Platform,
  type Runtime,
  type SocialAccount,
} from "@dude/core";
import type { TelegramBridge } from "./telegram.js";

export interface ConnCtx {
  runtime: Runtime;
  home: string;
  telegram: TelegramBridge;
  broadcast: (e: object) => void;
  log: (line: string) => void;
  send: (res: http.ServerResponse, status: number, body: unknown) => void;
  readJson: (req: http.IncomingMessage, limit?: number) => Promise<any>;
}

/** Tools an employee may use without asking once an account is set to "post without asking". */
const AUTOPOST_TOOLS = ["generate_image", "fal_run", "generate_voiceover", "video_render", "video_new_hyperframes"];

function canPost(runtime: Runtime, hire: Hire) {
  const pack = runtime.packFor(hire);
  return !!pack && (pack.tools.includes("social") || runtime.config.extraTools.includes("social"));
}

export function socialView(runtime: Runtime, a: SocialAccount) {
  const p = PLATFORMS[a.platform];
  const hire = a.hireId ? runtime.findHire(a.hireId) : null;
  const routine = hire ? runtime.store.routines(hire.id).find((r) => r.id === routineIdFor(a.id)) : undefined;
  let login: { saved: boolean; username: string | null; twoStep: boolean } = { saved: false, username: null, twoStep: false };
  if (runtime.vault.has(a.id)) {
    try {
      const c = runtime.vault.get(a.id);
      login = { saved: true, username: c?.username ?? null, twoStep: !!c?.totpSecret };
    } catch {
      login = { saved: true, username: null, twoStep: false };
    }
  }
  return {
    ...a,
    platformName: p.name,
    toolkit: p.toolkit,
    defaultLoginUrl: p.loginUrl,
    hireName: hire?.name ?? null,
    login,
    lastRunAt: routine?.lastRunAt ?? null,
  };
}

function mcpView(name: string, cfg: McpServerConfig) {
  return "url" in cfg
    ? { name, kind: "url" as const, target: cfg.url, headers: Object.keys(cfg.headers ?? {}), hires: cfg.hires ?? [] }
    : { name, kind: "command" as const, target: [cfg.command, ...(cfg.args ?? [])].join(" "), env: Object.keys(cfg.env ?? {}), hires: cfg.hires ?? [] };
}

export async function connectionsView(c: ConnCtx) {
  const { runtime, telegram } = c;
  let accounts: unknown[] = [];
  let appsError: string | null = null;
  if (runtime.composio.configured) {
    try {
      accounts = await runtime.composio.accounts();
    } catch (err) {
      appsError = errorText(err);
    }
  }
  const tg = runtime.config.telegram ?? { allowedChats: [], defaultHire: null, notify: true };
  return {
    apps: { configured: runtime.composio.configured, masked: maskKey(process.env.COMPOSIO_API_KEY), accounts, error: appsError, hires: runtime.config.composioHires ?? [] },
    mcpServers: Object.entries(runtime.config.mcpServers).map(([n, cfg]) => mcpView(n, cfg)),
    telegram: {
      configured: telegram.configured,
      running: telegram.active,
      bot: telegram.botName,
      error: telegram.lastError,
      masked: maskKey(process.env.TELEGRAM_BOT_TOKEN),
      chats: tg.allowedChats,
      pending: [...telegram.pending.values()],
      defaultHire: tg.defaultHire ?? null,
      notify: tg.notify !== false,
    },
    social: {
      accounts: runtime.store.socialAccounts().map((a) => socialView(runtime, a)),
      posts: runtime.store.socialPosts({ limit: 40 }),
      posters: runtime.listHires().filter((h) => canPost(runtime, h)).map((h) => ({ id: h.id, name: h.name })),
    },
    platforms: PLATFORM_LIST.map((id) => ({ id, ...PLATFORMS[id] })),
    keys: {
      ELEVENLABS_API_KEY: maskKey(process.env.ELEVENLABS_API_KEY),
    },
  };
}

function applyPlanPolicies(runtime: Runtime, a: SocialAccount) {
  if (a.hireId && a.autopost.approval === "auto") for (const t of AUTOPOST_TOOLS) runtime.store.setPolicy(a.hireId, t, "auto");
}

function parseAccount(runtime: Runtime, body: any, existing?: SocialAccount): SocialAccount {
  const platform = String(body.platform ?? existing?.platform ?? "") as Platform;
  if (!PLATFORM_LIST.includes(platform)) throw new Error(`Platform must be one of ${PLATFORM_LIST.join(", ")}`);
  const handle = String(body.handle ?? existing?.handle ?? "").trim();
  if (!handle) throw new Error("Give the account's handle or name");
  const method = String(body.method ?? existing?.method ?? "browser");
  if (method !== "browser" && method !== "composio") throw new Error("Method must be browser or composio");
  let hireId: string | null = existing?.hireId ?? null;
  if (body.hireId !== undefined) {
    if (body.hireId === null || body.hireId === "") hireId = null;
    else {
      const hire = runtime.findHire(String(body.hireId));
      if (!hire) throw new Error("No such employee");
      if (!canPost(runtime, hire)) throw new Error(`${hire.name} can't post. Hire a Social Media Manager, or add "social" to extra tools.`);
      hireId = hire.id;
    }
  }
  let loginUrl = body.loginUrl !== undefined ? (String(body.loginUrl).trim() || null) : existing?.loginUrl ?? null;
  if (loginUrl && !/^https:\/\//.test(loginUrl)) throw new Error("The sign-in page must be an https:// address");
  if (platform === "other" && method === "browser" && !loginUrl) throw new Error("For another site, give its sign-in page");
  return {
    id: existing?.id ?? slugId(platform, handle),
    platform,
    handle,
    method,
    loginUrl,
    hireId,
    autopost: normalizePlan({ ...(existing?.autopost ?? {}), ...(body.autopost ?? {}) }),
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  };
}

/** Handles /api/connections, /api/apps, /api/mcp-servers, /api/social and /api/telegram. Returns false for other paths. */
export async function handleConnections(c: ConnCtx, parts: string[], method: string, url: URL, req: http.IncomingMessage, res: http.ServerResponse) {
  const { runtime, send } = c;
  const changed = () => c.broadcast({ type: "connections-changed" });

  if (parts[0] === "connections" && method === "GET") {
    send(res, 200, await connectionsView(c));
    return true;
  }

  // ── connected apps (Composio) ───────────────────────────────────────────
  if (parts[0] === "apps") {
    if (parts[1] === "catalog" && method === "GET") {
      send(res, 200, await runtime.composio.catalog(url.searchParams.get("q") ?? ""));
      return true;
    }
    if (parts[1] === "connect" && method === "POST") {
      const body = await c.readJson(req);
      const link = await runtime.composio.connectLink(String(body.toolkit ?? ""), body.alias ? String(body.alias) : undefined);
      await runtime.resetConnections(); // new tools appear on the next turn
      send(res, 200, { url: link });
      return true;
    }
    if (parts[1] === "accounts" && parts[2] && method === "DELETE") {
      await runtime.composio.disconnect(decodeURIComponent(parts[2]));
      await runtime.resetConnections();
      changed();
      send(res, 200, { ok: true });
      return true;
    }
    if (parts[1] === "hires" && method === "PUT") {
      const body = await c.readJson(req);
      runtime.config.composioHires = Array.isArray(body.hires) ? body.hires.map(String) : [];
      saveConfig(c.home, runtime.config);
      changed();
      send(res, 200, { ok: true });
      return true;
    }
  }

  // ── app servers (any MCP server) ────────────────────────────────────────
  if (parts[0] === "mcp-servers" && parts[1]) {
    const name = decodeURIComponent(parts[1]);
    if (!/^[a-zA-Z0-9_-]{1,32}$/.test(name) || name === "apps" || name === "browser") throw new Error("Server names are letters, digits, - and _ (not apps or browser)");
    if (method === "PUT" || (method === "POST" && parts[2] === "test")) {
      const body = await c.readJson(req);
      const cfg = parseMcpConfig(body);
      // connect once to check it answers and count its tools
      const hub = new McpHub({ [name]: cfg });
      let tools = 0;
      let error: string | null = null;
      try {
        tools = (await hub.toolsFor({ id: "test", name: "test" } as Hire, (_s, err) => (error = errorText(err)))).length;
      } finally {
        await hub.close();
      }
      if (parts[2] === "test") {
        send(res, 200, { ok: !error, tools, error });
        return true;
      }
      if (error) {
        send(res, 400, { error: `Couldn't connect: ${error}` });
        return true;
      }
      runtime.config.mcpServers[name] = cfg;
      saveConfig(c.home, runtime.config);
      changed();
      send(res, 200, { ok: true, tools });
      return true;
    }
    if (method === "DELETE") {
      delete runtime.config.mcpServers[name];
      saveConfig(c.home, runtime.config);
      changed();
      send(res, 200, { ok: true });
      return true;
    }
  }

  // ── social accounts and autopost ────────────────────────────────────────
  if (parts[0] === "social") {
    if (parts[1] === "posts" && method === "GET") {
      send(res, 200, runtime.store.socialPosts({ accountId: url.searchParams.get("account") ?? undefined, limit: 100 }));
      return true;
    }
    if (parts[1] === "accounts" && !parts[2] && method === "POST") {
      const body = await c.readJson(req);
      const a = parseAccount(runtime, body);
      if (runtime.store.socialAccount(a.id)) throw new Error(`${a.handle} on ${PLATFORMS[a.platform].name} is already added`);
      runtime.store.saveSocialAccount(a);
      if (body.login) runtime.vault.set(a.id, { username: String(body.login.username ?? ""), password: String(body.login.password ?? ""), totpSecret: body.login.totpSecret ? String(body.login.totpSecret) : undefined });
      syncAutopost(runtime, a);
      applyPlanPolicies(runtime, a);
      changed();
      send(res, 201, socialView(runtime, a));
      return true;
    }
    if (parts[1] === "accounts" && parts[2]) {
      const existing = runtime.store.socialAccount(decodeURIComponent(parts[2]));
      if (!existing) {
        send(res, 404, { error: "No such account" });
        return true;
      }
      if (!parts[3] && method === "PATCH") {
        const a = parseAccount(runtime, await c.readJson(req), existing);
        runtime.store.saveSocialAccount(a);
        syncAutopost(runtime, a);
        applyPlanPolicies(runtime, a);
        changed();
        send(res, 200, socialView(runtime, a));
        return true;
      }
      if (!parts[3] && method === "DELETE") {
        removeAutopost(runtime, existing);
        runtime.vault.remove(existing.id);
        runtime.store.removeSocialAccount(existing.id);
        changed();
        send(res, 200, { ok: true });
        return true;
      }
      if (parts[3] === "login" && method === "PUT") {
        const body = await c.readJson(req);
        // keep the saved password when only the username or the two-step secret changes
        const prev = runtime.vault.has(existing.id) ? runtime.vault.get(existing.id) : null;
        runtime.vault.set(existing.id, {
          username: String(body.username ?? prev?.username ?? ""),
          password: body.password ? String(body.password) : (prev?.password ?? ""),
          totpSecret: body.totpSecret === "" ? undefined : body.totpSecret ? String(body.totpSecret).replace(/\s+/g, "") : prev?.totpSecret,
        });
        changed();
        send(res, 200, socialView(runtime, existing));
        return true;
      }
      if (parts[3] === "login" && method === "DELETE") {
        runtime.vault.remove(existing.id);
        changed();
        send(res, 200, socialView(runtime, existing));
        return true;
      }
      if (parts[3] === "post-now" && method === "POST") {
        if (!existing.hireId) throw new Error("Choose who posts for this account first");
        syncAutopost(runtime, existing);
        runtime.runRoutine(existing.hireId, routineIdFor(existing.id)).catch((err) => c.log(`✗ autopost ${existing.id}: ${errorText(err)}`));
        send(res, 202, { ok: true });
        return true;
      }
    }
  }

  // ── Telegram ─────────────────────────────────────────────────────────────
  if (parts[0] === "telegram") {
    if (!parts[1] && method === "PATCH") {
      const body = await c.readJson(req);
      const tg = (runtime.config.telegram ??= { allowedChats: [], defaultHire: null, notify: true });
      if (body.defaultHire !== undefined) tg.defaultHire = body.defaultHire ? runtime.findHire(String(body.defaultHire))?.id ?? null : null;
      if (body.notify !== undefined) tg.notify = !!body.notify;
      saveConfig(c.home, runtime.config);
      changed();
      send(res, 200, { ok: true });
      return true;
    }
    if (parts[1] === "pair" && parts[2] && method === "POST") {
      const ok = c.telegram.pair(decodeURIComponent(parts[2]));
      changed();
      send(res, ok ? 200 : 404, ok ? { ok } : { error: "That code expired. Message the bot again for a new one." });
      return true;
    }
    if (parts[1] === "pair" && parts[2] && method === "DELETE") {
      c.telegram.pending.delete(decodeURIComponent(parts[2]));
      changed();
      send(res, 200, { ok: true });
      return true;
    }
    if (parts[1] === "chats" && parts[2] && method === "DELETE") {
      c.telegram.unpair(Number(parts[2]));
      changed();
      send(res, 200, { ok: true });
      return true;
    }
  }
  return false;
}

/** An app server from the form: a URL (with optional headers) or a command (with args and env). */
export function parseMcpConfig(body: any): McpServerConfig {
  if (body.url) {
    const u = new URL(String(body.url));
    if (u.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)) throw new Error("Use an https:// address (http only for localhost)");
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(body.headers ?? {})) if (k && v) headers[String(k)] = String(v);
    return { url: u.toString(), ...(Object.keys(headers).length ? { headers } : {}) };
  }
  if (body.command) {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(body.env ?? {})) if (k && v !== undefined) env[String(k)] = String(v);
    const args = Array.isArray(body.args) ? body.args.map(String) : [];
    return { command: String(body.command), args, ...(Object.keys(env).length ? { env } : {}) };
  }
  throw new Error("Give a URL or a command");
}
