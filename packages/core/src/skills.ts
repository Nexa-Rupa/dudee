import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import type { SkillSpec } from "./types.js";

/**
 * Skills follow the open Agent Skills format used by Claude Code, Codex and others:
 *
 *   my-skill/
 *     SKILL.md        front matter (name, description, …) + the playbook
 *     references/     extra docs the playbook points to, read only when needed
 *     scripts/        helpers the playbook can run (needs the shell tool)
 *
 * Only name and description sit in the prompt. The body loads when the employee calls
 * use_skill or the user types /my-skill; bundled files load when the body asks for them.
 * A plain `name.md` file (no folder) also works.
 */

const MAX_FILES = 60;
const SKIP = new Set(["node_modules", ".git", "__pycache__", ".trash"]);

export function parseSkillFile(file: string, source: SkillSpec["source"] = "pack"): SkillSpec {
  const text = fs.readFileSync(file, "utf8");
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  let meta: Record<string, unknown> = {};
  if (match) {
    try {
      meta = (YAML.parse(match[1]) ?? {}) as Record<string, unknown>;
    } catch {
      meta = {};
    }
  }
  const isFolder = path.basename(file) === "SKILL.md";
  const dir = isFolder ? path.dirname(file) : null;
  return {
    name: String(meta.name ?? (isFolder ? path.basename(path.dirname(file)) : path.basename(file, ".md"))),
    description: String(meta.description ?? "").trim(),
    body: (match ? match[2] : text).trim(),
    dir,
    files: dir ? listFiles(dir) : [],
    source,
    argumentHint: meta["argument-hint"] ? String(meta["argument-hint"]) : undefined,
    userInvocable: meta["user-invocable"] === false ? false : true,
    license: meta.license ? String(meta.license) : undefined,
  };
}

function listFiles(dir: string, rel = "", out: string[] = []): string[] {
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    if (out.length >= MAX_FILES || SKIP.has(e.name)) continue;
    const p = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) listFiles(dir, p, out);
    else if (p !== "SKILL.md") out.push(p);
  }
  return out;
}

/** Find skills in a folder: `<name>/SKILL.md` folders and loose `*.md` files. */
export function discoverSkills(root: string, source: SkillSpec["source"]): SkillSpec[] {
  if (!fs.existsSync(root)) return [];
  const out: SkillSpec[] = [];
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    if (SKIP.has(e.name) || e.name.startsWith(".")) continue;
    const full = path.join(root, e.name);
    let isDir = e.isDirectory();
    if (e.isSymbolicLink()) {
      try {
        isDir = fs.statSync(full).isDirectory();
      } catch {
        continue; // broken link
      }
    }
    try {
      if (isDir && fs.existsSync(path.join(full, "SKILL.md"))) out.push(parseSkillFile(path.join(full, "SKILL.md"), source));
      else if (!isDir && e.name.endsWith(".md") && e.name !== "README.md") out.push(parseSkillFile(full, source));
    } catch {
      /* unreadable skill: skip it */
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export interface SkillSources {
  /** The workspace folder (.dude). Its skills/ folder is shared by every employee. */
  home: string;
  /** Extra folders from config. */
  dirs?: string[];
  /** Also load the user's global skills (~/.agents/skills, ~/.claude/skills). */
  global?: boolean;
}

/** Skills every employee shares, lowest priority first. */
export function sharedSkills(src: SkillSources): SkillSpec[] {
  const project = path.dirname(src.home);
  const roots: Array<[string, SkillSpec["source"]]> = [];
  if (src.global !== false) {
    roots.push([path.join(os.homedir(), ".claude", "skills"), "global"]);
    roots.push([path.join(os.homedir(), ".agents", "skills"), "global"]);
  }
  roots.push([path.join(project, ".claude", "skills"), "project"]);
  roots.push([path.join(project, ".agents", "skills"), "project"]);
  for (const d of src.dirs ?? []) roots.push([path.resolve(src.home, d), "workspace"]);
  roots.push([path.join(src.home, "skills"), "workspace"]);
  const byName = new Map<string, SkillSpec>();
  for (const [root, source] of roots) for (const s of discoverSkills(root, source)) byName.set(s.name, s);
  return [...byName.values()];
}

/** The text an employee gets when a skill is loaded. */
export function renderSkill(skill: SkillSpec, args?: string) {
  const parts = [`<skill name="${skill.name}"${skill.dir ? ` folder="${skill.dir}"` : ""}>`, skill.body, "</skill>"];
  if (skill.files?.length) {
    parts.push(
      `Files bundled with this skill (read with read_skill_file when the steps call for them):\n${skill.files.map((f) => `- ${f}`).join("\n")}`
    );
  }
  if (args) parts.push(`Arguments: ${args}`);
  return parts.join("\n\n");
}

/** Read a file bundled with a skill, staying inside its folder. */
export function readSkillFile(skill: SkillSpec, rel: string) {
  if (!skill.dir) throw new Error(`${skill.name} has no bundled files`);
  const full = path.resolve(skill.dir, rel);
  if (!full.startsWith(path.resolve(skill.dir) + path.sep)) throw new Error("Path is outside the skill folder");
  return fs.readFileSync(full, "utf8").slice(0, 60_000);
}

/** Write a skill into the workspace, in the Agent Skills format. */
export function saveSkill(home: string, skill: { name: string; description: string; steps: string; author: string }) {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(skill.name) || skill.name.length > 64) throw new Error("Skill names are short and kebab-case, like weekly-report");
  const dir = path.join(home, "skills", skill.name);
  const file = path.join(dir, "SKILL.md");
  const updated = fs.existsSync(file);
  fs.mkdirSync(dir, { recursive: true });
  const meta = YAML.stringify({ name: skill.name, description: skill.description.replace(/\s+/g, " ").trim(), author: skill.author });
  fs.writeFileSync(file, `---\n${meta}---\n${skill.steps.trim()}\n`);
  return { file, updated };
}

/** Copy a skill folder (or every skill in a folder) into the workspace. Returns installed names. */
export function installSkills(fromDir: string, home: string): string[] {
  const target = path.join(home, "skills");
  fs.mkdirSync(target, { recursive: true });
  const single = fs.existsSync(path.join(fromDir, "SKILL.md"));
  const found = single ? [parseSkillFile(path.join(fromDir, "SKILL.md"), "workspace")] : findDeep(fromDir);
  for (const s of found) {
    const dest = path.join(target, s.name.replace(/[^a-zA-Z0-9._-]/g, "-"));
    fs.rmSync(dest, { recursive: true, force: true });
    fs.cpSync(s.dir!, dest, { recursive: true, filter: (p) => !SKIP.has(path.basename(p)) });
  }
  return found.map((s) => s.name);
}

function findDeep(root: string, depth = 0, out: SkillSpec[] = []): SkillSpec[] {
  if (depth > 4 || !fs.existsSync(root)) return out;
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    if (!e.isDirectory() || SKIP.has(e.name)) continue;
    if (e.name.startsWith(".") && e.name !== ".claude" && e.name !== ".agents") continue;
    const full = path.join(root, e.name);
    if (fs.existsSync(path.join(full, "SKILL.md"))) out.push(parseSkillFile(path.join(full, "SKILL.md"), "workspace"));
    else findDeep(full, depth + 1, out);
  }
  return out;
}
