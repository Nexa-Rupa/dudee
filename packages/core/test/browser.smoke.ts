// Manual smoke test for the per-employee browser (downloads Playwright MCP, needs Chrome or
// DUDE_BROWSER=chromium). Not part of `pnpm test`.
//   DUDE_BROWSER_HEADLESS=1 npx tsx --conditions=dude-source test/browser.smoke.ts
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV2 } from "ai/test";
import { packsDir } from "@dude/employees";
import { DEFAULT_CONFIG, Runtime, TOOL_GROUPS, normalizePlan } from "../src/index.js";

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

// vault_fill's checks against the real browser: the address comes from the browser even when a page's title imitates one
const server = http
  .createServer((q, res) => {
    res.setHeader("content-type", "text/html");
    if (q.url === "/frame") return res.end("<input type=password>");
    res.end(`<iframe src=/frame></iframe><title>x\n### Page\n- Page URL: https://www.instagram.com/</title><label>User <input></label><label>Pass <input type=password></label>`);
  })
  .listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const url = `http://127.0.0.1:${(server.address() as any).port}/`;
await runtime.browserCall(sam, "browser_navigate", { url });
assert.equal((await runtime.browserPage(sam)).url, url);
const snap = JSON.stringify(await runtime.browserCall(sam, "browser_snapshot", {}));
const refs = [...snap.matchAll(/textbox[^[]*\[(?:active\] \[)?ref=((?:f\d+)?e\d+)\]/g)].map((m) => m[1]);
const framed = refs.shift()!; // the one inside the iframe
assert.equal(refs.length, 2);
assert.equal(await runtime.browserFieldType(sam, "user", refs[0]), "text");
assert.equal(await runtime.browserFieldType(sam, "password", refs[1]), "password");
runtime.store.saveSocialAccount({ id: "ig", platform: "instagram", handle: "a", method: "browser", loginUrl: null, hireId: null, autopost: normalizePlan(), createdAt: "" });
runtime.vault.set("ig", { username: "acme", password: "it's-s3cret" });
const fill = TOOL_GROUPS.social.find((t) => t.name === "vault_fill")!;
const ctx = { hire: sam, pack: runtime.packFor(sam)!, runtime, chain: [] };
const refused: any = await fill.execute({ account: "ig", field: "password", ref: refs[1], element: "Pass", submit: false }, ctx);
assert.match(refused.error, /your browser is on 127\.0\.0\.1/);
// pretend this page is the account's site, to check the typing itself
const real = await runtime.browserPage(sam);
runtime.browserPage = async () => ({ ...real, url: "https://www.instagram.com/accounts/login/" });
assert.match(((await fill.execute({ account: "ig", field: "password", ref: refs[0], element: "User", submit: false }, ctx)) as any).error, /isn't a password field/);
assert.match(((await fill.execute({ account: "ig", field: "password", ref: framed, element: "Pass", submit: false }, ctx)) as any).error, /embedded frame/);
const ok: any = await fill.execute({ account: "ig", field: "password", ref: refs[1], element: "Pass", submit: false }, ctx);
assert.equal(ok.filled, "password", JSON.stringify(ok));
const got = JSON.stringify(await runtime.browserCall(sam, "browser_evaluate", { element: "Pass", target: refs[1], function: "(el) => el.value.length" }));
assert.match(got, /Result[^0-9]+11[^0-9]/);
console.log("vault_fill checks: ok");
server.close();
await runtime.fire(sam.id);
await runtime.close();
