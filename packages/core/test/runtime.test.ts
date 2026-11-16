import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV2 } from "ai/test";
import { packsDir } from "@dude/employees";
import { DEFAULT_CONFIG, Runtime, TOOL_GROUPS, type ApprovalDecision } from "../src/index.js";

type Step = { text?: string; call?: { name: string; input: unknown } };

/** A fake model that plays back one scripted step per model call. */
function scripted(steps: Step[]) {
  let i = 0;
  return new MockLanguageModelV2({
    doStream: async () => {
      const step = steps[i++] ?? { text: "(script ended)" };
      const chunks: any[] = [{ type: "stream-start", warnings: [] }];
      if (step.text) {
        chunks.push({ type: "text-start", id: "t" }, { type: "text-delta", id: "t", delta: step.text }, { type: "text-end", id: "t" });
      }
      if (step.call) {
        chunks.push({ type: "tool-call", toolCallId: `c${i}`, toolName: step.call.name, input: JSON.stringify(step.call.input) });
      }
      chunks.push({
        type: "finish",
        finishReason: step.call ? "tool-calls" : "stop",
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      });
      return { stream: simulateReadableStream({ chunks }) };
    },
  });
}

function setup(steps: Step[], approve?: () => Promise<ApprovalDecision>) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "dude-test-"));
  const model = scripted(steps);
  const runtime = new Runtime(home, {
    packDirs: [packsDir],
    config: { ...structuredClone(DEFAULT_CONFIG), company: { name: "Acme" }, globalSkills: false },
    resolveModel: () => model,
    browser: false,
    approve: approve ? () => approve() : undefined,
  });
  return { home, runtime };
}

test("built-in packs load with their skills", () => {
  const { runtime } = setup([]);
  for (const id of ["marketing-manager", "content-creator", "caller", "researcher"]) {
    assert.ok(runtime.packs.has(id), `missing pack ${id}`);
  }
  assert.ok(runtime.packs.get("content-creator")!.skills.some((s) => s.name === "blog-post"));
  for (const pack of runtime.packs.values()) {
    for (const group of pack.tools) {
      assert.ok(group === "browser" || TOOL_GROUPS[group], `${pack.id} lists unknown tool group ${group}`);
    }
  }
  runtime.store.close();
});

test("a turn runs tools, saves memory, records rows and usage", async () => {
  const { runtime } = setup([
    { call: { name: "memory_save", input: { fact: "Acme sells course bundles to students" } } },
    { text: "Noted, I will remember that." },
  ]);
  const maya = runtime.hire("marketing-manager");
  const reply = await runtime.send("Maya", "We sell course bundles to students.");
  assert.equal(reply, "Noted, I will remember that.");
  assert.match(runtime.memoryFor(maya).read(), /course bundles/);
  const kinds = runtime.store.rows(maya.id).map((r) => r.row.kind);
  assert.deepEqual(kinds, ["message", "tool", "message"]);
  assert.equal(runtime.store.usageSummary()[0].inputTokens, 20);
  assert.match(runtime.systemPrompt(maya, runtime.packFor(maya)!), /course bundles/);
  await runtime.close();
});

test("write actions wait for approval and a refusal is returned to the model", async () => {
  const { runtime } = setup(
    [
      { call: { name: "routine_add", input: { id: "daily", cron: "0 9 * * *", prompt: "check" } } },
      { text: "Okay, I won't schedule it." },
    ],
    async () => "deny"
  );
  const leo = runtime.hire("content-creator");
  await runtime.send(leo.id, "schedule a daily check");
  assert.equal(runtime.store.routines(leo.id).filter((r) => r.source === "user").length, 0);
  const approval = runtime.store.rows(leo.id).find((r) => r.row.kind === "approval");
  assert.equal(approval?.row.kind === "approval" && approval.row.decision, "deny");
  await runtime.close();
});

test("'always allow' is remembered, but never for calls", async () => {
  const { runtime } = setup(
    [
      { call: { name: "routine_add", input: { id: "daily", cron: "0 9 * * *", prompt: "check" } } },
      { text: "Scheduled." },
    ],
    async () => "always"
  );
  const leo = runtime.hire("content-creator");
  await runtime.send(leo.id, "schedule a daily check");
  assert.equal(runtime.store.getPolicy(leo.id, "routine_add"), "auto");
  assert.equal(runtime.store.routines(leo.id).find((r) => r.id === "daily")?.enabled, true);

  const riya = runtime.hire("caller");
  runtime.store.setPolicy(riya.id, "phone_call", "auto");
  const ctx = { hire: riya, pack: runtime.packFor(riya)!, runtime, chain: [] };
  const phoneCall = TOOL_GROUPS.phone.find((t) => t.name === "phone_call")!;
  assert.equal(runtime.policyFor(ctx, phoneCall), "ask");
  await runtime.close();
});

test("employees can hand work to a teammate, without loops", async () => {
  const { runtime } = setup([
    { call: { name: "send_to_teammate", input: { name: "Leo", message: "Draft a hook for the React course" } } },
    { text: "Stop scrolling: you can ship a React app this weekend." },
    { text: "Leo suggests: Stop scrolling..." },
  ]);
  const maya = runtime.hire("marketing-manager");
  const leo = runtime.hire("content-creator");
  const reply = await runtime.send(maya.id, "Get me a hook from Leo");
  assert.equal(reply, "Leo suggests: Stop scrolling...");
  const leoRows = runtime.store.rows(leo.id);
  assert.equal(leoRows[0].row.kind === "message" && leoRows[0].row.from, "Maya");

  const send = TOOL_GROUPS.team.find((t) => t.name === "send_to_teammate")!;
  const result: any = await send.execute(
    { name: "Maya", message: "hi" },
    { hire: leo, pack: runtime.packFor(leo)!, runtime, chain: [maya.id] }
  );
  assert.match(result.error, /already part of this conversation/);
  await runtime.close();
});

test("file tools stay inside the employee's folder", async () => {
  const { runtime } = setup([]);
  const sam = runtime.hire("researcher");
  const ctx = { hire: sam, pack: runtime.packFor(sam)!, runtime, chain: [] };
  const write = TOOL_GROUPS.files.find((t) => t.name === "files_write")!;
  await write.execute({ path: "research/a.md", content: "# A" }, ctx);
  assert.ok(fs.existsSync(path.join(runtime.filesDir(sam), "research", "a.md")));
  await assert.rejects(() => write.execute({ path: "../../escape.md", content: "x" }, ctx), /outside your files folder/);
  await runtime.close();
});
