import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV2 } from "ai/test";
import { packsDir } from "@dude/employees";
import {
  DEFAULT_CONFIG,
  Runtime,
  TOOL_GROUPS,
  Vault,
  composioPolicy,
  normalizePlan,
  planCron,
  routineIdFor,
  syncAutopost,
  totp,
  type ApprovalRequest,
  type SocialAccount,
} from "../src/index.js";

type Step = { text?: string; call?: { name: string; input: unknown } };

function scripted(steps: Step[]) {
  let i = 0;
  return new MockLanguageModelV2({
    doStream: async () => {
      const step = steps[i++] ?? { text: "(script ended)" };
      const chunks: any[] = [{ type: "stream-start", warnings: [] }];
      if (step.text) chunks.push({ type: "text-start", id: "t" }, { type: "text-delta", id: "t", delta: step.text }, { type: "text-end", id: "t" });
      if (step.call) chunks.push({ type: "tool-call", toolCallId: `c${i}`, toolName: step.call.name, input: JSON.stringify(step.call.input) });
      chunks.push({ type: "finish", finishReason: step.call ? "tool-calls" : "stop", usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } });
      return { stream: simulateReadableStream({ chunks }) };
    },
  });
}

function setup(steps: Step[], approve?: (req: ApprovalRequest) => Promise<"allow" | "deny" | "always">) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "dude-social-"));
  const runtime = new Runtime(home, {
    packDirs: [packsDir],
    config: { ...structuredClone(DEFAULT_CONFIG), globalSkills: false },
    resolveModel: () => scripted(steps),
    browser: false,
    approve,
  });
  return { home, runtime };
}

function account(hireId: string, over: Partial<SocialAccount> = {}): SocialAccount {
  return {
    id: "instagram-acme",
    platform: "instagram",
    handle: "@acme",
    method: "browser",
    loginUrl: null,
    hireId,
    autopost: normalizePlan({ enabled: true, time: "09:30", days: [1, 3, 5], format: "video", brief: "Coffee shop", topics: ["tips"] }),
    createdAt: new Date().toISOString(),
    ...over,
  };
}

test("TOTP matches the RFC 6238 test vector", () => {
  // secret "12345678901234567890" in base32
  assert.equal(totp("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 59_000, 30, 8), "94287082");
  assert.equal(totp("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 1_111_111_109_000, 30, 8), "07081804");
  assert.throws(() => totp("not base32!"), /base32/);
});

test("vault encrypts logins at rest and scrubs them from any output", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "dude-vault-"));
  const vault = new Vault(home);
  vault.set("x-acme", { username: "acme", password: "hunter2-secret", totpSecret: "JBSWY3DPEHPK3PXP" });
  const raw = fs.readFileSync(path.join(home, "vault.json"), "utf8");
  assert.ok(!raw.includes("hunter2-secret"), "password stored in plain text");
  assert.ok(!raw.includes("JBSWY3DPEHPK3PXP"), "TOTP secret stored in plain text");
  assert.equal(new Vault(home).get("x-acme")?.password, "hunter2-secret");
  assert.equal(vault.redact("typed hunter2-secret here"), "typed [hidden by vault] here");
  assert.deepEqual(vault.redact({ a: ["hunter2-secret"] }), { a: ["[hidden by vault]"] });
  assert.equal(vault.redact("nothing to hide"), "nothing to hide");
  assert.ok(vault.remove("x-acme"));
  assert.equal(vault.get("x-acme"), null);
});

test("an autopost plan becomes a routine on the poster", () => {
  const { runtime } = setup([]);
  const maya = runtime.hire("social-media-manager");
  const a = account(maya.id);
  assert.equal(planCron(a.autopost), "30 9 * * 1,3,5");
  assert.equal(planCron(normalizePlan({ time: "7:05" })), "5 7 * * *");
  assert.throws(() => normalizePlan({ time: "25:00" }), /HH:MM/);
  runtime.store.saveSocialAccount(a);
  syncAutopost(runtime, a);
  const r = runtime.store.routines(maya.id).find((x) => x.id === routineIdFor(a.id));
  assert.ok(r);
  assert.equal(r.enabled, true);
  assert.equal(r.source, "autopost");
  assert.match(r.prompt, /daily-autopost/);
  assert.match(r.prompt, /vault_fill/);
  // moving it to nobody removes the routine
  syncAutopost(runtime, { ...a, hireId: null });
  assert.equal(runtime.store.routines(maya.id).some((x) => x.id === routineIdFor(a.id)), false);
  runtime.store.close();
});

test("the social media manager pack has posting and video tools", () => {
  const { runtime } = setup([]);
  const pack = runtime.packs.get("social-media-manager");
  assert.ok(pack);
  for (const g of ["social", "video", "media", "browser"]) assert.ok(pack.tools.includes(g), `missing ${g}`);
  for (const s of ["daily-autopost", "remotion-video", "hyperframes-video"]) assert.ok(pack.skills.some((x) => x.name === s), `missing skill ${s}`);
  assert.ok(TOOL_GROUPS.social.some((t) => t.name === "vault_fill"));
  assert.ok(TOOL_GROUPS.video.some((t) => t.name === "video_render"));
  runtime.store.close();
});

test("publishing asks first, then opens a posting window for the browser", async () => {
  const asked: string[] = [];
  const { runtime } = setup(
    [
      { call: { name: "social_publish_request", input: { account: "instagram-acme", text: "Morning tip: grind fresh." } } },
      { text: "Approved; publishing." },
    ],
    async (req) => {
      asked.push(`${req.tool}: ${req.summary}`);
      return "allow";
    }
  );
  const maya = runtime.hire("social-media-manager");
  runtime.store.saveSocialAccount(account(maya.id, { autopost: normalizePlan({ approval: "ask" }) }));
  await runtime.send(maya.id, "post today");
  assert.equal(asked.length, 1);
  assert.match(asked[0], /Publish to instagram-acme: "Morning tip/);
  const posts = runtime.store.socialPosts();
  assert.equal(posts.length, 1);
  assert.equal(posts[0].status, "approved");
  assert.ok(runtime.postingOpen(maya.id));
  const pack = runtime.packFor(maya)!;
  const ctx = { hire: maya, pack, runtime, chain: [] };
  const click = { name: "browser_click", description: "", input: { jsonSchema: {} }, risk: "write" as const, defaultPolicy: "ask" as const, execute: async () => null };
  const evaluate = { ...click, name: "browser_evaluate", defaultPolicy: "deny" as const };
  let page = "https://www.instagram.com/";
  runtime.browserPage = async () => ({ url: page, refPrefix: "" });
  assert.equal(await runtime.postingAllows(ctx, click, {}), true);
  assert.equal(await runtime.postingAllows(ctx, { ...click, name: "browser_type" }, { text: "Morning tip: grind fresh." }), true);
  assert.equal(await runtime.postingAllows(ctx, { ...click, name: "browser_type" }, { text: "something else" }), false);
  assert.equal(await runtime.postingAllows(ctx, { ...click, alwaysAsk: true }, {}), false);
  assert.equal(runtime.policyFor(ctx, evaluate), "deny");
  page = "https://evil.example/";
  assert.equal(await runtime.postingAllows(ctx, click, {}), false);
  page = "https://www.instagram.com/";
  // a finished post, posted or failed, ends it
  await TOOL_GROUPS.social.find((t) => t.name === "social_record_post")!.execute({ postId: posts[0].id, status: "failed", error: "captcha" }, ctx);
  assert.equal(await runtime.postingAllows(ctx, click, {}), false);
  runtime.store.close();
});

test("an account set to post without asking skips the approval", async () => {
  let asked = 0;
  const { runtime } = setup(
    [{ call: { name: "social_publish_request", input: { account: "instagram-acme", text: "Hello" } } }, { text: "ok" }],
    async () => {
      asked++;
      return "deny";
    }
  );
  const maya = runtime.hire("social-media-manager");
  runtime.store.saveSocialAccount(account(maya.id, { autopost: normalizePlan({ approval: "auto" }) }));
  await runtime.send(maya.id, "post");
  assert.equal(asked, 0);
  assert.equal(runtime.store.socialPosts()[0]?.status, "approved");
  runtime.store.close();
});

test("tool output that echoes a saved password is scrubbed before the model and transcript see it", async () => {
  const { runtime } = setup([{ call: { name: "files_read", input: { path: "leak.txt" } } }, { text: "done" }]);
  const maya = runtime.hire("social-media-manager");
  runtime.vault.set("instagram-acme", { username: "acme", password: "s3cret-pass-123" });
  fs.writeFileSync(path.join(runtime.filesDir(maya), "leak.txt"), "the page said s3cret-pass-123");
  await runtime.send(maya.id, "read it");
  const tool = runtime.store.rows(maya.id).find((r) => r.row.kind === "tool");
  assert.ok(tool && tool.row.kind === "tool");
  assert.equal(JSON.stringify(tool.row.output).includes("s3cret-pass-123"), false);
  assert.match(JSON.stringify(tool.row.output), /hidden by vault/);
  runtime.store.close();
});

test("Composio lookups run freely, executes ask", () => {
  assert.equal(composioPolicy("COMPOSIO_SEARCH_TOOLS"), "auto");
  assert.equal(composioPolicy("COMPOSIO_MULTI_EXECUTE_TOOL"), undefined);
  assert.equal(composioPolicy("COMPOSIO_MANAGE_CONNECTIONS"), undefined);
});
