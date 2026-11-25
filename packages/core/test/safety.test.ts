import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV2 } from "ai/test";
import { packsDir } from "@dude/employees";
import {
  DEFAULT_CONFIG,
  MEMORY_LIMIT,
  Runtime,
  TOOL_GROUPS,
  Vault,
  childEnv,
  fetchPublic,
  isPublicAddress,
  normalizePlan,
  onAccountSite,
  postingVerdict,
  type ApprovalDecision,
  type ApprovalRequest,
  type DudeConfig,
  type Hire,
  type PostingWindow,
  type SocialAccount,
  type ToolContext,
} from "../src/index.js";

type Step = { text?: string; call?: { name: string; input: unknown }; fail?: string };

/** A model driven by a function of the prompt, so several employees can run at once. */
function model(next: (prompt: any[]) => Step | Promise<Step>, tokens = 1000) {
  return new MockLanguageModelV2({
    doStream: async (o: any) => {
      const step = await next(o.prompt);
      if (step.fail) throw new Error(step.fail);
      const chunks: any[] = [{ type: "stream-start", warnings: [] }];
      if (step.text) chunks.push({ type: "text-start", id: "t" }, { type: "text-delta", id: "t", delta: step.text }, { type: "text-end", id: "t" });
      if (step.call) chunks.push({ type: "tool-call", toolCallId: `c${Math.random()}`, toolName: step.call.name, input: JSON.stringify(step.call.input) });
      chunks.push({ type: "finish", finishReason: step.call ? "tool-calls" : "stop", usage: { inputTokens: tokens, outputTokens: 0, totalTokens: tokens } });
      return { stream: simulateReadableStream({ chunks }) };
    },
  });
}

function setup(
  m: MockLanguageModelV2,
  opts: { config?: Partial<DudeConfig>; approve?: (r: ApprovalRequest) => Promise<ApprovalDecision>; ask?: () => Promise<string | null> } = {}
) {
  return new Runtime(fs.mkdtempSync(path.join(os.tmpdir(), "dude-safety-")), {
    packDirs: [packsDir],
    config: { ...structuredClone(DEFAULT_CONFIG), globalSkills: false, ...opts.config },
    resolveModel: () => m,
    browser: false,
    approve: opts.approve,
    ask: opts.ask,
  });
}

const quiet = () => model(() => ({ text: "ok" }));
const afterTool = (prompt: any[]) => prompt[prompt.length - 1].role === "tool";
const ctxFor = (runtime: Runtime, hire: Hire): ToolContext => ({ hire, pack: runtime.packFor(hire)!, runtime, chain: [] });
const toolNamed = (group: string, name: string) => TOOL_GROUPS[group].find((t) => t.name === name)!;

/** Fails the test instead of hanging it. */
function within<T>(p: Promise<T>, ms = 5000): Promise<T> {
  let t: NodeJS.Timeout;
  return Promise.race([p, new Promise<never>((_, no) => (t = setTimeout(() => no(new Error("hung")), ms)))]).finally(() => clearTimeout(t));
}

function account(over: Partial<SocialAccount> = {}): SocialAccount {
  return { id: "instagram-acme", platform: "instagram", handle: "@acme", method: "browser", loginUrl: null, hireId: null, autopost: normalizePlan(), createdAt: "", ...over };
}

// ── conversation ───────────────────────────────────────────────────────────
test("earlier messages reach the model however many tool steps came since", async () => {
  let prompt = "";
  const runtime = setup(model((p) => ((prompt = JSON.stringify(p)), { text: "500 dollars" })));
  const sam = runtime.hire("researcher");
  runtime.store.appendRow(sam.id, { kind: "message", role: "user", text: "My limit is 500 dollars" });
  for (let i = 0; i < 100; i++) runtime.store.appendRow(sam.id, { kind: "tool", tool: "web_fetch", input: {}, output: "x", ms: 1 });
  runtime.store.appendRow(sam.id, { kind: "message", role: "assistant", text: "Done." });
  await runtime.send(sam.id, "What was my limit?");
  assert.match(prompt, /My limit is 500 dollars/);
  await runtime.close();
});

test("two employees who ask each other at the same time both finish", async () => {
  const results: string[] = [];
  const runtime = setup(
    model(async (p) => {
      await new Promise((r) => setTimeout(r, 60));
      const text = JSON.stringify(p[p.length - 1]);
      if (afterTool(p)) {
        results.push(text);
        return { text: "finished" };
      }
      if (text.includes("START-A")) return { call: { name: "send_to_teammate", input: { name: "Bob", message: "help" } } };
      if (text.includes("START-B")) return { call: { name: "send_to_teammate", input: { name: "Ann", message: "help" } } };
      return { text: "here you go" };
    })
  );
  const a = runtime.hire("researcher", { name: "Ann" });
  const b = runtime.hire("researcher", { name: "Bob" });
  await within(Promise.all([runtime.send(a.id, "START-A"), runtime.send(b.id, "START-B")]));
  assert.equal(results.filter((r) => r.includes("waiting for your current task")).length, 1);
  assert.equal(results.filter((r) => r.includes("here you go")).length, 1);
  await runtime.close();
});

test("a three-way circle of requests is broken too, and nobody messages themselves", async () => {
  const runtime = setup(
    model(async (p) => {
      await new Promise((r) => setTimeout(r, 60));
      const m = JSON.stringify(p[p.length - 1]).match(/GO-(\w+)/);
      return !afterTool(p) && m ? { call: { name: "send_to_teammate", input: { name: m[1], message: "help" } } } : { text: "done" };
    })
  );
  const [a, b, c] = ["Ann", "Bob", "Cy"].map((name) => runtime.hire("researcher", { name }));
  await within(Promise.all([runtime.send(a.id, "GO-Bob"), runtime.send(b.id, "GO-Cy"), runtime.send(c.id, "GO-Ann")]));
  await within(runtime.send(a.id, "GO-Ann"));
  await runtime.close();
});

// ── unanswered cards ───────────────────────────────────────────────────────
const add = (id: string) => ({ call: { name: "routine_add", input: { id, cron: "0 9 * * *", prompt: "p" } } });

test("scheduled work stops waiting for an unanswered approval; a card someone asked for stays open", async () => {
  let aborted = 0;
  let asked = 0;
  let release: (d: ApprovalDecision) => void = () => {};
  const script: Step[] = [add("one"), add("two"), { text: "Needs your OK." }, { text: "hello" }, add("three"), { text: "scheduled" }];
  const runtime = setup(
    model(() => script.shift()!),
    {
      config: { approvalTimeoutMin: 0.005 }, // 300 ms
      approve: (r) =>
        new Promise((resolve) => {
          asked++;
          release = resolve;
          r.signal?.addEventListener("abort", () => aborted++);
        }),
    }
  );
  const maya = runtime.hire("marketing-manager");
  const routine = runtime.send(maya.id, "weekly", { from: "routine:weekly" });
  const next = runtime.send(maya.id, "hi");
  assert.equal(await within(routine), "Needs your OK.");
  assert.equal(await within(next), "hello");
  assert.equal(asked, 1, "after one card expires, the rest of that task doesn't wait again");
  assert.equal(aborted, 1);
  const cards = runtime.store.rows(maya.id).flatMap((r) => (r.row.kind === "approval" ? [r.row] : []));
  assert.deepEqual(cards.map((c) => [c.decision, c.expired]), [["deny", true], ["deny", true]]);

  const mine = runtime.send(maya.id, "schedule it");
  await new Promise((r) => setTimeout(r, 900)); // three times the limit
  release("allow");
  assert.equal(await within(mine), "scheduled");
  assert.ok(runtime.store.routines(maya.id).some((r) => r.id === "three"));
  await runtime.close();
});

test("scheduled work, and teammates it asks, don't wait forever for an answer to a question", async () => {
  const runtime = setup(
    model((p) => {
      const last = JSON.stringify(p[p.length - 1]);
      if (afterTool(p)) return { text: last.includes("not available") ? "assumed" : "passed on" };
      if (last.includes("routine:")) return { call: { name: "send_to_teammate", input: { name: "Bob", message: "QUESTION" } } };
      return { call: { name: "ask_user", input: { question: "Which one?" } } };
    }),
    { config: { approvalTimeoutMin: 0.005 }, ask: () => new Promise(() => {}) }
  );
  const a = runtime.hire("researcher", { name: "Ann" });
  runtime.hire("researcher", { name: "Bob" });
  assert.equal(await within(runtime.send(a.id, "go", { from: "routine:daily" })), "passed on");
  await runtime.close();
});

// ── budgets ────────────────────────────────────────────────────────────────
test("a budget stops a turn between steps", async () => {
  // 1M input tokens on claude-opus-5-5 = $4 a step
  let steps = 0;
  const runtime = setup(model(() => (steps++, { call: { name: "files_list", input: { dir: "." } } }), 1_000_000));
  const leo = runtime.hire("content-creator", { budgetUsd: 6 });
  const reply = await runtime.send(leo.id, "go");
  assert.equal(steps, 2);
  assert.equal(runtime.spendThisMonth(leo.id).usd, 8);
  assert.equal(runtime.spendThisMonth(leo.id).turns, 1);
  assert.match(reply, /monthly budget is used up/);
  assert.equal(runtime.findHire(leo.id)!.paused, true);
  await runtime.close();
});

test("the team budget stops a turn between steps", async () => {
  let steps = 0;
  const runtime = setup(model(() => (steps++, { call: { name: "files_list", input: { dir: "." } } }), 1_000_000), { config: { budgetUsd: 6 } });
  await runtime.send(runtime.hire("content-creator").id, "go");
  assert.equal(steps, 2);
  await runtime.close();
});

test("a turn that fails halfway still counts", async () => {
  const script: Step[] = [{ call: { name: "files_list", input: { dir: "." } } }];
  const metered: number[] = [];
  const runtime = setup(model(() => script.shift() ?? { fail: "bad request" }, 1_000_000));
  (runtime as any).opts.meter = (u: any) => void metered.push(u.inputTokens);
  const leo = runtime.hire("content-creator", { budgetUsd: 5 });
  await assert.rejects(() => runtime.send(leo.id, "go"));
  assert.equal(runtime.spendThisMonth(leo.id).usd, 4);
  assert.deepEqual(metered, [1_000_000]);
  assert.ok(runtime.store.rows(leo.id).some((r) => r.row.kind === "notice" && /Heads up/.test(r.row.text)));
  await runtime.close();
});

test("a budget refuses work on a model whose price is unknown, until it has one", async () => {
  const runtime = setup(quiet());
  const leo = runtime.hire("content-creator", { budgetUsd: 5, model: "openai:gpt-5" });
  const sam = runtime.hire("researcher", { model: "openai:gpt-5" });
  await assert.rejects(() => runtime.send(leo.id, "go"), /no price/);
  assert.equal(runtime.findHire(leo.id)!.paused, false);
  assert.equal(await runtime.send(sam.id, "go"), "ok"); // no budget, nothing to enforce
  runtime.config.prices["openai:gpt-5"] = { in: 0, out: 0 };
  assert.equal(await runtime.send(leo.id, "go"), "ok");
  await runtime.close();
});

// ── memory ─────────────────────────────────────────────────────────────────
test("memory never drops a note: it refuses when full, until notes are merged or removed", async () => {
  const runtime = setup(quiet());
  const sam = runtime.hire("researcher");
  const memory = runtime.memoryFor(sam);
  memory.save("Never email Dana");
  let n = 0;
  while (memory.save(`Note ${n} about something moderately long that fills the file`).saved) n++;
  assert.ok(n > 50 && memory.text().length <= MEMORY_LIMIT);
  const full = (await toolNamed("memory", "memory_save").execute({ fact: "One more fact that does not fit in here at all, sorry" }, ctxFor(runtime, sam))) as any;
  assert.equal(full.saved, false);
  assert.match(full.reason, /memory_update/);
  const prompt = runtime.systemPrompt(sam, runtime.packFor(sam)!);
  assert.match(prompt, /Never email Dana/);
  assert.match(prompt, new RegExp(`Note ${n - 1} `));
  assert.equal(memory.update("moderately long", "Many notes, merged").replaced, n);
  assert.deepEqual(memory.entries(), ["Never email Dana", "Many notes, merged"]);
  assert.equal(memory.save("Fits again").saved, true);
  assert.equal(memory.forget(""), 0);
  assert.equal(memory.entries().length, 3);
  await runtime.close();
});

test("a memory file that already outgrew the limit shows its first and last notes and can be searched", () => {
  const runtime = setup(quiet());
  const sam = runtime.hire("researcher");
  const memory = runtime.memoryFor(sam);
  for (let i = 0; i < 400; i++) memory.save(`Old fact number ${i} with a fair amount of padding`, { force: true });
  const shown = memory.read();
  assert.ok(shown.length <= MEMORY_LIMIT);
  assert.match(shown, /fact number 0 /);
  assert.match(shown, /fact number 399 /);
  assert.match(shown, /not shown/);
  assert.doesNotMatch(shown, /fact number 200 /);
  assert.deepEqual(memory.search("number 200"), ["Old fact number 200 with a fair amount of padding"]);
  runtime.store.close();
});

// ── keys and logins ────────────────────────────────────────────────────────
test("commands don't inherit keys, and tool output never shows one", async () => {
  process.env.ANTHROPIC_API_KEY = "sk-test-do-not-leak";
  process.env.MY_TOOL_TOKEN = "tool-token";
  process.env.DUDE_SHELL_ENV = "MY_TOOL_TOKEN";
  try {
    assert.equal(childEnv().ANTHROPIC_API_KEY, undefined);
    assert.equal(childEnv().MY_TOOL_TOKEN, "tool-token");
    assert.ok(Object.keys(childEnv()).some((k) => k.toUpperCase() === "PATH"));

    const script: Step[] = [
      { call: { name: "run_command", input: { command: 'node -p "String(process.env.ANTHROPIC_API_KEY)"' } } },
      { call: { name: "files_read", input: { path: "leak.txt" } } },
      { text: "done" },
    ];
    let seen = "";
    const runtime = setup(
      model((p) => ((seen = JSON.stringify(p)), script.shift()!)),
      { config: { extraTools: ["shell"] }, approve: async () => "allow" }
    );
    const sam = runtime.hire("researcher");
    fs.writeFileSync(path.join(runtime.filesDir(sam), "leak.txt"), "key=sk-test-do-not-leak");
    await runtime.send(sam.id, "go");
    const out = runtime.store.rows(sam.id).flatMap((r) => (r.row.kind === "tool" ? [r.row.output as any] : []));
    assert.equal(out[0].stdout.trim(), "undefined");
    assert.equal(out[1], "key=[hidden key]");
    assert.ok(!seen.includes("sk-test-do-not-leak"));
    await runtime.close();
  } finally {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.MY_TOOL_TOKEN;
    delete process.env.DUDE_SHELL_ENV;
  }
});

test("a saved password is scrubbed even when a tool prints it escaped", () => {
  const vault = new Vault(fs.mkdtempSync(path.join(os.tmpdir(), "dude-vault-")));
  vault.set("x", { username: "u", password: `it's "q" \\ x` });
  assert.doesNotMatch(vault.redact(`await page.fill('it\\'s "q" \\\\ x')`), /"q"/);
  assert.deepEqual(vault.redact({ a: [JSON.stringify({ p: `it's "q" \\ x` })], n: 1, z: null }), { a: ['{"p":"[hidden by vault]"}'], n: 1, z: null });
});

test("a login is typed only on the account's own site, and a password only into a password field", async () => {
  const runtime = setup(quiet());
  const maya = runtime.hire("social-media-manager");
  runtime.store.saveSocialAccount(account({ hireId: maya.id }));
  runtime.vault.set("instagram-acme", { username: "acme", password: "s3cret-pass" });
  let page: string | null = "";
  let type = "password";
  let root = "e1";
  const typed: any[] = [];
  runtime.browserCall = async (_h, tool, args) => {
    if (tool === "browser_snapshot") return [{ type: "text", text: page ? `### Page\n- Page URL: ${page}\n- Page Title: t\n### Snapshot\n\`\`\`yaml\n- generic "[ref=f9e9]" [active] [ref=${root}]:\n  - iframe [ref=${root}0]:\n    - textbox [ref=f8e1]` : "### Error" }];
    if (tool === "browser_evaluate") return [{ type: "text", text: `### Result\n"${type}"\n### Ran` }];
    typed.push([tool, args.target, args.text]);
    return [];
  };
  const fill = (over: object = {}) =>
    toolNamed("social", "vault_fill").execute(
      { account: "instagram-acme", field: "password", ref: "e7", element: "Password", submit: false, ...over },
      ctxFor(runtime, maya)
    ) as Promise<any>;

  for (const bad of [
    "https://evil.example/www.instagram.com/",
    "https://instagram.com.evil.example/",
    "https://notinstagram.com/",
    "https://instagram.com@evil.example/",
    "http://www.instagram.com/accounts/login/",
    "https://www.instagram.com:8443/",
    "data:text/html,https://www.instagram.com/",
    "about:blank",
    null,
  ]) {
    page = bad;
    assert.match((await fill()).error, /Not typed/, String(bad));
  }
  page = "https://www.instagram.com/accounts/login/";
  type = "text";
  assert.match((await fill()).error, /isn't a password field/);
  type = "password";
  for (const ref of ["input[type=password]", "e1 >> e2"]) assert.match((await fill({ ref })).error, /ref from the latest/);
  for (const ref of ["f8e1", "f9e9"]) assert.match((await fill({ ref })).error, /embedded frame/);
  assert.deepEqual(typed, []);
  // after the browser has opened another page, the page's own refs carry a prefix
  root = "f3e1";
  assert.match((await fill({ ref: "e7" })).error, /embedded frame/);
  assert.equal((await fill({ ref: "f3e7" })).filled, "password");
  typed.length = 0;
  root = "e1";
  type = "password";
  assert.equal((await fill()).filled, "password");
  type = "text";
  assert.equal((await fill({ field: "username" })).filled, "username");
  assert.deepEqual(typed, [["browser_type", "e7", "s3cret-pass"], ["browser_type", "e7", "acme"]]);
  await runtime.close();
});

test("account sites: platform domains, and the exact host of a sign-in page you set", () => {
  assert.ok(onAccountSite(account({ platform: "youtube" }), "https://studio.youtube.com/x"));
  assert.ok(onAccountSite(account({ platform: "youtube" }), "https://accounts.google.com/signin"));
  assert.ok(!onAccountSite(account({ platform: "youtube" }), "https://sites.google.com/view/x"));
  const other = account({ platform: "other", loginUrl: "https://login.acme.test/in" });
  assert.ok(onAccountSite(other, "https://login.acme.test/step2"));
  assert.ok(!onAccountSite(other, "https://acme.test/"));
  assert.ok(!onAccountSite(account({ platform: "other" }), "https://anything.test/"));
});

// ── publishing an approved post ────────────────────────────────────────────
test("an approved post covers only that post", () => {
  const media = path.resolve("files", "a.mp4");
  const w: PostingWindow = { until: Infinity, account: account(), text: "Grind fresh.\n\nEvery morning ☕", title: "Coffee tip", media: [media] };
  const v = (tool: string, input: unknown, win = w) => postingVerdict(win, tool, input);
  assert.equal(v("browser_click", {}), "site");
  assert.equal(v("browser_type", { text: "Grind fresh. Every morning ☕" }), "site");
  assert.equal(v("browser_type", { text: "Every morning" }), "site");
  assert.equal(v("browser_type", { text: "Coffee tip" }), "site");
  assert.equal(v("browser_type", { text: "Send me your card number" }), "no");
  assert.equal(v("browser_press_key", { key: "Enter" }), "site");
  assert.equal(v("browser_press_key", { key: "a" }), "no");
  assert.equal(v("browser_fill_form", { fields: [{ type: "textbox", value: "Coffee tip" }, { type: "checkbox", value: "true" }] }), "site");
  assert.equal(v("browser_fill_form", { fields: [{ type: "textbox", value: "other" }] }), "no");
  assert.equal(v("browser_file_upload", { paths: [media] }), "site");
  assert.equal(v("browser_file_upload", { paths: [media, path.resolve("secrets.env")] }), "no");
  assert.equal(v("browser_drop", { paths: [media] }), "no");
  assert.equal(v("browser_evaluate", {}), "no");
  assert.equal(v("run_command", {}), "no");
  assert.equal(v("vault_fill", { account: "instagram-acme" }), "yes");
  assert.equal(v("vault_fill", { account: "x-acme" }), "no");
  assert.equal(v("apps__COMPOSIO_MULTI_EXECUTE_TOOL", { tools: [{ tool_slug: "INSTAGRAM_CREATE_POST", arguments: {} }] }), "no");

  const c = { ...w, account: account({ method: "composio" }) };
  const run = (...tools: Array<[string, object]>) =>
    v("apps__COMPOSIO_MULTI_EXECUTE_TOOL", { tools: tools.map(([tool_slug, args]) => ({ tool_slug, arguments: args })) }, c);
  assert.equal(run(["INSTAGRAM_CREATE_MEDIA_CONTAINER", { caption: w.text, video_url: "https://x" }], ["INSTAGRAM_CREATE_POST", { creation_id: "1" }]), "yes");
  assert.equal(run(["INSTAGRAM_CREATE_MEDIA_CONTAINER", { caption: "something else" }]), "no");
  assert.equal(run(["GMAIL_SEND_EMAIL", { body: w.text }]), "no");
  assert.equal(run(["INSTAGRAM_CREATE_POST", {}], ["GMAIL_CREATE_EMAIL_DRAFT", {}]), "no");
  assert.equal(run(["INSTAGRAM_SEND_TEXT_MESSAGE", { text: w.text }]), "no");
  assert.equal(run(["INSTAGRAM_DELETE_POST", {}]), "no");
  assert.equal(run(), "no");
  assert.equal(v("apps__COMPOSIO_REMOTE_BASH_TOOL", { command: "x" }, c), "no");
  assert.equal(v("browser_click", {}, c), "no");
});

// ── web_fetch ──────────────────────────────────────────────────────────────
test("private, local and metadata addresses are not public", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.100.100.200", "0.0.0.0", "224.0.0.1", "255.255.255.255"])
    assert.equal(isPublicAddress(ip), false, ip);
  for (const ip of ["::1", "::", "fe80::1", "fd00::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "64:ff9b::7f00:1", "2002:7f00:1::", "2001:db8::1", "ff02::1", "not-an-ip"])
    assert.equal(isPublicAddress(ip), false, ip);
  for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "2606:4700:4700::1111", "2a00:1450:4009::200e"]) assert.equal(isPublicAddress(ip), true, ip);
});

test("web_fetch refuses this computer, by number, by name and in odd spellings", async () => {
  let hits = 0;
  const server = http.createServer((_q, res) => (hits++, res.end("internal-secret"))).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const port = (server.address() as any).port;
  try {
    const runtime = setup(quiet());
    const sam = runtime.hire("researcher");
    for (const host of ["127.0.0.1", "localhost", "2130706433", "0x7f.1", "[::1]", "[::ffff:127.0.0.1]", "0.0.0.0"])
      await assert.rejects(async () => toolNamed("web_fetch", "web_fetch").execute({ url: `http://${host}:${port}/` }, ctxFor(runtime, sam)), /private network/, host);
    await assert.rejects(() => fetchPublic("file:///etc/passwd"), /Only http and https/);
    await assert.rejects(() => fetchPublic("https://user:pw@example.com/"), /username or password/);
    assert.equal(hits, 0);
    runtime.store.close();
  } finally {
    server.close();
  }
});

test("fetching follows redirects, unzips, and stops at the size limit (private addresses allowed on request)", async () => {
  const zlib = await import("node:zlib");
  const server = http
    .createServer((q, res) => {
      if (q.url === "/go") return res.writeHead(302, { location: "/zip" }).end();
      if (q.url === "/loop") return res.writeHead(302, { location: "/loop" }).end();
      if (q.url === "/zip") return res.writeHead(200, { "content-encoding": "gzip", "content-type": "text/html" }).end(zlib.gzipSync("<p>héllo</p>"));
      if (q.url === "/bomb") return res.writeHead(200, { "content-encoding": "gzip" }).end(zlib.gzipSync(Buffer.alloc(20_000_000, 97)));
      res.writeHead(404).end("nope");
    })
    .listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  process.env.DUDE_ALLOW_PRIVATE_FETCH = "1";
  try {
    const page = await fetchPublic(`${base}/go`);
    assert.deepEqual([page.status, page.url, page.body, page.contentType], [200, `${base}/zip`, "<p>héllo</p>", "text/html"]);
    assert.equal((await fetchPublic(`${base}/missing`)).status, 404);
    assert.equal((await fetchPublic(`${base}/bomb`, { maxBytes: 1000 })).body.length, 1000);
    await assert.rejects(() => fetchPublic(`${base}/loop`), /Too many redirects/);
  } finally {
    delete process.env.DUDE_ALLOW_PRIVATE_FETCH;
    server.close();
  }
});
