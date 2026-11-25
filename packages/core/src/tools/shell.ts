import { exec } from "node:child_process";
import fs from "node:fs";
import { z } from "zod";
import { childEnv } from "../env.js";
import type { ToolDef } from "../types.js";

const MAX_OUT = 20_000;

/**
 * Run a command, like Claude Code's Bash tool, so skills can use their bundled scripts.
 * Runs in the employee's files folder. Off unless a pack or the workspace turns on `shell`,
 * and every command asks first unless the user chose "always allow". Commands get a clean environment without
 * your keys (see env.ts), but they run as you: this is not a sandbox.
 */
export const shellTools: ToolDef[] = [
  {
    name: "run_command",
    description:
      "Run a shell command in your files folder (for skill scripts, data processing, converting files). Prefer your other tools when they fit. Commands time out after the given seconds.",
    input: z.object({
      command: z.string(),
      timeoutSec: z.number().int().min(1).max(600).default(120),
    }),
    risk: "write",
    summarize: (i: any) => `run: ${i.command}`,
    async execute(i: any, ctx) {
      const cwd = ctx.runtime.filesDir(ctx.hire);
      fs.mkdirSync(cwd, { recursive: true });
      return new Promise((resolve) => {
        exec(
          i.command,
          { cwd, env: childEnv(), signal: ctx.signal, timeout: (i.timeoutSec ?? 120) * 1000, maxBuffer: 10 * 1024 * 1024, windowsHide: true },
          (err, stdout, stderr) => {
            resolve({
              exitCode: err ? ((err as any).code ?? 1) : 0,
              stdout: String(stdout).slice(-MAX_OUT),
              stderr: String(stderr).slice(-MAX_OUT),
              ...(err && (err as any).killed ? { note: "Timed out and was stopped" } : {}),
            });
          }
        );
      });
    },
  },
];
