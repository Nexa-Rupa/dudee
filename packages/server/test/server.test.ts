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
