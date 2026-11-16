import fs from "node:fs";
import path from "node:path";

const MAX_CHARS = 12_000;

/** Long-term memory is a plain MEMORY.md per employee: readable, editable, diffable. */
export class Memory {
  constructor(private dir: string) {}

  private get file() {
    return path.join(this.dir, "MEMORY.md");
  }

  read(): string {
    if (!fs.existsSync(this.file)) return "";
    const text = fs.readFileSync(this.file, "utf8").trim();
    return text.length > MAX_CHARS ? text.slice(text.length - MAX_CHARS) : text;
  }

  entries(): string[] {
    return this.read()
      .split(/\r?\n/)
      .filter((l) => l.startsWith("- "))
      .map((l) => l.slice(2));
  }

  save(entry: string) {
    const clean = entry.replace(/\s+/g, " ").trim();
    if (!clean || this.entries().includes(clean)) return;
    fs.mkdirSync(this.dir, { recursive: true });
    const prefix = fs.existsSync(this.file) ? "" : "# Memory\n\n";
    fs.appendFileSync(this.file, `${prefix}- ${clean}\n`);
  }

  /** Remove entries containing the given text. Returns how many were removed. */
  forget(match: string): number {
    if (!fs.existsSync(this.file)) return 0;
    const lines = fs.readFileSync(this.file, "utf8").split(/\r?\n/);
    const needle = match.toLowerCase();
    const kept = lines.filter((l) => !(l.startsWith("- ") && l.toLowerCase().includes(needle)));
    fs.writeFileSync(this.file, kept.join("\n"));
    return lines.length - kept.length;
  }
}
