// Manual smoke test: renders a real video with the shared Remotion studio. Not part of `pnpm test` (downloads Remotion).
// Run: npx tsx --conditions=dude-source test/render.smoke.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { packsDir } from "@dude/employees";
import { DEFAULT_CONFIG, Runtime, TOOL_GROUPS } from "../src/index.js";

const home = process.env.SMOKE_HOME ?? fs.mkdtempSync(path.join(os.tmpdir(), "dude-render-"));
const runtime = new Runtime(home, { packDirs: [packsDir], config: { ...structuredClone(DEFAULT_CONFIG), globalSkills: false }, browser: false });
const hire = runtime.findHire("Maya") ?? runtime.hire("social-media-manager");
const files = runtime.filesDir(hire);
fs.mkdirSync(path.join(files, "videos"), { recursive: true });
fs.writeFileSync(
  path.join(files, "videos", "smoke.json"),
  JSON.stringify({
    width: 540, height: 960, fps: 30, transition: "slide", watermark: "@dudee",
    theme: { background: "#0f172a", accent: "#22d3ee" },
    scenes: [
      { type: "title", duration: 1.5, heading: "Daily tip", text: "made by dudee" },
      { type: "bullets", duration: 2, heading: "Do this", bullets: ["Reply fast", "Offer two times"] },
      { type: "stat", duration: 1.5, value: "78%", label: "buy from the first reply" },
      { type: "cta", duration: 1, heading: "Want more?", text: "Follow" },
    ],
    captions: [{ text: "Daily tip", start: 0, end: 1.5 }],
  })
);
const render = TOOL_GROUPS.video.find((t) => t.name === "video_render")!;
const t0 = Date.now();
const out: any = await render.execute({ engine: "remotion", source: "videos/smoke.json", name: "smoke" }, { hire, pack: runtime.packFor(hire)!, runtime, chain: [] });
console.log(JSON.stringify(out, null, 2), `\n${Math.round((Date.now() - t0) / 1000)}s total, home ${home}`);
if (out.saved) console.log("size", fs.statSync(path.join(files, out.saved)).size, "bytes");
runtime.store.close();
