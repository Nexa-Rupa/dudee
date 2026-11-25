import fs from "node:fs";
import path from "node:path";

/** How much memory an employee carries in every prompt. */
export const MEMORY_LIMIT = 12_000;

const FULL =
  "Memory is full. Merge notes with memory_update or remove outdated ones with memory_forget, then save again. Keep standing rules.";

export type MemorySave = { saved: true } | { saved: false; reason: string };
export type MemoryUpdate = { replaced: number; reason?: string };

/**
 * Long-term memory is a plain MEMORY.md per employee: readable, editable, diffable.
 * Nothing is dropped silently: when it is full, saving is refused until the employee merges or removes notes.
 */
export class Memory {
  constructor(private dir: string) {}

  private get file() {
    return path.join(this.dir, "MEMORY.md");
  }

  /** The whole file. */
  text(): string {
    return fs.existsSync(this.file) ? fs.readFileSync(this.file, "utf8").trim() : "";
  }

  /**
   * What goes in the prompt. A file that outgrew the limit (edited by hand, or from an older version)
   * shows its oldest and newest notes, and says that some are missing.
   */
  read(): string {
    const text = this.text();
    if (text.length <= MEMORY_LIMIT) return text;
    const lines = text.split(/\r?\n/);
    const head = fit(lines, MEMORY_LIMIT / 2 - 100);
    const tail = fit(lines.slice(head.length).reverse(), MEMORY_LIMIT / 2 - 100).reverse();
    const hidden = lines.length - head.length - tail.length;
    const note = `(${hidden} more lines not shown: memory is too long. Find them with memory_search, then merge or remove notes.)`;
    return [...head, note, ...tail].join("\n");
  }

  entries(): string[] {
    return this.text()
      .split(/\r?\n/)
      .filter((l) => l.startsWith("- "))
      .map((l) => l.slice(2));
  }

  /** Notes containing every word of the query. */
  search(query: string): string[] {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return this.entries().filter((e) => words.every((w) => e.toLowerCase().includes(w)));
  }

  save(entry: string, opts: { force?: boolean } = {}): MemorySave {
    const clean = oneLine(entry);
    if (!clean) return { saved: false, reason: "Nothing to save" };
    if (this.entries().includes(clean)) return { saved: true };
    const text = this.text() || "# Memory\n";
    if (!opts.force && text.length + clean.length + 3 > MEMORY_LIMIT) return { saved: false, reason: FULL };
    this.write(`${text}\n- ${clean}`);
    return { saved: true };
  }

  /** Replace the notes containing `match` with one note, to correct or merge them. */
  update(match: string, entry: string): MemoryUpdate {
    const clean = oneLine(entry);
    const needle = match.trim().toLowerCase();
    if (!clean || !needle) return { replaced: 0, reason: "Give the text to find and the new note" };
    const before = this.text();
    const lines = before.split(/\r?\n/);
    const hit = (l: string) => l.startsWith("- ") && l.toLowerCase().includes(needle);
    const first = lines.findIndex(hit);
    if (first < 0) return { replaced: 0, reason: `No note contains "${match}"` };
    const after = lines.flatMap((l, i) => (i === first ? [`- ${clean}`] : hit(l) ? [] : [l])).join("\n");
    if (after.length > MEMORY_LIMIT && after.length > before.length) return { replaced: 0, reason: FULL };
    this.write(after);
    return { replaced: lines.filter(hit).length };
  }

  /** Replace the whole file, as edited by a person who saw `base`. False when it changed meanwhile. */
  replace(text: string, base: string): boolean {
    if (this.text() !== base.trim()) return false;
    if (text.length > MEMORY_LIMIT) throw new Error(`Memory holds at most ${MEMORY_LIMIT.toLocaleString("en-US")} characters; this has ${text.length.toLocaleString("en-US")}.`);
    this.write(text.trim());
    return true;
  }

  /** Remove entries containing the given text. Returns how many were removed. */
  forget(match: string): number {
    const needle = match.trim().toLowerCase();
    if (!needle || !fs.existsSync(this.file)) return 0;
    const lines = this.text().split(/\r?\n/);
    const kept = lines.filter((l) => !(l.startsWith("- ") && l.toLowerCase().includes(needle)));
    this.write(kept.join("\n"));
    return lines.length - kept.length;
  }

  private write(text: string) {
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(this.file, `${text.trimEnd()}\n`);
  }
}

function oneLine(s: string) {
  return s.replace(/\s+/g, " ").trim();
}

/** As many whole lines from the start as fit in `max` characters. */
function fit(lines: string[], max: number) {
  const out: string[] = [];
  let size = 0;
  for (const l of lines) {
    if (size + l.length + 1 > max) break;
    out.push(l);
    size += l.length + 1;
  }
  return out;
}
