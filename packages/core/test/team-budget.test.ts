import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV2 } from "ai/test";
import { packsDir } from "@dude/employees";
import { DEFAULT_CONFIG, Runtime, costOf, exportTeam, importTeam, priceFor } from "../src/index.js";

/** A model that always answers "ok" and reports the given token usage. */
function model(inputTokens: number, outputTokens: number, seen?: { prompt: string }) {
  return new MockLanguageModelV2({
    doStream: async (options: any) => {
      if (seen) seen.prompt = JSON.stringify(options.prompt);
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: "text-start", id: "t" },
            { type: "text-delta", id: "t", delta: "ok" },
            { type: "text-end", id: "t" },
            { type: "finish", finishReason: "stop", usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens } },
          ] as any,
        }),
      };
    },
  });
}

function setup(m: MockLanguageModelV2, config: Partial<typeof DEFAULT_CONFIG> = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "dude-budget-"));
  return new Runtime(home, {
    packDirs: [packsDir],
    config: { ...structuredClone(DEFAULT_CONFIG), globalSkills: false, ...config },
    resolveModel: () => m,
    browser: false,
  });
}

test("known prices, your own prices, and free local models", () => {
  const cfg = { prices: { "groq:llama": { in: 1, out: 2 } } };
  assert.deepEqual(priceFor("anthropic:claude-opus-5-5", cfg), { in: 4, out: 20 });
  assert.deepEqual(priceFor("groq:llama", cfg), { in: 1, out: 2 });
  assert.deepEqual(priceFor("ollama:qwen3", cfg), { in: 0, out: 0 });
  assert.equal(priceFor("openai:gpt-5", cfg), null);
  assert.equal(costOf("anthropic:claude-opus-5-5", 1_000_000, 100_000, cfg), 6);
});

test("an employee pauses at their budget and the next task is refused", async () => {
  // claude-opus-5-5: 1M input tokens = $4, so each turn below costs $4
  const runtime = setup(model(1_000_000, 0));
  const leo = runtime.hire("content-creator", { budgetUsd: 5 });
  await runtime.send(leo.id, "first");
  assert.equal(runtime.findHire(leo.id)!.paused, false);
  assert.ok(runtime.store.rows(leo.id).some((r) => r.row.kind === "notice" && /Heads up/.test(r.row.text)));
  await runtime.send(leo.id, "second"); // $8 spent, over $5
  assert.equal(runtime.findHire(leo.id)!.paused, true);
  assert.equal(runtime.spendThisMonth(leo.id).usd, 8);
  await assert.rejects(() => runtime.send(leo.id, "third"), /paused/);

  runtime.setBudget(leo.id, 50);
  runtime.setPaused(leo.id, false);
  assert.equal(await runtime.send(leo.id, "fourth"), "ok");
  await runtime.close();
});

test("the team budget stops new work for everyone", async () => {
  const runtime = setup(model(1_000_000, 0), { budgetUsd: 3 });
  const maya = runtime.hire("marketing-manager");
  const sam = runtime.hire("researcher");
  await runtime.send(maya.id, "go"); // $4 > $3
  await assert.rejects(() => runtime.send(sam.id, "go"), /team reached its \$3 monthly budget/);
  await runtime.close();
});

test("goals reach every employee, and routines can run on demand", async () => {
  const seen = { prompt: "" };
  const runtime = setup(model(10, 10, seen), { goals: ["Grow sign-ups 20% this quarter"] });
  const leo = runtime.hire("content-creator");
  assert.match(runtime.systemPrompt(leo, runtime.packFor(leo)!), /Grow sign-ups 20% this quarter/);
  runtime.store.upsertRoutine({ id: "weekly", hireId: leo.id, cron: "0 9 * * 1", prompt: "Plan next week", enabled: false, source: "user", lastRunAt: null });
  await runtime.runRoutine(leo.id, "weekly");
  assert.match(seen.prompt, /Plan next week/);
  assert.ok(runtime.store.routines(leo.id)[0].lastRunAt);
  const first = runtime.store.rows(leo.id)[0].row;
  assert.equal(first.kind === "message" && first.from, "routine:weekly");
  await runtime.close();
});

test("teams export without keys and import into another workspace", async () => {
  const a = setup(model(1, 1), { goals: ["Ship the launch"], company: { name: "Acme" } });
  fs.mkdirSync(path.join(a.home, "skills", "brand-voice"), { recursive: true });
  fs.writeFileSync(path.join(a.home, "skills", "brand-voice", "SKILL.md"), "---\nname: brand-voice\ndescription: Voice\n---\nBe brief.");
  fs.writeFileSync(path.join(a.home, "secrets.env"), "OPENAI_API_KEY=sk-should-never-leave\n");
  const leo = a.hire("content-creator", { budgetUsd: 20 });
  a.store.setPolicy(leo.id, "routine_add", "auto");
  a.memoryFor(leo).save("Brand color is violet");

  const file = exportTeam(a);
  const text = JSON.stringify(file);
  assert.ok(!text.includes("sk-should-never-leave"));
  assert.ok(!text.includes("Brand color is violet")); // memory only when asked
  assert.ok(JSON.stringify(exportTeam(a, { withMemory: true })).includes("Brand color is violet"));

  const b = setup(model(1, 1));
  b.hire("content-creator", { name: "Leo" }); // name clash
  const r = importTeam(b, JSON.parse(text));
  assert.deepEqual(r.hired.map((h) => h.name), ["Leo 2"]);
  assert.deepEqual(r.skills, ["brand-voice"]);
  const leo2 = b.findHire("Leo 2")!;
  assert.equal(leo2.budgetUsd, 20);
  assert.equal(b.store.getPolicy(leo2.id, "routine_add"), "auto");
  assert.deepEqual(b.config.goals, ["Ship the launch"]);
  assert.equal(b.config.company.name, "Acme");
  assert.ok(b.skillsFor(b.packFor(leo2)!).some((s) => s.name === "brand-voice"));
  assert.throws(() => importTeam(b, { format: "something-else" }), /isn't a dudee team file/);
  await a.close();
  await b.close();
});
