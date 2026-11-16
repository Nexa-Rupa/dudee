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
  PROVIDERS,
  Runtime,
  TOOL_GROUPS,
  installSkills,
  keySource,
  listModels,
  loadSecrets,
  parseModelId,
  readSecrets,
  resolveModel,
  setCustomProviders,
  setSecret,
} from "../src/index.js";

function tmp(prefix: string) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeSkill(root: string, name: string, body: string, extra: Record<string, string> = {}) {
  const dir = path.join(root, name);
  fs.mkdirSync(path.join(dir, "references"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: Test skill ${name}\nargument-hint: "<topic>"\n---\n${body}\n`
  );
  for (const [f, text] of Object.entries(extra)) fs.writeFileSync(path.join(dir, f), text);
  return dir;
}

test("pack skills load in the Agent Skills format with bundled files", () => {
  const home = tmp("dude-sk-");
  const runtime = new Runtime(home, { packDirs: [packsDir], config: { ...structuredClone(DEFAULT_CONFIG), globalSkills: false } });
  const social = runtime.packs.get("content-creator")!.skills.find((s) => s.name === "social-pack")!;
  assert.ok(social.dir?.endsWith("social-pack"));
  assert.deepEqual(social.files, ["references/platform-limits.md"]);
  assert.equal(social.argumentHint, "<idea, link or file to repurpose>");
  runtime.store.close();
});

test("workspace skills are shared, readable, and runnable as /commands", async () => {
  const home = tmp("dude-sk-");
  writeSkill(path.join(home, "skills"), "brand-voice", "Write like a friendly expert. See references/voice.md.", {
    "references/voice.md": "Short sentences. No jargon.",
  });
  let seen = "";
  const model = new MockLanguageModelV2({
    doStream: async (options: any) => {
      seen = JSON.stringify(options.prompt);
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: "text-start", id: "t" },
            { type: "text-delta", id: "t", delta: "Done." },
            { type: "text-end", id: "t" },
            { type: "finish", finishReason: "stop", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } },
          ] as any,
        }),
      };
    },
  });
  const runtime = new Runtime(home, {
    packDirs: [packsDir],
    config: { ...structuredClone(DEFAULT_CONFIG), globalSkills: false },
    resolveModel: () => model,
    browser: false,
  });
  const sam = runtime.hire("researcher");
  const pack = runtime.packFor(sam)!;
  const names = runtime.skillsFor(pack).map((s) => s.name);
  assert.ok(names.includes("brand-voice") && names.includes("prospect-list"));
  assert.match(runtime.systemPrompt(sam, pack), /brand-voice: Test skill brand-voice/);

  const ctx = { hire: sam, pack, runtime, chain: [] };
  const use = TOOL_GROUPS.skills.find((t) => t.name === "use_skill")!;
  const loaded = String(await use.execute({ name: "brand-voice" }, ctx));
  assert.match(loaded, /friendly expert/);
  assert.match(loaded, /references\/voice\.md/);
  const read = TOOL_GROUPS.skills.find((t) => t.name === "read_skill_file")!;
  assert.equal(await read.execute({ skill: "brand-voice", path: "references/voice.md" }, ctx), "Short sentences. No jargon.");
  await assert.rejects(() => read.execute({ skill: "brand-voice", path: "../../secrets.env" }, ctx), /outside the skill folder/);

  await runtime.send(sam.id, "/brand-voice launch post");
  assert.match(seen, /The user ran \/brand-voice launch post/);
  assert.match(seen, /friendly expert/);
  const first = runtime.store.rows(sam.id)[0].row;
  assert.equal(first.kind === "message" && first.text, "/brand-voice launch post"); // transcript keeps what was typed
  await runtime.close();
});

test("skills install from a folder of skill folders", () => {
  const src = tmp("dude-src-");
  writeSkill(path.join(src, ".claude", "skills"), "one", "1");
  writeSkill(path.join(src, "skills"), "two", "2");
  const home = tmp("dude-sk-");
  assert.deepEqual(installSkills(src, home).sort(), ["one", "two"]);
  assert.ok(fs.existsSync(path.join(home, "skills", "two", "SKILL.md")));
});

test("every built-in provider parses and resolves", () => {
  const env: NodeJS.ProcessEnv = {};
  for (const p of PROVIDERS) if (p.keyEnv) env[p.keyEnv] = "test-key";
  for (const p of PROVIDERS) {
    const id = `${p.id}:${p.models[0] ?? "some-model"}`;
    assert.equal(parseModelId(id).provider, p.id);
    assert.ok(resolveModel(id, env), `could not build ${id}`);
  }
  for (const id of ["groq", "openrouter", "deepseek", "moonshot", "zai", "qwen", "9router", "google", "openai"]) {
    assert.ok(PROVIDERS.some((p) => p.id === id), `missing ${id}`);
  }
  assert.throws(() => resolveModel("groq:x", {}), /GROQ_API_KEY/);
  assert.throws(() => parseModelId("nope:x"), /Unknown provider/);
});

test("custom OpenAI-compatible providers list their models", async () => {
  const server = http.createServer((req, res) => {
    assert.equal(req.headers.authorization, "Bearer sk-local");
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: [{ id: "my-model" }, { id: "another" }] }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as any).port;
  setCustomProviders({ myproxy: { baseURL: `http://127.0.0.1:${port}/v1`, keyEnv: "MYPROXY_KEY" } });
  try {
    assert.deepEqual(await listModels("myproxy", { MYPROXY_KEY: "sk-local" }), ["another", "my-model"]);
    assert.equal(parseModelId("myproxy:my-model").model, "my-model");
  } finally {
    setCustomProviders({});
    server.close();
  }
});

test("keys are saved privately and loaded without overriding the real environment", () => {
  const home = tmp("dude-keys-");
  const env: NodeJS.ProcessEnv = { OPENAI_API_KEY: "from-env" };
  setSecret(home, "GROQ_API_KEY", "gsk_saved", env);
  setSecret(home, "OPENAI_API_KEY", "saved-openai", env);
  assert.deepEqual(readSecrets(home), { GROQ_API_KEY: "gsk_saved", OPENAI_API_KEY: "saved-openai" });
  const fresh: NodeJS.ProcessEnv = { OPENAI_API_KEY: "from-env" };
  loadSecrets(home, fresh);
  assert.equal(fresh.GROQ_API_KEY, "gsk_saved");
  assert.equal(fresh.OPENAI_API_KEY, "from-env");
  assert.equal(keySource(home, "GROQ_API_KEY", fresh), "saved");
  setSecret(home, "GROQ_API_KEY", null, fresh);
  assert.equal(fresh.GROQ_API_KEY, undefined);
  assert.throws(() => setSecret(home, "X", "a\nb", fresh), /line breaks/);
});
