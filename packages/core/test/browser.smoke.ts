// Manual smoke test for the per-employee browser (downloads Playwright MCP, needs Chrome or
// DUDE_BROWSER=chromium). Not part of `pnpm test`.
//   DUDE_BROWSER_HEADLESS=1 npx tsx --conditions=dude-source test/browser.smoke.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV2 } from "ai/test";
import { packsDir } from "@dude/employees";
import { DEFAULT_CONFIG, Runtime } from "../src/index.js";

const steps = [
  { call: { name: "browser_navigate", input: { url: "https://example.com" } } },
  { text: "Opened example.com." },
];
let i = 0;
const model = new MockLanguageModelV2({
  doStream: async () => {
    const s: any = steps[i++] ?? { text: "done" };
    const chunks: any[] = [{ type: "stream-start", warnings: [] }];
    if (s.text) chunks.push({ type: "text-start", id: "t" }, { type: "text-delta", id: "t", delta: s.text }, { type: "text-end", id: "t" });
    if (s.call) chunks.push({ type: "tool-call", toolCallId: "c1", toolName: s.call.name, input: JSON.stringify(s.call.input) });
    chunks.push({ type: "finish", finishReason: s.call ? "tool-calls" : "stop", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } });
    return { stream: simulateReadableStream({ chunks }) };
  },
});

const home = fs.mkdtempSync(path.join(os.tmpdir(), "dude-browser-"));
const runtime = new Runtime(home, { packDirs: [packsDir], config: structuredClone(DEFAULT_CONFIG), resolveModel: () => model });
const sam = runtime.hire("researcher");
const screen = new Promise((resolve) => runtime.on((e) => e.type === "screen" && resolve(e)));
console.log("reply:", await runtime.send(sam.id, "open example.com"));
for (const { row } of runtime.store.rows(sam.id)) {
  if (row.kind !== "message") console.log(row.kind, JSON.stringify(row).slice(0, 300));
}
const shot: any = await Promise.race([screen, new Promise((r) => setTimeout(() => r(null), 15000))]);
console.log("screenshot:", shot ? `${shot.mime}, ${shot.data.length} base64 chars` : "none");
await runtime.fire(sam.id);
await runtime.close();
