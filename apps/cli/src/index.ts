#!/usr/bin/env node
import "./quiet.js";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { Command } from "commander";
import os from "node:os";
import { spawnSync } from "node:child_process";
import {
  DEFAULT_CONFIG,
  MEDIA_PROVIDERS,
  Runtime,
  Scheduler,
  allProviders,
  errorText,
  getProvider,
  hireDir,
  installSkills,
  isConfigured,
  isInitialized,
  keySource,
  listModels,
  loadConfig,
  loadSecrets,
  parseModelId,
  resolveHome,
  saveConfig,
  setCustomProviders,
  setSecret,
  exportTeam,
  importTeam,
  type ApprovalDecision,
  type Hire,
  type RuntimeEvent,
} from "@dude/core";
import { packsDir } from "@dude/employees";
import { startServer } from "@dude/server";
import { webDir as devWebDir } from "@dude/web";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

// The published package carries the built web app in ./web next to ./dist; in the repo it comes from apps/web.
const bundledWeb = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "web");
const webDir = fs.existsSync(path.join(bundledWeb, "index.html")) ? bundledWeb : devWebDir;
const VERSION = "2.0.0";

try {
  process.loadEnvFile(".env");
} catch {
  /* no .env: keys may already be in the environment */
}

const tty = process.stdout.isTTY;
const paint = (code: number) => (s: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const dim = paint(2);
const bold = paint(1);
const green = paint(32);
const yellow = paint(33);
const red = paint(31);
const cyan = paint(36);

const home = resolveHome();

function ensureInit() {
  if (!isInitialized(home)) {
    console.error(`No workspace here. Run ${bold("dudee init")} first.`);
    process.exit(1);
  }
}

function makeRuntime(rl?: readline.Interface, opts: { unattended?: boolean } = {}) {
  return new Runtime(home, {
    packDirs: [packsDir],
    approve: opts.unattended || !rl ? undefined : (req) => askApproval(rl, req.hire, req.summary),
    ask: opts.unattended || !rl ? undefined : async (hire, q) => {
      out.lineBreak();
      const a = await rl.question(`${cyan(hire.name + " asks")}: ${q}\n${bold("you › ")}`);
      return a.trim() || null;
    },
  });
}

async function askApproval(rl: readline.Interface, hire: Hire, summary: string): Promise<ApprovalDecision> {
  out.lineBreak();
  console.log(yellow(`⚠  ${hire.name} wants to: ${summary}`));
  const a = (await rl.question(`   ${bold("[y]")} allow once  ${bold("[a]")} always allow  ${bold("[n]")} don't allow › `))
    .trim()
    .toLowerCase();
  if (a === "a" || a === "always") return "always";
  if (a === "y" || a === "yes") return "allow";
  return "deny";
}

/** Streams a turn to the terminal: reply text, plus one dim line per tool step. */
const out = {
  atLineStart: true,
  write(s: string) {
    if (!s) return;
    process.stdout.write(s);
    this.atLineStart = s.endsWith("\n");
  },
  lineBreak() {
    if (!this.atLineStart) this.write("\n");
  },
  attach(runtime: Runtime, hireId?: string) {
    return runtime.on((e: RuntimeEvent) => {
      if ("hireId" in e && hireId && e.hireId !== hireId) return;
      if (e.type === "delta") this.write(e.text);
      if (e.type === "status" && e.status === "tool") {
        this.lineBreak();
        this.write(dim(`  · ${e.detail}…\n`));
      }
      if (e.type === "row" && e.row.row.kind === "notice") {
        this.lineBreak();
        this.write(red(`  ! ${e.row.row.text}\n`));
      }
    });
  },
};

const program = new Command()
  .name("dudee")
  .description("Open-source AI employees that do real work, with your own keys.")
  .version(VERSION);

program
  .command("init")
  .description("Create a workspace (.dude/) in this folder")
  .option("--company <name>", "company name")
  .option("--website <url>", "company website")
  .option("--model <provider:model>", "default model")
  .option("-y, --yes", "skip questions and use the given options")
  .action(async (o) => {
    const config = isInitialized(home) ? loadConfig(home) : structuredClone(DEFAULT_CONFIG);
    loadSecrets(home);
    setCustomProviders(config.providers);
    if (!o.yes && process.stdin.isTTY) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      o.company = (await rl.question(`Company name ${dim(`(${o.company ?? config.company.name ?? "skip"})`)}: `)) || o.company;
      o.website = (await rl.question(`Website ${dim(`(${o.website ?? config.company.website ?? "skip"})`)}: `)) || o.website;
      o.about = await rl.question(`What does the company do, in one sentence? ${dim("(skip)")}: `);
      if (!o.model) o.model = await pickModel(rl, config.model);
      rl.close();
    }
    config.model = o.model ?? config.model;
    parseModelId(config.model);
    if (o.company) config.company.name = o.company;
    if (o.website) config.company.website = o.website;
    if (o.about) config.company.about = o.about;
    saveConfig(home, config);
    console.log(green(`✓ Workspace ready at ${home} · model ${config.model}`));
    const p = getProvider(parseModelId(config.model).provider)!;
    if (!isConfigured(p)) console.log(yellow(`  ${p.name} needs a key: dudee keys set ${p.id}`));
    console.log(`  Next: ${bold("dudee ui")} (web app) or ${bold("dudee hire content-creator")}`);
  });

/** Ask which provider to use, take its key (saved to .dude/secrets.env), and pick a model. */
async function pickModel(rl: readline.Interface, current: string): Promise<string> {
  const list = allProviders();
  console.log(`\n${bold("Which model provider do you want to use?")} ${dim("(you can add more later)")}`);
  list.forEach((p, i) => {
    const ready = p.local ? dim(" local") : isConfigured(p) && p.keyEnv ? green(" ✓ key found") : "";
    console.log(`  ${String(i + 1).padStart(2)}. ${p.name}${ready}`);
  });
  const answer = (await rl.question(`Number ${dim(`(Enter keeps ${current})`)}: `)).trim();
  if (!answer) return current;
  const p = list[Number(answer) - 1];
  if (!p) return current;
  if (p.note) console.log(dim(`  ${p.note}`));
  if (p.keyEnv && !process.env[p.keyEnv]) {
    if (p.keyUrl) console.log(dim(`  Get a key: ${p.keyUrl}`));
    const key = (await rl.question(`  ${p.keyEnv}${p.local ? dim(" (optional)") : ""}: `)).trim();
    if (key) setSecret(home, p.keyEnv, key);
  }
  let models = p.models;
  try {
    const live = await listModels(p.id);
    if (live.length) {
      console.log(green(`  ✓ Connected. ${live.length} models available.`));
      models = [...new Set([...p.models.filter((m) => live.includes(m)), ...live])];
    }
  } catch (err) {
    console.log(yellow(`  Couldn't list models: ${errorText(err)}`));
  }
  if (models.length) console.log(dim(`  e.g. ${models.slice(0, 8).join(", ")}`));
  const model = (await rl.question(`  Model ${dim(models[0] ? `(${models[0]})` : "")}: `)).trim() || models[0];
  return model ? `${p.id}:${model}` : current;
}

program
  .command("keys")
  .description("Show which providers have keys")
  .action(() => {
    loadSecrets(home);
    setCustomProviders(loadConfig(home).providers);
    for (const p of allProviders()) {
      const src = p.keyEnv ? keySource(home, p.keyEnv) : null;
      const status = p.local ? dim("local") : src === "saved" ? green("saved") : src === "env" ? green(".env") : dim("—");
      console.log(`${p.id.padEnd(12)} ${status.padEnd(14)} ${p.name}${p.keyEnv ? dim(`  ${p.keyEnv}`) : ""}`);
    }
    for (const m of MEDIA_PROVIDERS) {
      const src = keySource(home, m.keyEnv);
      console.log(`${m.id.padEnd(12)} ${(src ? green(src === "saved" ? "saved" : ".env") : dim("—")).padEnd(14)} ${m.name}${dim(`  ${m.keyEnv}`)}`);
    }
    console.log(dim(`\nSet one: dudee keys set <provider> [key]   Remove: dudee keys remove <provider>`));
  })
  .addCommand(
    new Command("set")
      .argument("<provider>", "provider id (e.g. groq) or an env name (e.g. FAL_KEY)")
      .argument("[value]", "the key; asked for if left out")
      .description("Save a key in .dude/secrets.env")
      .action(async (id: string, value?: string) => {
        const name = keyName(id);
        if (!value) {
          const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
          value = (await rl.question(`${name}: `)).trim();
          rl.close();
        }
        if (!value) return;
        setSecret(home, name, value);
        console.log(green(`✓ Saved ${name}`));
        const p = getProvider(id);
        if (p) {
          try {
            console.log(green(`✓ ${p.name} works: ${(await listModels(p.id)).length} models`));
          } catch (err) {
            console.log(yellow(`  Saved, but the check failed: ${errorText(err)}`));
          }
        }
      })
  )
  .addCommand(
    new Command("remove")
      .argument("<provider>")
      .description("Remove a saved key")
      .action((id: string) => {
        setSecret(home, keyName(id), null);
        console.log(`Removed ${keyName(id)}`);
      })
  );

function keyName(id: string) {
  setCustomProviders(loadConfig(home).providers);
  if (/^[A-Z0-9_]+$/.test(id)) return id;
  const p = getProvider(id);
  const m = MEDIA_PROVIDERS.find((x) => x.id === id);
  const name = p?.keyEnv ?? m?.keyEnv;
  if (!name) throw new Error(`Unknown provider ${id}. See: dudee keys`);
  return name;
}

program
  .command("models <provider>")
  .description("List the models a provider offers with your key")
  .action(async (id: string) => {
    loadSecrets(home);
    setCustomProviders(loadConfig(home).providers);
    try {
      for (const m of await listModels(id)) console.log(`${id}:${m}`);
    } catch (err) {
      console.error(red(errorText(err)));
      process.exitCode = 1;
    }
  });

program
  .command("skills [name]")
  .description("List the skills an employee (or everyone) can use")
  .action((name?: string) => {
    const runtime = makeRuntime();
    const hire = name ? runtime.findHire(name) : null;
    if (name && !hire) {
      console.error(red(`No employee named ${name}. See: dudee team`));
      process.exitCode = 1;
      runtime.store.close();
      return;
    }
    const packs = hire ? [runtime.packFor(hire)!] : [...runtime.packs.values()];
    const seen = new Set<string>();
    for (const pack of packs) {
      const all = runtime.skillsFor(pack).sort((a, b) => Number(b.source === "pack") - Number(a.source === "pack"));
      for (const s of all) {
        if (seen.has(s.name)) continue;
        seen.add(s.name);
        const where = s.source === "pack" ? pack.title : s.source;
        console.log(`${bold("/" + s.name)} ${dim(`[${where}]`)}\n   ${dim(s.description.slice(0, 160))}`);
      }
    }
    runtime.store.close();
  })
  .addCommand(
    new Command("add")
      .argument("<source>", "a folder with SKILL.md files, or a git URL")
      .description("Install skills into this workspace (.dude/skills)")
      .action(async (source: string) => {
        ensureInit();
        let dir = source;
        let temp: string | null = null;
        if (/^(https?:\/\/|git@)/.test(source)) {
          temp = fs.mkdtempSync(path.join(os.tmpdir(), "dude-skill-"));
          console.log(dim(`Cloning ${source}…`));
          const r = spawnSync("git", ["clone", "--depth", "1", source, temp], { stdio: "inherit" });
          if (r.status !== 0) {
            console.error(red("git clone failed"));
            process.exitCode = 1;
            return;
          }
          dir = temp;
        }
        const names = installSkills(path.resolve(dir), home);
        if (temp) fs.rmSync(temp, { recursive: true, force: true });
        console.log(names.length ? green(`✓ Installed: ${names.join(", ")}`) : yellow("No SKILL.md found there."));
      })
  );

program
  .command("packs")
  .description("List the employees you can hire")
  .action(() => {
    const runtime = makeRuntime();
    for (const p of runtime.packs.values()) {
      console.log(`${bold(p.id.padEnd(20))} ${p.title}`);
      console.log(dim(`${"".padEnd(21)}${p.description}`));
      if (p.skills.length) console.log(dim(`${"".padEnd(21)}skills: ${p.skills.map((s) => s.name).join(", ")}`));
    }
    runtime.store.close();
  });

program
  .command("hire <pack>")
  .description("Hire an employee from a pack")
  .option("-n, --name <name>", "their name")
  .option("-m, --model <provider:model>", "model for this employee (defaults to the workspace model)")
  .action((packId, o) => {
    ensureInit();
    const runtime = makeRuntime();
    try {
      if (o.model) parseModelId(o.model);
      const hire = runtime.hire(packId, { name: o.name, model: o.model });
      const pack = runtime.packFor(hire)!;
      console.log(green(`✓ Hired ${hire.name}, ${pack.title}.`));
      const missing = (pack.requires.env ?? []).filter((k) => !process.env[k]);
      if (missing.length) console.log(yellow(`  ${hire.name} needs ${missing.join(", ")} in .env for some tools.`));
      const routines = runtime.store.routines(hire.id);
      if (routines.length) {
        console.log(dim(`  Routines (off until you enable them): ${routines.map((r) => r.id).join(", ")}`));
      }
      console.log(`  Talk to them: ${bold(`dudee chat ${hire.name}`)}`);
    } catch (err) {
      console.error(red(errorText(err)));
      process.exitCode = 1;
    } finally {
      runtime.store.close();
    }
  });

program
  .command("team")
  .description("List your employees")
  .action(() => {
    ensureInit();
    const runtime = makeRuntime();
    const hires = runtime.listHires();
    if (!hires.length) console.log(`No one hired yet. Try ${bold("dudee hire content-creator")}.`);
    for (const h of hires) {
      const pack = runtime.packFor(h);
      console.log(`${bold(h.name.padEnd(12))} ${(pack?.title ?? h.packId).padEnd(22)} ${dim(runtime.modelFor(h, pack!))}`);
    }
    runtime.store.close();
  });

program
  .command("fire <name>")
  .description("Remove an employee, with their memory and files")
  .action(async (name) => {
    ensureInit();
    const runtime = makeRuntime();
    try {
      await runtime.fire(name);
      console.log(`${name} has left the team.`);
    } catch (err) {
      console.error(red(errorText(err)));
      process.exitCode = 1;
    } finally {
      runtime.store.close();
    }
  });

for (const [cmd, paused] of [
  ["pause", true],
  ["resume", false],
] as const) {
  program
    .command(`${cmd} <name>`)
    .description(paused ? "Stop an employee taking work or running routines" : "Let a paused employee work again")
    .action((name: string) => {
      ensureInit();
      const runtime = makeRuntime();
      try {
        runtime.setPaused(name, paused);
        console.log(green(`✓ ${name} ${paused ? "is paused" : "is back at work"}`));
      } catch (err) {
        console.error(red(errorText(err)));
        process.exitCode = 1;
      } finally {
        runtime.store.close();
      }
    });
}

program
  .command("budget [name] [usd]")
  .description("Show spend this month, or set a monthly budget in US dollars (\"none\" removes it). Without a name: the whole team.")
  .action((name?: string, amount?: string) => {
    ensureInit();
    const runtime = makeRuntime();
    try {
      const value = amount === undefined ? undefined : amount === "none" ? null : Number(amount);
      if (value !== undefined && value !== null && (!Number.isFinite(value) || value < 0)) throw new Error("Give a dollar amount, or none");
      if (!name || name === "team") {
        if (value !== undefined) {
          runtime.config.budgetUsd = value;
          saveConfig(home, runtime.config);
        }
        const s = runtime.spendThisMonth();
        console.log(`Team: $${s.usd.toFixed(2)} this month${runtime.config.budgetUsd !== null ? ` of $${runtime.config.budgetUsd}` : ""}`);
        for (const h of runtime.listHires()) {
          const hs = runtime.spendThisMonth(h.id);
          const tag = h.paused ? yellow(" paused") : "";
          console.log(`  ${h.name.padEnd(12)} $${hs.usd.toFixed(2)}${h.budgetUsd !== null ? ` of $${h.budgetUsd}` : ""}${tag}`);
        }
        if (s.unpricedTurns) console.log(dim(`  ${s.unpricedTurns} task(s) used models with no price; add prices in Settings.`));
      } else {
        if (value !== undefined) runtime.setBudget(name, value);
        const h = runtime.findHire(name)!;
        console.log(`${h.name}: $${runtime.spendThisMonth(h.id).usd.toFixed(2)} this month${h.budgetUsd !== null ? ` of $${h.budgetUsd}` : ""}`);
      }
    } catch (err) {
      console.error(red(errorText(err)));
      process.exitCode = 1;
    } finally {
      runtime.store.close();
    }
  });

program
  .command("export [file]")
  .description("Save your team (roles, models, budgets, routines, goals, skills; never keys) to a file")
  .option("--with-memory", "include what employees remember")
  .action((file: string | undefined, o) => {
    ensureInit();
    const runtime = makeRuntime();
    const out = file ?? `dudee-team-${new Date().toISOString().slice(0, 10)}.json`;
    fs.writeFileSync(out, JSON.stringify(exportTeam(runtime, { withMemory: !!o.withMemory }), null, 2));
    console.log(green(`✓ Saved team to ${out}`));
    runtime.store.close();
  });

program
  .command("import <file>")
  .description("Add a team from a team file to this workspace")
  .action((file: string) => {
    ensureInit();
    const runtime = makeRuntime();
    try {
      const r = importTeam(runtime, JSON.parse(fs.readFileSync(file, "utf8")));
      saveConfig(home, runtime.config);
      console.log(green(`✓ Hired ${r.hired.map((h) => h.name).join(", ") || "nobody"}`));
      if (r.skills.length) console.log(`  Skills added: ${r.skills.join(", ")}`);
      for (const s of r.skipped) console.log(yellow(`  Skipped ${s.name}: ${s.reason}`));
    } catch (err) {
      console.error(red(errorText(err)));
      process.exitCode = 1;
    } finally {
      runtime.store.close();
    }
  });

program
  .command("chat <name>")
  .description("Chat with an employee. Type /exit to leave.")
  .action(async (name) => {
    ensureInit();
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const runtime = makeRuntime(rl);
    const hire = runtime.findHire(name);
    if (!hire) {
      console.error(red(`No employee named ${name}. See ${bold("dudee team")}.`));
      rl.close();
      await runtime.close();
      return;
    }
    const pack = runtime.packFor(hire)!;
    console.log(dim(`${hire.name} · ${pack.title} · ${runtime.modelFor(hire, pack)} · /exit to leave`));
    out.attach(runtime, hire.id);
    while (true) {
      let line: string;
      try {
        line = (await rl.question(`\n${bold("you › ")}`)).trim();
      } catch {
        break; // stdin closed
      }
      if (!line) continue;
      if (line === "/exit" || line === "/quit") break;
      out.write(`\n${cyan(hire.name)} › `);
      try {
        await runtime.send(hire.id, line);
      } catch (err) {
        out.lineBreak();
        console.error(red(errorText(err)));
      }
      out.lineBreak();
    }
    rl.close();
    await runtime.close();
  });

program
  .command("ask <name> <message...>")
  .description("Give an employee one task and print the result")
  .action(async (name, words: string[]) => {
    ensureInit();
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const runtime = makeRuntime(rl);
    out.attach(runtime);
    try {
      await runtime.send(name, words.join(" "));
      out.lineBreak();
    } catch (err) {
      out.lineBreak();
      console.error(red(errorText(err)));
      process.exitCode = 1;
    }
    rl.close();
    await runtime.close();
  });

program
  .command("ui")
  .description("Open the web app: your team, live work, approvals, files. Also runs routines.")
  .option("-p, --port <port>", "port", process.env.DUDE_PORT ?? "4777")
  .option("--host <host>", "address to listen on (0.0.0.0 to reach it from other machines)", process.env.DUDE_HOST ?? "127.0.0.1")
  .option("--no-open", "don't open the browser")
  .action(async (o) => {
    ensureInit();
    const allowed = process.env.DUDE_ALLOWED_HOSTS?.split(",").map((s) => s.trim()).filter(Boolean);
    const server = await startServer({
      home,
      packDirs: [packsDir],
      webDir,
      port: Number(o.port),
      host: o.host,
      allowedHosts: allowed,
      token: process.env.DUDE_UI_TOKEN || uiToken(),
      log: (l) => console.log(`${dim(new Date().toLocaleTimeString())} ${l}`),
    });
    const link = `${server.url}/?token=${server.token}`;
    if (o.host !== "127.0.0.1" && o.host !== "localhost") {
      console.log(yellow(`Listening on ${o.host}. Anyone who can reach this port and has the link's token can use your team; keep the token private.`));
    }
    console.log(green(`dudee is running at ${server.url}`));
    console.log(`Open: ${bold(link)}`);
    console.log(dim("Routines run while this is open. Ctrl+C to stop."));
    if (o.open) openBrowser(link);
    const stop = async () => {
      await server.close();
      process.exit(0);
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  });

/** One sign-in token per workspace, kept in .dude/ui-token, so the link survives restarts. */
function uiToken() {
  const file = path.join(home, "ui-token");
  try {
    const saved = fs.readFileSync(file, "utf8").trim();
    if (saved.length >= 16) return saved;
  } catch {
    /* first run */
  }
  const fresh = randomBytes(18).toString("base64url");
  fs.writeFileSync(file, fresh + "\n", { mode: 0o600 });
  return fresh;
}

function openBrowser(url: string) {
  const [cmd, args] =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", "", url.replace(/&/g, "^&")]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  try {
    spawn(cmd, args as string[], { stdio: "ignore", detached: true }).unref();
  } catch {
    /* the link is printed anyway */
  }
}

program
  .command("start")
  .description("Run routines without the web app. Actions that need approval are declined and noted for you.")
  .action(async () => {
    ensureInit();
    const runtime = makeRuntime(undefined, { unattended: true });
    const scheduler = new Scheduler(runtime, (l) => console.log(`${dim(new Date().toLocaleTimeString())} ${l}`));
    scheduler.start();
    const active = runtime.store.routines().filter((r) => r.enabled);
    console.log(green(`dudee is running: ${active.length} routine(s) scheduled. Ctrl+C to stop.`));
    if (!active.length) console.log(dim(`Enable one with: dudee routines <name> --enable <id>`));
    const stop = async () => {
      scheduler.stop();
      await runtime.close();
      process.exit(0);
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  });

program
  .command("routines [name]")
  .description("List routines, or enable/disable one")
  .option("--enable <id>")
  .option("--disable <id>")
  .action((name, o) => {
    ensureInit();
    const runtime = makeRuntime();
    const hire = name ? runtime.findHire(name) : null;
    if (name && !hire) console.error(red(`No employee named ${name}`));
    else if ((o.enable || o.disable) && hire) {
      const ok = runtime.store.setRoutineEnabled(hire.id, o.enable ?? o.disable, !!o.enable);
      console.log(ok ? green(`✓ ${o.enable ? "Enabled" : "Disabled"} ${o.enable ?? o.disable}`) : red("No such routine"));
    } else {
      for (const r of runtime.store.routines(hire?.id)) {
        const who = runtime.findHire(r.hireId)?.name ?? r.hireId;
        console.log(`${r.enabled ? green("on ") : dim("off")} ${bold(who)} ${r.id} ${dim(r.cron)}\n    ${dim(r.prompt.trim())}`);
      }
    }
    runtime.store.close();
  });

program
  .command("memory <name>")
  .description("Show what an employee remembers (edit the file to change it)")
  .action((name) => {
    ensureInit();
    const runtime = makeRuntime();
    const hire = runtime.findHire(name);
    if (!hire) console.error(red(`No employee named ${name}`));
    else {
      console.log(dim(path.join(hireDir(home, hire.id), "MEMORY.md")));
      console.log(runtime.memoryFor(hire).read() || "(nothing yet)");
    }
    runtime.store.close();
  });

program
  .command("log <name>")
  .description("Show an employee's recent activity")
  .option("-n, --lines <n>", "rows to show", "30")
  .action((name, o) => {
    ensureInit();
    const runtime = makeRuntime();
    const hire = runtime.findHire(name);
    if (!hire) console.error(red(`No employee named ${name}`));
    else
      for (const { at, row } of runtime.store.rows(hire.id, Number(o.lines))) {
        const t = dim(at.slice(0, 16).replace("T", " "));
        if (row.kind === "message") console.log(`${t} ${bold(row.role === "user" ? row.from ?? "you" : hire.name)}: ${row.text}`);
        if (row.kind === "tool") console.log(`${t} ${dim(`· ${row.tool} ${row.error ? red(row.error) : `(${row.ms}ms)`}`)}`);
        if (row.kind === "approval") console.log(`${t} ${yellow(`approval ${row.decision}: ${row.summary}`)}`);
        if (row.kind === "notice") console.log(`${t} ${red(row.text)}`);
      }
    runtime.store.close();
  });

program
  .command("usage")
  .description("Token usage per employee and model")
  .action(() => {
    ensureInit();
    const runtime = makeRuntime();
    const rows = runtime.store.usageSummary();
    if (!rows.length) console.log("No usage yet.");
    for (const u of rows) {
      const who = runtime.findHire(u.hireId)?.name ?? u.hireId;
      console.log(`${bold(who.padEnd(12))} ${u.model.padEnd(36)} in ${u.inputTokens}  out ${u.outputTokens}  turns ${u.turns}`);
    }
    runtime.store.close();
  });

if (!fs.existsSync(home) && process.argv.length <= 2) {
  console.log(`Welcome to dude. Start with ${bold("dudee init")}.\n`);
}

program.parseAsync().catch((err) => {
  console.error(red(errorText(err)));
  process.exit(1);
});
