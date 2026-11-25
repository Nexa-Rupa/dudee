import fs from "node:fs";
import path from "node:path";
import type { LanguageModelUsage, ModelMessage, UserContent } from "ai";
import { getProvider, parseModelId, type ProviderInfo } from "./providers.js";

/** Pieces of the model loop that don't need the runtime: what each step sends, what it cost, what files look like to a model. */

export function providerKind(modelId: string): ProviderInfo["kind"] | null {
  try {
    return getProvider(parseModelId(modelId).provider)?.kind ?? null;
  } catch {
    return null;
  }
}

// ── what each step sends ───────────────────────────────────────────────────
const CACHE = { anthropic: { cacheControl: { type: "ephemeral" as const } } };
/** Browser results that describe a whole page; only the latest few still matter. */
const PAGE_RESULT_MIN = 1500;
const PAGES_KEPT = 3;
/** Old pages go in batches: every removal changes the prompt and so costs a cache write. */
const PAGES_BEFORE_PRUNING = 8;

/**
 * Rewrites the messages before each model call of one task: adds what the user said meanwhile, drops old browser
 * pages, and marks what Claude may cache (other providers cache on their own).
 */
export class StepMessages {
  private steers: Array<{ at: number; message: ModelMessage }> = [];
  private dropped = new Set<string>();

  prepare(messages: ModelMessage[], added: string[]): ModelMessage[] {
    for (const text of added) {
      this.steers.push({ at: messages.length, message: { role: "user", content: `[The user added this while you were working] ${text}` } });
    }
    return cacheMarks(this.prune(this.withSteers(messages)));
  }

  /** The conversation so far with what the user added, as a fresh start (for continuing with another model). */
  fold(messages: ModelMessage[]): ModelMessage[] {
    const out = this.withSteers(messages);
    this.steers = [];
    return out;
  }

  private withSteers(messages: ModelMessage[]) {
    if (!this.steers.length) return messages;
    const out: ModelMessage[] = [];
    for (let i = 0; i <= messages.length; i++) {
      for (const s of this.steers) if (s.at === i) out.push(s.message);
      if (i < messages.length) out.push(messages[i]);
    }
    return out;
  }

  private prune(messages: ModelMessage[]): ModelMessage[] {
    const pages: string[] = [];
    for (const m of messages) {
      if (m.role !== "tool") continue;
      for (const p of m.content) {
        if (p.type === "tool-result" && p.toolName.startsWith("browser_") && !this.dropped.has(p.toolCallId) && sizeOf(p.output) >= PAGE_RESULT_MIN) {
          pages.push(p.toolCallId);
        }
      }
    }
    if (pages.length > PAGES_BEFORE_PRUNING) for (const id of pages.slice(0, -PAGES_KEPT)) this.dropped.add(id);
    if (!this.dropped.size) return messages;
    return messages.map((m) =>
      m.role !== "tool"
        ? m
        : {
            ...m,
            content: m.content.map((p) =>
              p.type === "tool-result" && this.dropped.has(p.toolCallId)
                ? { ...p, output: { type: "text" as const, value: "(An earlier view of the page, removed to save space. Take a browser_snapshot to see it now.)" } }
                : p
            ),
          }
    );
  }
}

function sizeOf(output: unknown) {
  return JSON.stringify(output ?? "").length;
}

/** Let Claude cache the system prompt with its tools, and everything up to the last message. */
function cacheMarks(messages: ModelMessage[]): ModelMessage[] {
  const last = messages.length - 1;
  return messages.map((m, i) => (i === last || (m.role === "system" && i === 0) ? ({ ...m, providerOptions: { ...m.providerOptions, ...CACHE } } as ModelMessage) : m));
}

/** Another provider can't read the first one's private reasoning or metadata. */
export function portable(messages: ModelMessage[]): ModelMessage[] {
  return messages.flatMap((m): ModelMessage[] => {
    const { providerOptions: _drop, ...rest } = m as any;
    if (!Array.isArray(rest.content)) return [rest];
    const content = rest.content
      .filter((p: any) => p.type !== "reasoning")
      .map(({ providerOptions: _p, ...part }: any) => part);
    return content.length ? [{ ...rest, content }] : [];
  });
}

// ── what it cost ───────────────────────────────────────────────────────────
export interface StepUsage {
  /** Every input token, cached or not. */
  input: number;
  /** Input tokens at their cache rate, for pricing: Claude charges 10% for cache reads and 125% for writes. */
  billed: number;
  output: number;
}

/** Claude reports cached tokens beside its input tokens; others include them (and are priced in full, to be safe). */
export function stepUsage(modelId: string, usage: LanguageModelUsage, metadata: unknown): StepUsage {
  const input = usage.inputTokens ?? 0;
  const output = usage.outputTokens ?? 0;
  if (providerKind(modelId) !== "anthropic") return { input, billed: input, output };
  const read = usage.cachedInputTokens ?? 0;
  const written = Number((metadata as any)?.anthropic?.cacheCreationInputTokens ?? 0) || 0;
  return { input: input + read + written, billed: input + read * 0.1 + written * 1.25, output };
}

// ── files and images ───────────────────────────────────────────────────────
export const IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};
const MAX_IMAGE = 5 * 1024 * 1024;
const MAX_PDF = 20 * 1024 * 1024;

/** A user message with its attachments: pictures and PDFs go to the model when it can take them, the rest by file name. */
export function userContent(text: string, root: string, attachments: string[], modelId: string, media: boolean): { content: UserContent; hasMedia: boolean } {
  if (!attachments.length) return { content: text, hasMedia: false };
  const parts: Exclude<UserContent, string> = [
    { type: "text", text: `${text}\n\n[Attached, saved in your files folder: ${attachments.join(", ")}]` },
  ];
  if (media) {
    const pdfs = providerKind(modelId) !== "compatible";
    for (const rel of attachments) {
      const full = path.resolve(root, rel);
      if (!full.startsWith(root + path.sep) || !fs.existsSync(full)) continue;
      const ext = path.extname(full).toLowerCase();
      const size = fs.statSync(full).size;
      if (IMAGE_TYPES[ext] && size <= MAX_IMAGE) parts.push({ type: "image", image: fs.readFileSync(full), mediaType: IMAGE_TYPES[ext] });
      else if (ext === ".pdf" && pdfs && size <= MAX_PDF) parts.push({ type: "file", data: fs.readFileSync(full), mediaType: "application/pdf", filename: path.basename(full) });
    }
  }
  return { content: parts, hasMedia: parts.length > 1 };
}

const isImage = (c: any) => c?.type === "image" && typeof c.data === "string";

/** Tool output as the model gets it. Screenshots become pictures for models that take them in tool results, else a note. */
export function toolOutput(output: unknown, modelId: string): any {
  if (Array.isArray(output) && output.some(isImage)) {
    const kind = providerKind(modelId);
    const sees = kind === "anthropic" || kind === "openai";
    return {
      type: "content",
      value: output.map((c) =>
        isImage(c)
          ? sees
            ? { type: "media", data: c.data, mediaType: c.mimeType ?? "image/jpeg" }
            : { type: "text", text: "(a picture, shown to the user; use browser_snapshot to read the page)" }
          : { type: "text", text: c?.type === "text" ? String(c.text) : JSON.stringify(c) }
      ),
    };
  }
  if (typeof output === "string") return { type: "text", value: output };
  return { type: "json", value: JSON.parse(JSON.stringify(output ?? null)) };
}

/** The same output without picture data, for the transcript. */
export function withoutImages(output: unknown): unknown {
  return Array.isArray(output) && output.some(isImage) ? output.map((c) => (isImage(c) ? { type: "image", note: "picture" } : c)) : output;
}

// ── finding tools ──────────────────────────────────────────────────────────
/** Tools whose name or description match the words best. */
export function searchTools(tools: Array<{ name: string; description: string }>, query: string, limit = 8) {
  const words = query.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1);
  return tools
    .map((t) => {
      const name = t.name.toLowerCase();
      const about = t.description.toLowerCase();
      return { t, score: words.reduce((n, w) => n + (name.includes(w) ? 3 : 0) + (about.includes(w) ? 1 : 0), 0) };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.t);
}

/** A request the model itself refused as malformed, e.g. a picture sent to a text-only model. */
export function isBadRequest(err: unknown) {
  return [400, 404, 415, 422].includes(Number((err as any)?.statusCode));
}
