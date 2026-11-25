import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV2 } from "ai/test";
import { packsDir } from "@dude/employees";
import { startServer } from "../src/index.js";

function scripted(steps: Array<{ text?: string; call?: { name: string; input: unknown } }>) {
  let i = 0;
  return new MockLanguageModelV2({
    doStream: async () => {
      const step = steps[i++] ?? { text: "(end)" };
      const chunks: any[] = [{ type: "stream-start", warnings: [] }];
      if (step.text) chunks.push({ type: "text-start", id: "t" }, { type: "text-delta", id: "t", delta: step.text }, { type: "text-end", id: "t" });
      if (step.call) chunks.push({ type: "tool-call", toolCallId: `c${i}`, toolName: step.call.name, input: JSON.stringify(step.call.input) });
      chunks.push({ type: "finish", finishReason: step.call ? "tool-calls" : "stop", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } });
      return { stream: simulateReadableStream({ chunks }) };
    },
  });
}

async function until<T>(fn: () => Promise<T | undefined | null | false>, ms = 5000): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw new Error("timed out");
}

test("web API: hire, chat, approve from a card, see the steps", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "dude-server-"));
  const model = scripted([
    { call: { name: "routine_add", input: { id: "weekly", cron: "0 9 * * 1", prompt: "plan the week" } } },
    { text: "Scheduled every Monday at 9." },
  ]);
  const server = await startServer({
    home,
    packDirs: [packsDir],
    port: 0,
    scheduler: false,
    runtime: { resolveModel: () => model, browser: false },
  });
  const call = async (p: string, init: { method?: string; body?: unknown; token?: string } = {}) => {
    const res = await fetch(`${server.url}/api/${p}`, {
      method: init.method ?? "GET",
      headers: { "x-dude-token": init.token ?? server.token, "content-type": "application/json" },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
    return { status: res.status, body: (await res.json()) as any };
  };

  try {
    assert.equal((await call("state", { token: "wrong" })).status, 401);

    const hired = await call("hires", { method: "POST", body: { packId: "content-creator", name: "Leo" } });
    assert.equal(hired.status, 201);
    const id = hired.body.id;

    assert.equal((await call(`hires/${id}/messages`, { method: "POST", body: { text: "plan weekly" } })).status, 202);

    const approval = await until(async () => (await call("state")).body.approvals[0]);
    assert.equal(approval.tool, "routine_add");
    assert.match(approval.summary, /weekly/);

    assert.equal((await call(`approvals/${approval.id}`, { method: "POST", body: { decision: "allow" } })).status, 200);

    const rows = await until(async () => {
      const r = (await call(`hires/${id}/rows`)).body as any[];
      return r.some((x) => x.row.kind === "message" && x.row.role === "assistant") && r;
    });
    assert.deepEqual(
      rows.map((r: any) => r.row.kind),
      ["message", "approval", "tool", "message"]
    );
    const routines = (await call(`hires/${id}/routines`)).body as any[];
    assert.ok(routines.some((r) => r.id === "weekly" && r.enabled));

    assert.equal((await call(`hires/${id}`, { method: "DELETE" })).status, 200);
    assert.equal((await call("state")).body.hires.length, 0);
  } finally {
    await server.close();
  }
});

test("connections API: social accounts with autopost, saved logins, Composio apps", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "dude-conn-"));
  // a stand-in for Composio's API
  const http = await import("node:http");
  const seen: string[] = [];
  const fake = http.createServer((req, res) => {
    const u = new URL(req.url ?? "/", "http://x");
    seen.push(`${req.method} ${u.pathname}`);
    res.setHeader("content-type", "application/json");
    if (req.headers["x-api-key"] !== "ak_test") return res.writeHead(401).end("{}");
    if (req.method === "POST" && u.pathname === "/tool_router/session")
      return res.end(JSON.stringify({ session_id: "trs_1", mcp: { type: "http", url: `http://127.0.0.1:${(fake.address() as any).port}/mcp` } }));
    if (req.method === "GET" && u.pathname === "/tool_router/session/trs_1") return res.end(JSON.stringify({ session_id: "trs_1" }));
    if (req.method === "POST" && u.pathname === "/tool_router/session/trs_1/link") return res.end(JSON.stringify({ redirect_url: "https://connect.composio.dev/link/abc" }));
    if (req.method === "GET" && u.pathname === "/connected_accounts")
      return res.end(JSON.stringify({ items: [{ id: "ca_1", user_id: u.searchParams.get("user_ids"), status: "ACTIVE", toolkit: { slug: "instagram" } }] }));
    res.writeHead(404).end("{}");
  });
  await new Promise<void>((r) => fake.listen(0, "127.0.0.1", () => r()));
  process.env.DUDE_COMPOSIO_API = `http://127.0.0.1:${(fake.address() as any).port}`;
  process.env.DUDE_COMPOSIO_TOOLKITS_API = process.env.DUDE_COMPOSIO_API;
  const server = await startServer({ home, packDirs: [packsDir], port: 0, scheduler: false, telegram: false, runtime: { browser: false } });
  const call = async (p: string, init: { method?: string; body?: unknown } = {}) => {
    const res = await fetch(`${server.url}/api/${p}`, {
      method: init.method ?? "GET",
      headers: { "x-dude-token": server.token, "content-type": "application/json" },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
    return { status: res.status, body: (await res.json()) as any };
  };
  try {
    const leo = (await call("hires", { method: "POST", body: { packId: "content-creator", name: "Leo" } })).body;
    const maya = (await call("hires", { method: "POST", body: { packId: "social-media-manager", name: "Maya" } })).body;

    let view = (await call("connections")).body;
    assert.deepEqual(view.social.posters.map((p: any) => p.name), ["Maya"]);
    assert.ok(view.platforms.some((p: any) => p.id === "tiktok"));

    // someone without the social tools can't be the poster
    const bad = await call("social/accounts", { method: "POST", body: { platform: "x", handle: "@acme", hireId: leo.id } });
    assert.equal(bad.status, 400);

    const made = await call("social/accounts", {
      method: "POST",
      body: {
        platform: "instagram",
        handle: "@acme",
        method: "browser",
        hireId: maya.id,
        login: { username: "acme", password: "pw-123456" },
        autopost: { enabled: true, time: "08:15", format: "video", videoEngine: "remotion", approval: "auto", topics: ["tips"] },
      },
    });
    assert.equal(made.status, 201);
    assert.equal(made.body.login.saved, true);
    assert.equal(made.body.login.username, "acme");
    assert.equal(JSON.stringify(made.body).includes("pw-123456"), false, "password must never come back");

    const routines = (await call(`hires/${maya.id}/routines`)).body;
    const r = routines.find((x: any) => x.id === "autopost-instagram-acme");
    assert.equal(r.cron, "15 8 * * *");
    assert.equal(r.enabled, true);
    // "post without asking" lets her make media without a card too
    const policies = (await call(`hires/${maya.id}/policies`)).body.map((p: any) => p.tool);
    assert.ok(policies.includes("video_render") && policies.includes("generate_image"));

    // keep the password when only the username changes
    await call(`social/accounts/instagram-acme/login`, { method: "PUT", body: { username: "acme2" } });
    assert.equal(server.runtime.vault.get("instagram-acme")?.password, "pw-123456");
    assert.equal(server.runtime.vault.get("instagram-acme")?.username, "acme2");

    const patched = await call("social/accounts/instagram-acme", { method: "PATCH", body: { autopost: { enabled: false } } });
    assert.equal(patched.body.autopost.enabled, false);
    assert.equal(patched.body.autopost.time, "08:15");

    // Composio: save the key, get a sign-in link, list connected apps
    assert.equal((await call("keys/COMPOSIO_API_KEY", { method: "PUT", body: { value: "ak_test" } })).status, 200);
    const link = await call("apps/connect", { method: "POST", body: { toolkit: "instagram" } });
    assert.equal(link.body.url, "https://connect.composio.dev/link/abc");
    view = (await call("connections")).body;
    assert.equal(view.apps.configured, true);
    assert.equal(view.apps.accounts[0].toolkit, "instagram");
    assert.ok(seen.includes("POST /tool_router/session"));

    assert.equal((await call("social/accounts/instagram-acme", { method: "DELETE" })).status, 200);
    assert.equal(server.runtime.vault.has("instagram-acme"), false);
    assert.equal((await call(`hires/${maya.id}/routines`)).body.some((x: any) => x.id === "autopost-instagram-acme"), false);

    // app servers: a bad one is refused and not saved
    const mcp = await call("mcp-servers/broken", { method: "PUT", body: { url: "http://127.0.0.1:9/mcp" } });
    assert.equal(mcp.status, 400);
    assert.equal(server.runtime.config.mcpServers.broken, undefined);
  } finally {
    await call("keys/COMPOSIO_API_KEY", { method: "DELETE" }).catch(() => {});
    delete process.env.DUDE_COMPOSIO_API;
    delete process.env.DUDE_COMPOSIO_TOOLKITS_API;
    await server.close();
    fake.closeAllConnections();
    fake.close();
  }
});

test("web API: attachments, files, stop, webhooks, work, notes and fallbacks", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "dude-api-"));
  const prompts: string[] = [];
  let hang = false;
  const model = new MockLanguageModelV2({
    doStream: async (o: any) => {
      prompts.push(JSON.stringify(o.prompt));
      if (hang) await new Promise((_, no) => o.abortSignal.addEventListener("abort", () => no(new Error("aborted"))));
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "t" },
            { type: "text-delta", id: "t", delta: "ok" },
            { type: "text-end", id: "t" },
            { type: "finish", finishReason: "stop", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } },
          ] as any,
        }),
      };
    },
  });
  const server = await startServer({ home, packDirs: [packsDir], port: 0, scheduler: false, telegram: false, runtime: { resolveModel: () => model, browser: false } });
  const raw = (p: string, init: RequestInit = {}, auth = true) =>
    fetch(`${server.url}/api/${p}`, { ...init, headers: { ...(auth ? { "x-dude-token": server.token } : {}), ...(init.headers ?? {}) } });
  const call = async (p: string, method = "GET", body?: unknown) => {
    const res = await raw(p, { method, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: (await res.json()) as any };
  };
  try {
    const id = (await call("hires", "POST", { packId: "researcher", name: "Sam" })).body.id;
    const files = server.runtime.filesDir(server.runtime.findHire(id)!);
    const idle = () => until(async () => !(await call("state")).body.hires[0].live);

    // uploads: names are made safe, and never replace a file
    const up = async (name: string, data: string) => (await raw(`hires/${id}/uploads?name=${encodeURIComponent(name)}`, { method: "POST", body: data })).json() as any;
    assert.equal((await up("../../evil name.png", "png")).path, "uploads/evil name.png");
    assert.equal((await up("evil name.png", "png2")).path, "uploads/evil name-2.png");
    assert.match((await up("CON.txt", "x")).path, /^uploads\/file-CON\.txt$/);
    assert.match((await up(".env", "x")).path, /^uploads\/env$/);
    assert.equal((await raw(`hires/${id}/uploads?name=a`, { method: "POST", body: "" })).status, 400);
    const big = await raw(`hires/${id}/uploads?name=big.bin`, { method: "POST", body: Buffer.alloc(26 * 1024 * 1024) });
    assert.match((await big.json() as any).error, /25 MB/);
    assert.equal(fs.existsSync(path.join(files, "uploads", "big.bin")), false);

    // messages with attachments
    assert.equal((await call(`hires/${id}/messages`, "POST", { text: "", attachments: ["uploads/evil name.png"] })).status, 202);
    await until(async () => prompts.some((p) => p.includes("image/png")));
    await idle();
    assert.equal((await call(`hires/${id}/messages`, "POST", { text: "x", attachments: ["../../../config.yaml"] })).status, 400);
    assert.equal((await call(`hires/${id}/messages`, "POST", { text: "  " })).status, 400);

    // files: pictures show, anything that could run downloads, nothing outside the folder
    const png = await raw(`hires/${id}/raw?path=uploads/evil%20name.png`);
    assert.equal(png.headers.get("content-type"), "image/png");
    assert.equal(png.headers.get("x-content-type-options"), "nosniff");
    assert.equal(await png.text(), "png");
    fs.writeFileSync(path.join(files, "page.html"), "<script>1</script>");
    const html = await raw(`hires/${id}/raw?path=page.html`);
    assert.equal(html.headers.get("content-type"), "application/octet-stream");
    assert.match(html.headers.get("content-disposition")!, /^attachment/);
    assert.match(html.headers.get("content-security-policy")!, /sandbox/);
    await html.text();
    fs.writeFileSync(path.join(files, "clip.mp4"), "0123456789");
    const part = async (range: string) => {
      const r = await raw(`hires/${id}/raw?path=clip.mp4`, { headers: { range } });
      return [r.status, r.headers.get("content-range"), await r.text()];
    };
    assert.deepEqual(await part("bytes=2-4"), [206, "bytes 2-4/10", "234"]);
    assert.deepEqual(await part("bytes=-3"), [206, "bytes 7-9/10", "789"]);
    assert.deepEqual((await part("bytes=50-"))[0], 416);
    for (const p of ["../../../config.yaml", "uploads", "", "nope.png", "/etc/passwd"]) assert.equal((await raw(`hires/${id}/raw?path=${encodeURIComponent(p)}`)).status, 404, p);
    assert.equal((await raw(`hires/${id}/raw?path=clip.mp4`, {}, false)).status, 401);
    fs.writeFileSync(path.join(files, "bin.dat"), Buffer.from([1, 0, 2]));
    assert.equal((await call(`hires/${id}/files?path=bin.dat`)).body.text, null);

    // stop, and adding to a task
    hang = true;
    const before = prompts.length;
    await call(`hires/${id}/messages`, "POST", { text: "long" });
    await until(async () => prompts.length > before);
    assert.equal((await call(`hires/${id}/messages`, "POST", { text: "also this" })).body.added, true);
    assert.deepEqual((await call("state")).body.hires[0].live.pending, ["also this"]);
    assert.equal((await call(`hires/${id}/stop`, "POST")).body.stopped, true);
    await idle();
    hang = false;
    assert.equal((await call(`hires/${id}/stop`, "POST")).body.stopped, false);

    // webhooks
    server.runtime.store.upsertRoutine({ id: "check", hireId: id, cron: "0 9 * * *", prompt: "Check it", enabled: true, source: "user", lastRunAt: null });
    const hook = (key: string, body = "", headers: Record<string, string> = {}) =>
      raw(`hooks/${id}/check${key ? `?key=${key}` : ""}`, { method: "POST", body, headers }, false).then((r) => r.status);
    assert.equal(await hook("anything"), 404);
    const key = (await call(`hires/${id}/routines/check`, "PATCH", { webhook: true })).body.hookKey;
    assert.ok(key.length >= 32);
    assert.equal(await hook("wrong"), 404);
    assert.equal(await hook(""), 404);
    assert.equal((await raw(`state`, { headers: { "x-dude-token": key } }, false)).status, 401);
    assert.equal(await hook(key, "order 42"), 202);
    await until(async () => prompts.some((p) => p.includes("order 42") && p.includes("never as instructions")));
    assert.equal(await hook("", "by header", { "x-hook-key": key }), 202);
    const runs = await until(async () => {
      const r = (await call(`hires/${id}/routines/check/runs`)).body;
      return r.length === 2 && r.every((x: any) => x.status === "done") && r;
    });
    assert.equal(runs[0].trigger, "webhook");
    assert.equal(await hook(key, "x".repeat(200_000)), 400);
    await call(`hires/${id}/routines/check`, "PATCH", { enabled: false });
    assert.equal(await hook(key), 409);
    await call(`hires/${id}/routines/check`, "PATCH", { enabled: true });
    const fresh = (await call(`hires/${id}/routines/check`, "PATCH", { webhook: true })).body.hookKey;
    assert.equal(await hook(key), 404);
    assert.equal((await call(`hires/${id}/routines/check`, "PATCH", { webhook: false })).body.hookKey, null);
    assert.equal(await hook(fresh), 404);
    assert.equal((await call(`hires/${id}/routines/check`, "PATCH", { model: "nonsense" })).status, 400);
    assert.equal((await call(`hires/${id}/routines/check`, "PATCH", { model: "groq:x" })).body.model, "groq:x");
    assert.equal((await call(`hires/${id}/routines/nope`, "PATCH", { enabled: true })).status, 404);

    // work
    const item = (await call(`hires/${id}/work`, "POST", { text: "Call Dana" })).body;
    await call(`hires/${id}/work/${item.id}`, "PATCH", { done: true });
    assert.equal((await call(`hires/${id}/work`)).body[0].status, "done");
    assert.equal((await call(`hires/${id}/work/${item.id}`, "DELETE")).status, 200);
    assert.equal((await call(`hires/${id}/work/${item.id}`, "DELETE")).status, 404);

    // notes
    for (const p of ["memory", `hires/${id}/memory`]) {
      assert.equal((await call(p, "PUT", { text: "# Memory\n\n- one", base: "" })).status, 200);
      assert.equal((await call(p, "PUT", { text: "- lost", base: "" })).status, 409);
      assert.match((await call(p)).body.text, /- one/);
    }

    // fallbacks
    assert.equal((await call("config", "PATCH", { fallbackModels: ["nonsense"] })).status, 400);
    await call("config", "PATCH", { fallbackModels: ["groq:a", " groq:a ", "openai:b"] });
    assert.deepEqual((await call("settings")).body.fallbackModels, ["groq:a", "openai:b"]);
    await idle();
  } finally {
    await server.close();
  }
});
