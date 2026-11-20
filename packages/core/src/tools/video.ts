import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { z } from "zod";
import type { ToolContext, ToolDef } from "../types.js";
import {
  HYPERFRAMES_VERSION,
  REMOTION_INDEX,
  REMOTION_PACKAGE,
  REMOTION_ROOT,
  REMOTION_SCENES,
  hyperframesStarter,
} from "./video-templates.js";

/**
 * Videos the employee makes itself, from code, on this computer:
 *  - Remotion: the employee writes a video spec (JSON scenes: titles, bullets, images, clips, quotes,
 *    stats, a call to action, captions, music and voiceover). A shared studio renders it. Best for daily posts.
 *  - HyperFrames: the employee writes an HTML + GSAP composition for custom motion design, then renders it.
 * Rendered videos land in files/media/ like generated images, ready to attach to a post.
 */
const NPX = process.platform === "win32" ? "npx.cmd" : "npx";
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";

interface RunResult {
  code: number;
  out: string;
}

function run(cmd: string, args: string[], cwd: string, timeoutMs: number, signal?: AbortSignal): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, windowsHide: true, shell: process.platform === "win32", env: { ...process.env, CI: "1" } });
    let out = "";
    const add = (b: Buffer) => {
      out = (out + b.toString()).slice(-20_000);
    };
    child.stdout.on("data", add);
    child.stderr.on("data", add);
    const timer = setTimeout(() => child.kill(), timeoutMs);
    const abort = () => child.kill();
    signal?.addEventListener("abort", abort);
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: 127, out: `${out}\n${err.message}` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      resolve({ code: code ?? 1, out });
    });
  });
}

function quoteArg(a: string) {
  // spawn with shell:true on Windows joins args; quote the ones with spaces
  return process.platform === "win32" && /[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a;
}

function inFiles(ctx: ToolContext, rel: string) {
  const root = ctx.runtime.filesDir(ctx.hire);
  const full = path.resolve(root, rel);
  if (full !== root && !full.startsWith(root + path.sep)) throw new Error("Path is outside your files folder");
  return { root, full };
}

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "video";
}

function outputPath(ctx: ToolContext, name: string) {
  const dir = path.join(ctx.runtime.filesDir(ctx.hire), "media");
  fs.mkdirSync(dir, { recursive: true });
  const base = `${new Date().toISOString().slice(0, 10)}-${slugify(name)}`;
  let file = `${base}.mp4`;
  for (let i = 2; fs.existsSync(path.join(dir, file)); i++) file = `${base}-${i}.mp4`;
  return { full: path.join(dir, file), rel: `media/${file}` };
}

/** The shared Remotion studio, written and installed once per workspace. */
export async function ensureRemotionStudio(home: string, signal?: AbortSignal) {
  const dir = path.join(home, "studio", "remotion");
  const files: Record<string, string> = {
    "package.json": REMOTION_PACKAGE,
    "src/index.ts": REMOTION_INDEX,
    "src/Root.tsx": REMOTION_ROOT,
    "src/Scenes.tsx": REMOTION_SCENES,
  };
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    if (!fs.existsSync(full) || fs.readFileSync(full, "utf8") !== body) fs.writeFileSync(full, body);
  }
  if (!fs.existsSync(path.join(dir, "node_modules", "@remotion", "cli"))) {
    const r = await run(NPM, ["install", "--no-audit", "--no-fund", "--loglevel=error"], dir, 10 * 60_000, signal);
    if (r.code !== 0) throw new Error(`Installing Remotion failed:\n${r.out.slice(-2000)}`);
  }
  return dir;
}

async function hasFfmpeg() {
  const r = await run("ffmpeg", ["-version"], process.cwd(), 15_000);
  return r.code === 0;
}

function validateSpec(spec: any) {
  if (!spec || !Array.isArray(spec.scenes) || !spec.scenes.length) throw new Error("A video spec needs a non-empty scenes array");
  const types = ["title", "text", "bullets", "image", "video", "quote", "stat", "cta"];
  spec.scenes.forEach((s: any, i: number) => {
    if (!types.includes(s.type)) throw new Error(`Scene ${i + 1}: type must be one of ${types.join(", ")}`);
    if (!(Number(s.duration) > 0)) throw new Error(`Scene ${i + 1}: duration must be seconds > 0`);
  });
  const total = spec.scenes.reduce((a: number, s: any) => a + Number(s.duration), 0);
  if (total > 600) throw new Error("Videos longer than 10 minutes are not supported here");
  return total;
}

/** Local media files a spec points at must exist in the files folder (Remotion serves that folder). */
function checkAssets(spec: any, root: string) {
  const refs: string[] = [];
  for (const k of ["music", "voiceover"]) if (spec[k]) refs.push(spec[k]);
  for (const s of spec.scenes) for (const k of ["image", "video"]) if (s[k]) refs.push(s[k]);
  const missing = refs.filter((r) => !/^(https?:|data:)/.test(r) && !fs.existsSync(path.resolve(root, r)));
  if (missing.length) throw new Error(`These files are not in your files folder: ${missing.join(", ")}`);
}

/** `assets/<name>` in a HyperFrames project that is missing there but exists in media/ is copied in. */
function copyReferencedMedia(project: string, root: string) {
  const html = fs
    .readdirSync(project, { recursive: true, withFileTypes: false } as any)
    .map(String)
    .filter((f) => f.endsWith(".html"))
    .map((f) => fs.readFileSync(path.join(project, f), "utf8"))
    .join("\n");
  for (const m of html.matchAll(/assets\/([\w.\-]+\.(?:png|jpe?g|webp|gif|mp4|webm|mov|mp3|wav|m4a))/gi)) {
    const dest = path.join(project, "assets", m[1]);
    const from = path.join(root, "media", m[1]);
    if (!fs.existsSync(dest) && fs.existsSync(from)) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(from, dest);
    }
  }
}

export const videoTools: ToolDef[] = [
  {
    name: "video_render",
    description:
      "Render a video you made yourself to MP4 (saved under media/). engine 'remotion': source is a JSON video spec file you wrote (see your video skills: scenes of title/text/bullets/image/video/quote/stat/cta, theme, captions, music, voiceover). engine 'hyperframes': source is a HyperFrames project folder with index.html (start one with video_new_hyperframes). The first Remotion render installs Remotion (a few minutes).",
    input: z.object({
      engine: z.enum(["remotion", "hyperframes"]),
      source: z.string().describe("Spec .json (remotion) or project folder (hyperframes), relative to your files folder"),
      name: z.string().optional().describe("Short name for the output file"),
    }),
    risk: "write",
    defaultPolicy: "auto", // renders on this computer into the employee's own folder
    summarize: (i: any) => `render ${i.source} with ${i.engine}`,
    async execute(i: any, ctx) {
      const { root, full } = inFiles(ctx, i.source);
      if (!fs.existsSync(full)) return { error: `No ${i.source} in your files folder` };
      const out = outputPath(ctx, i.name ?? path.basename(i.source, path.extname(i.source)));
      const started = Date.now();
      if (i.engine === "remotion") {
        let spec: any;
        try {
          spec = JSON.parse(fs.readFileSync(full, "utf8"));
        } catch (err) {
          return { error: `The spec is not valid JSON: ${(err as Error).message}` };
        }
        const seconds = validateSpec(spec);
        checkAssets(spec, root);
        const studio = await ensureRemotionStudio(ctx.runtime.home, ctx.signal);
        const r = await run(
          NPX,
          ["remotion", "render", "src/index.ts", "Scenes", out.full, `--props=${full}`, `--public-dir=${root}`, "--log=error"].map(quoteArg),
          studio,
          20 * 60_000,
          ctx.signal
        );
        if (r.code !== 0 || !fs.existsSync(out.full)) return { error: `Remotion render failed:\n${r.out.slice(-3000)}` };
        return { saved: out.rel, seconds, renderSeconds: Math.round((Date.now() - started) / 1000) };
      }
      // HyperFrames
      if (!fs.statSync(full).isDirectory() || !fs.existsSync(path.join(full, "index.html"))) {
        return { error: "A HyperFrames source is a folder holding index.html" };
      }
      copyReferencedMedia(full, root);
      if (!(await hasFfmpeg())) return { error: "HyperFrames needs FFmpeg. Ask the user to install it (winget install ffmpeg, brew install ffmpeg or apt install ffmpeg), or use engine remotion." };
      const pkg = `hyperframes@${HYPERFRAMES_VERSION}`;
      const check = await run(NPX, ["--yes", pkg, "check", "--json"], full, 5 * 60_000, ctx.signal);
      if (check.code !== 0 && /"errors"\s*:\s*\[\s*\{/.test(check.out)) {
        return { error: "The composition has errors. Fix them and render again.", check: check.out.slice(-4000) };
      }
      const r = await run(NPX, ["--yes", pkg, "render", "-o", quoteArg(out.full)], full, 30 * 60_000, ctx.signal);
      if (r.code !== 0 || !fs.existsSync(out.full)) return { error: `HyperFrames render failed:\n${r.out.slice(-3000)}` };
      return { saved: out.rel, renderSeconds: Math.round((Date.now() - started) / 1000) };
    },
  },
  {
    name: "video_new_hyperframes",
    description:
      "Start a HyperFrames video project (HTML + GSAP, rendered to MP4) in videos/<name>/ with a starter index.html at the size you need. Then edit index.html with files_write following your hyperframes-video skill, and render with video_render.",
    input: z.object({
      name: z.string(),
      format: z.enum(["vertical", "square", "landscape"]).default("vertical"),
      seconds: z.number().min(1).max(300).default(15),
      title: z.string().default("Title"),
    }),
    risk: "read",
    async execute(i: any, ctx) {
      const size = { vertical: [1080, 1920], square: [1080, 1080], landscape: [1920, 1080] }[i.format as "vertical"] ?? [1080, 1920];
      const rel = `videos/${slugify(i.name)}`;
      const { full } = inFiles(ctx, rel);
      fs.mkdirSync(path.join(full, "assets"), { recursive: true });
      const index = path.join(full, "index.html");
      if (fs.existsSync(index)) return { error: `${rel}/index.html already exists; edit it instead` };
      fs.writeFileSync(index, hyperframesStarter({ width: size[0], height: size[1], duration: i.seconds, title: i.title }));
      return { project: rel, file: `${rel}/index.html`, width: size[0], height: size[1], seconds: i.seconds };
    },
  },
  {
    name: "generate_voiceover",
    description:
      "Turn a script into a spoken voiceover MP3 saved under media/, for a video's voiceover field. Uses ElevenLabs (ELEVENLABS_API_KEY) or OpenAI text-to-speech (OPENAI_API_KEY).",
    input: z.object({
      text: z.string().max(4000),
      voice: z.string().optional().describe("OpenAI voice (alloy, ash, coral, nova, onyx, sage, shimmer) or an ElevenLabs voice id"),
      provider: z.enum(["auto", "elevenlabs", "openai"]).default("auto"),
      name: z.string().optional(),
    }),
    risk: "write",
    summarize: (i: any) => `voiceover (${String(i.text).split(/\s+/).length} words): "${String(i.text).slice(0, 100)}"`,
    async execute(i: any, ctx) {
      const provider = i.provider === "auto" ? (process.env.ELEVENLABS_API_KEY ? "elevenlabs" : process.env.OPENAI_API_KEY ? "openai" : null) : i.provider;
      if (!provider) return { error: "Add ELEVENLABS_API_KEY or OPENAI_API_KEY in Settings to make voiceovers." };
      let res: Response;
      if (provider === "elevenlabs") {
        if (!process.env.ELEVENLABS_API_KEY) return { error: "ELEVENLABS_API_KEY is not set" };
        res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(i.voice || "21m00Tcm4TlvDq8ikWAM")}`, {
          method: "POST",
          headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY, "content-type": "application/json", accept: "audio/mpeg" },
          body: JSON.stringify({ text: i.text, model_id: "eleven_multilingual_v2" }),
          signal: ctx.signal ?? AbortSignal.timeout(120_000),
        });
      } else {
        if (!process.env.OPENAI_API_KEY) return { error: "OPENAI_API_KEY is not set" };
        res = await fetch(`${(process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "")}/audio/speech`, {
          method: "POST",
          headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "content-type": "application/json" },
          body: JSON.stringify({ model: "gpt-4o-mini-tts", voice: i.voice || "alloy", input: i.text, response_format: "mp3" }),
          signal: ctx.signal ?? AbortSignal.timeout(120_000),
        });
      }
      if (!res.ok) return { error: `${provider} said ${res.status}: ${(await res.text()).slice(0, 300)}` };
      const dir = path.join(ctx.runtime.filesDir(ctx.hire), "media");
      fs.mkdirSync(dir, { recursive: true });
      const file = `${new Date().toISOString().slice(0, 10)}-${slugify(i.name ?? i.text.slice(0, 30))}-vo.mp3`;
      fs.writeFileSync(path.join(dir, file), Buffer.from(await res.arrayBuffer()));
      const words = String(i.text).split(/\s+/).filter(Boolean).length;
      return { saved: `media/${file}`, estimatedSeconds: Math.round((words / 150) * 60) };
    },
  },
];
