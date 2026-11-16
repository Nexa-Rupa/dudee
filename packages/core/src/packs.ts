import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { discoverSkills } from "./skills.js";
import type { EmployeePack, Policy, RoutineSpec } from "./types.js";

/**
 * Pack layout:
 *   <pack>/employee.yaml           id, title, description, defaultName, tools, approvals, routines, requires
 *   <pack>/instructions.md         the role's standing instructions
 *   <pack>/skills/<name>/SKILL.md  Agent Skills (with optional references/ and scripts/)
 */
export function loadPack(dir: string): EmployeePack {
  const spec = YAML.parse(fs.readFileSync(path.join(dir, "employee.yaml"), "utf8")) ?? {};
  if (!spec.id || !spec.title) throw new Error(`Pack at ${dir} needs an id and a title`);
  const instructionsFile = path.join(dir, "instructions.md");
  return {
    id: String(spec.id),
    title: String(spec.title),
    description: String(spec.description ?? "").trim(),
    defaultName: String(spec.defaultName ?? spec.title),
    model: spec.model ? String(spec.model) : undefined,
    tools: Array.isArray(spec.tools) ? spec.tools.map(String) : [],
    approvals: (spec.approvals ?? {}) as Record<string, Policy>,
    routines: (spec.routines ?? []) as RoutineSpec[],
    requires: spec.requires ?? {},
    instructions: fs.existsSync(instructionsFile) ? fs.readFileSync(instructionsFile, "utf8").trim() : "",
    skills: discoverSkills(path.join(dir, "skills"), "pack"),
    dir,
  };
}

/** Load every pack under the given folders. Later folders override earlier ones by id. */
export function loadPacks(dirs: string[]): Map<string, EmployeePack> {
  const packs = new Map<string, EmployeePack>();
  for (const root of dirs) {
    if (!fs.existsSync(root)) continue;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      const dir = path.join(root, entry.name);
      if (entry.isDirectory() && fs.existsSync(path.join(dir, "employee.yaml"))) {
        const pack = loadPack(dir);
        packs.set(pack.id, pack);
      }
    }
  }
  return packs;
}
