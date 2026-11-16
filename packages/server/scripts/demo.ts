/**
 * Demo mode: the real web app and server with a scripted stand-in model, so you can try the
 * interface without an API key. Each message plays the same short scene: open a playbook,
 * save a draft, ask to schedule a routine (an approval card), then reply.
 *
 *   pnpm demo            (from the repo root)
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV2 } from "ai/test";
import { packsDir } from "@dude/employees";
import { webDir } from "@dude/web";
import { saveConfig, DEFAULT_CONFIG } from "@dude/core";
import { startServer } from "../src/index.js";

type Step = { text?: string; call?: { name: string; input: unknown } };

const scene: Step[] = [
  { text: "On it. I'll use my blog-post playbook.\n", call: { name: "use_skill", input: { name: "blog-post" } } },
  {
    call: {
      name: "files_write",
      input: {
        path: "drafts/launch-week.md",
        content:
          "# Launch week: what we shipped\n\n**Audience:** existing customers\n\n## The two-sentence version\nWe shipped faster onboarding and a new pricing page. Here is what changed and why.\n\n## What changed\n- Onboarding takes 3 steps instead of 7\n- Pricing shows the total up front\n",
      },
    },
  },
  { call: { name: "routine_add", input: { id: "weekly-recap", cron: "0 9 * * 1", prompt: "Draft the weekly recap post from last week's changes." } } },
  {
    text:
      "Draft saved as **drafts/launch-week.md**.\n\n- Angle: what changed for customers, not a feature list\n- Length: about 600 words once the examples are in\n\nI also asked to schedule a **weekly recap** every Monday at 9:00 so this becomes a habit.",
  },
];

function demoModel() {
  let i = 0;
  return new MockLanguageModelV2({
    doStream: async () => {
      const step = scene[i++ % scene.length];
      const chunks: any[] = [{ type: "stream-start", warnings: [] }];
      if (step.text) {
        chunks.push({ type: "text-start", id: "t" });
        for (const word of step.text.split(/(?<= )/)) chunks.push({ type: "text-delta", id: "t", delta: word });
        chunks.push({ type: "text-end", id: "t" });
      }
      if (step.call) chunks.push({ type: "tool-call", toolCallId: `c${i}`, toolName: step.call.name, input: JSON.stringify(step.call.input) });
      chunks.push({ type: "finish", finishReason: step.call ? "tool-calls" : "stop", usage: { inputTokens: 900, outputTokens: 120, totalTokens: 1020 } });
      return { stream: simulateReadableStream({ chunks, initialDelayInMs: 700, chunkDelayInMs: 40 }) };
    },
  });
}

const home = process.env.DUDE_HOME ?? fs.mkdtempSync(path.join(os.tmpdir(), "dude-demo-"));
if (!fs.existsSync(path.join(home, "config.yaml"))) {
  saveConfig(home, {
    ...DEFAULT_CONFIG,
    model: "demo:scripted",
    company: { name: "Acme Learning" },
    // a keyless "local" provider so the app treats the demo model as connected
    providers: { demo: { name: "Demo (scripted, no key)", baseURL: "http://127.0.0.1:9/v1" } },
  });
}

const server = await startServer({
  home,
  packDirs: [packsDir],
  webDir,
  port: Number(process.env.PORT ?? 4778),
  token: process.env.DUDE_UI_TOKEN ?? "demo",
  runtime: { resolveModel: () => demoModel(), browser: false },
  demo: true,
  log: console.log,
});
console.log(`Demo running: ${server.url}/?token=${server.token}`);
console.log(`Workspace: ${home}`);
