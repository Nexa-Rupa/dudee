// Copies what the bundled CLI needs at runtime into the package: employee packs, the built web app,
// the README and LICENSE. Run after tsup (see "build").
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.resolve(here, "..");
const repo = path.resolve(cli, "..", "..");

function copy(from, to) {
  if (!fs.existsSync(from)) throw new Error(`Missing ${from}. Build the workspace first (pnpm build).`);
  fs.rmSync(to, { recursive: true, force: true });
  fs.cpSync(from, to, { recursive: true });
}

copy(path.join(repo, "packages", "employees", "packs"), path.join(cli, "packs"));
copy(path.join(repo, "apps", "web", "dist"), path.join(cli, "web"));
fs.copyFileSync(path.join(repo, "LICENSE"), path.join(cli, "LICENSE"));
fs.copyFileSync(path.join(repo, "README.md"), path.join(cli, "README.md"));
console.log("copied packs, web, LICENSE, README into", cli);
