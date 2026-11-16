import fs from "node:fs";
import path from "node:path";
import type { Runtime } from "./runtime.js";
import type { Policy } from "./types.js";

/**
 * A shareable team: company profile, goals, workspace instructions and skills, and each employee
 * with their role, model, budget, routines and "always allow" rules. Never contains keys.
 * Memory is left out unless asked for, since it can hold private company facts.
 */
export interface TeamFile {
  format: "dudee-team";
  version: 1;
  exportedAt: string;
  company: { name?: string; website?: string; about?: string };
  goals: string[];
  agentsMd?: string;
  skills: Array<{ name: string; files: Record<string, string> }>;
  employees: Array<{
    name: string;
    packId: string;
    model: string | null;
    budgetUsd: number | null;
    routines: Array<{ id: string; cron: string; prompt: string; enabled: boolean; source: "pack" | "user" }>;
    allowed: string[];
    memory?: string;
  }>;
}

const MAX_FILE = 200_000;

export function exportTeam(runtime: Runtime, opts: { withMemory?: boolean } = {}): TeamFile {
  const agents = path.join(runtime.home, "AGENTS.md");
  const skillsRoot = path.join(runtime.home, "skills");
  const skills: TeamFile["skills"] = [];
  if (fs.existsSync(skillsRoot)) {
    for (const dir of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      const files: Record<string, string> = {};
      collectText(path.join(skillsRoot, dir.name), "", files);
      if (files["SKILL.md"]) skills.push({ name: dir.name, files });
    }
  }
  return {
    format: "dudee-team",
    version: 1,
    exportedAt: new Date().toISOString(),
    company: { ...runtime.config.company },
    goals: [...runtime.config.goals],
    agentsMd: fs.existsSync(agents) ? fs.readFileSync(agents, "utf8") : undefined,
    skills,
    employees: runtime.listHires().map((h) => ({
      name: h.name,
      packId: h.packId,
      model: h.model,
      budgetUsd: h.budgetUsd,
      routines: runtime.store.routines(h.id).map((r) => ({ id: r.id, cron: r.cron, prompt: r.prompt, enabled: r.enabled, source: r.source })),
      allowed: runtime.store.policies(h.id).filter((p) => p.policy === "auto").map((p) => p.tool),
      memory: opts.withMemory ? runtime.memoryFor(h).read() || undefined : undefined,
    })),
  };
}

function collectText(root: string, rel: string, out: Record<string, string>) {
  for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const p = rel ? `${rel}/${e.name}` : e.name;
    const full = path.join(root, p);
    if (e.isDirectory()) collectText(root, p, out);
    else if (fs.statSync(full).size <= MAX_FILE) {
      const buf = fs.readFileSync(full);
      if (!buf.includes(0)) out[p] = buf.toString("utf8"); // text files only
    }
  }
}

export interface ImportResult {
  hired: Array<{ name: string; packId: string }>;
  skipped: Array<{ name: string; reason: string }>;
  skills: string[];
}

/** Add a team to this workspace. Existing employees stay; name clashes get a number. */
export function importTeam(runtime: Runtime, data: unknown): ImportResult {
  const team = data as TeamFile;
  if (!team || team.format !== "dudee-team" || team.version !== 1) throw new Error("This isn't a dudee team file.");
  const result: ImportResult = { hired: [], skipped: [], skills: [] };

  const cfg = runtime.config;
  cfg.company = { ...team.company, ...stripEmpty(cfg.company) };
  cfg.goals = [...new Set([...cfg.goals, ...(team.goals ?? [])])];

  const agents = path.join(runtime.home, "AGENTS.md");
  if (team.agentsMd && !fs.existsSync(agents)) fs.writeFileSync(agents, team.agentsMd);

  for (const skill of team.skills ?? []) {
    const safe = skill.name.replace(/[^a-zA-Z0-9._-]/g, "-");
    const dir = path.join(runtime.home, "skills", safe);
    for (const [rel, text] of Object.entries(skill.files)) {
      const full = path.resolve(dir, rel);
      if (!full.startsWith(dir + path.sep)) continue; // never write outside the skill folder
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, text);
    }
    result.skills.push(safe);
  }
  runtime.reloadSkills();

  for (const e of team.employees ?? []) {
    if (!runtime.packs.has(e.packId)) {
      result.skipped.push({ name: e.name, reason: `role "${e.packId}" isn't installed` });
      continue;
    }
    let name = e.name;
    for (let i = 2; runtime.findHire(name); i++) name = `${e.name} ${i}`;
    const hire = runtime.hire(e.packId, { name, model: e.model ?? undefined, budgetUsd: e.budgetUsd ?? null });
    for (const r of e.routines ?? []) {
      runtime.store.upsertRoutine({ ...r, hireId: hire.id, lastRunAt: null });
    }
    for (const tool of e.allowed ?? []) runtime.store.setPolicy(hire.id, tool, "auto" as Policy);
    if (e.memory) {
      for (const line of e.memory.split(/\r?\n/)) if (line.startsWith("- ")) runtime.memoryFor(hire).save(line.slice(2));
    }
    result.hired.push({ name, packId: e.packId });
  }
  runtime.emit({ type: "routines-changed" });
  runtime.emit({ type: "team-changed" });
  return result;
}

function stripEmpty<T extends Record<string, unknown>>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== "")) as Partial<T>;
}
