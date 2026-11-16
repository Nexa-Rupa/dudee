import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { ToolContext, ToolDef } from "../types.js";

/**
 * Images and video through fal.ai with the user's FAL_KEY. Uses fal's queue API, so long
 * video jobs don't time out, and saves every image or video it returns into the employee's
 * files under media/.
 */
const QUEUE = "https://queue.fal.run";

function key() {
  const k = process.env.FAL_KEY;
  if (!k) throw new Error("Add FAL_KEY (Settings → Models → Media, or .env) to generate images and video.");
  return k;
}

async function falJson(url: string, init: RequestInit = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { authorization: `Key ${key()}`, "content-type": "application/json", ...(init.headers ?? {}) },
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`fal ${res.status}: ${data.detail ? JSON.stringify(data.detail) : JSON.stringify(data).slice(0, 300)}`);
  return data;
}

export async function falRun(model: string, input: Record<string, unknown>, signal?: AbortSignal, maxWaitMs = 15 * 60_000) {
  const job = await falJson(`${QUEUE}/${model.replace(/^\/+/, "")}`, { method: "POST", body: JSON.stringify(input) });
  const started = Date.now();
  let delay = 1000;
  while (true) {
    if (signal?.aborted) throw new Error("Stopped");
    const status = await falJson(job.status_url);
    if (status.status === "COMPLETED") break;
    if (status.status === "FAILED" || status.error) throw new Error(`fal job failed: ${status.error ?? "unknown error"}`);
    if (Date.now() - started > maxWaitMs) throw new Error(`fal job still running after ${Math.round(maxWaitMs / 60000)} min (request ${job.request_id})`);
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 1.5, 5000);
  }
  return falJson(job.response_url);
}

/** Find media URLs anywhere in a fal result. */
function mediaUrls(value: unknown, out: string[] = []): string[] {
  if (!value || typeof value !== "object") return out;
  if (Array.isArray(value)) value.forEach((v) => mediaUrls(v, out));
  else
    for (const [k, v] of Object.entries(value)) {
      if (k === "url" && typeof v === "string" && /^https?:\/\//.test(v)) out.push(v);
      else mediaUrls(v, out);
    }
  return [...new Set(out)];
}

const EXT: Record<string, string> = {
  "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif",
  "video/mp4": ".mp4", "video/webm": ".webm", "audio/mpeg": ".mp3", "audio/wav": ".wav",
};

async function saveMedia(urls: string[], ctx: ToolContext, slug: string) {
  const dir = path.join(ctx.runtime.filesDir(ctx.hire), "media");
  fs.mkdirSync(dir, { recursive: true });
  const saved: string[] = [];
  for (const [i, url] of urls.slice(0, 6).entries()) {
    const res = await fetch(url);
    if (!res.ok) continue;
    const type = (res.headers.get("content-type") ?? "").split(";")[0];
    const ext = EXT[type] ?? (path.extname(new URL(url).pathname) || ".bin");
    const name = `${new Date().toISOString().slice(0, 10)}-${slug}${urls.length > 1 ? `-${i + 1}` : ""}${ext}`;
    fs.writeFileSync(path.join(dir, name), Buffer.from(await res.arrayBuffer()));
    saved.push(`media/${name}`);
  }
  return saved;
}

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "media";
}

export const mediaTools: ToolDef[] = [
  {
    name: "generate_image",
    description:
      "Generate images with fal.ai and save them to your files (media/). Default model fal-ai/flux/dev; others include fal-ai/flux-pro/v1.1, fal-ai/recraft-v3, fal-ai/ideogram/v3. Write a detailed visual prompt.",
    input: z.object({
      prompt: z.string(),
      model: z.string().default("fal-ai/flux/dev"),
      image_size: z
        .enum(["square_hd", "square", "portrait_4_3", "portrait_16_9", "landscape_4_3", "landscape_16_9"])
        .default("landscape_4_3"),
      num_images: z.number().int().min(1).max(4).default(1),
    }),
    risk: "write",
    summarize: (i: any) => `generate ${i.num_images ?? 1} image(s) with ${i.model ?? "fal-ai/flux/dev"}: "${String(i.prompt).slice(0, 120)}"`,
    async execute(i: any, ctx) {
      const result = await falRun(i.model ?? "fal-ai/flux/dev", {
        prompt: i.prompt, image_size: i.image_size ?? "landscape_4_3", num_images: i.num_images ?? 1,
      }, ctx.signal);
      return { saved: await saveMedia(mediaUrls(result), ctx, slugify(i.prompt)) };
    },
  },
  {
    name: "fal_run",
    description:
      "Run any fal.ai model (video, image editing, upscaling, audio) by id with its input object, e.g. model 'fal-ai/kling-video/v2.1/standard/text-to-video' with { prompt, duration }. Check the model's page on fal.ai for its inputs. Outputs are saved to your files (media/).",
    input: z.object({ model: z.string(), input: z.record(z.string(), z.unknown()), label: z.string().optional() }),
    risk: "write",
    summarize: (i: any) => `run fal model ${i.model}${i.input?.prompt ? `: "${String(i.input.prompt).slice(0, 120)}"` : ""}`,
    async execute(i: any, ctx) {
      const result = await falRun(i.model, i.input, ctx.signal);
      const urls = mediaUrls(result);
      const saved = await saveMedia(urls, ctx, slugify(i.label ?? String(i.input?.prompt ?? i.model)));
      return { saved, result: JSON.stringify(result).slice(0, 3000) };
    },
  },
];
