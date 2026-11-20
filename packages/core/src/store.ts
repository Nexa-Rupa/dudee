import { createRequire } from "node:module";
import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

// Loaded on first use, not at import time, so a CLI can silence node:sqlite's
// "experimental" warning before it fires.
const require = createRequire(import.meta.url);
import type { Hire, Policy, Row, RoutineSpec, StoredRow, UsageRecord } from "./types.js";
import type { SocialAccount, SocialPost } from "./social.js";

export interface StoredRoutine extends RoutineSpec {
  hireId: string;
  enabled: boolean;
  source: "pack" | "user" | "autopost";
  lastRunAt: string | null;
}

/**
 * Local persistence on node:sqlite (no native build step).
 * The cloud edition swaps this for a Postgres-backed implementation of the same methods.
 */
export class Store {
  private db: DatabaseSync;

  constructor(file: string) {
    const sqlite = require("node:sqlite") as typeof import("node:sqlite");
    this.db = new sqlite.DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS hires (
        id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE,
        pack_id TEXT NOT NULL, model TEXT, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS rows (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, hire_id TEXT NOT NULL,
        at TEXT NOT NULL, body TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS rows_hire ON rows(hire_id, seq);
      CREATE TABLE IF NOT EXISTS policies (
        hire_id TEXT NOT NULL, tool TEXT NOT NULL, policy TEXT NOT NULL,
        PRIMARY KEY (hire_id, tool));
      CREATE TABLE IF NOT EXISTS routines (
        id TEXT NOT NULL, hire_id TEXT NOT NULL, cron TEXT NOT NULL, prompt TEXT NOT NULL,
        enabled INTEGER NOT NULL, source TEXT NOT NULL, last_run_at TEXT,
        PRIMARY KEY (hire_id, id));
      CREATE TABLE IF NOT EXISTS usage (
        id TEXT PRIMARY KEY, hire_id TEXT NOT NULL, model TEXT NOT NULL,
        input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL, at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS social_accounts (id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS social_posts (
        id TEXT PRIMARY KEY, account_id TEXT NOT NULL, hire_id TEXT NOT NULL, at TEXT NOT NULL, body TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS social_posts_at ON social_posts(at);
    `);
    // Columns added after the first release; older workspaces get them in place.
    this.addColumn("hires", "paused", "INTEGER NOT NULL DEFAULT 0");
    this.addColumn("hires", "budget_usd", "REAL");
    this.addColumn("usage", "cost_usd", "REAL");
  }

  private addColumn(table: string, column: string, type: string) {
    const cols = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === column)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }

  close() {
    this.db.close();
  }

  // ── hires ────────────────────────────────────────────────────────────────
  addHire(h: Hire) {
    this.db
      .prepare("INSERT INTO hires (id, name, pack_id, model, created_at, paused, budget_usd) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(h.id, h.name, h.packId, h.model, h.createdAt, h.paused ? 1 : 0, h.budgetUsd);
  }

  setHirePaused(id: string, paused: boolean) {
    this.db.prepare("UPDATE hires SET paused = ? WHERE id = ?").run(paused ? 1 : 0, id);
  }

  setHireBudget(id: string, budgetUsd: number | null) {
    this.db.prepare("UPDATE hires SET budget_usd = ? WHERE id = ?").run(budgetUsd, id);
  }

  listHires(): Hire[] {
    return (this.db.prepare("SELECT * FROM hires ORDER BY created_at").all() as any[]).map(toHire);
  }

  findHire(ref: string): Hire | null {
    const r = this.db.prepare("SELECT * FROM hires WHERE id = ? OR name = ?").get(ref, ref) as any;
    return r ? toHire(r) : null;
  }

  setHireModel(id: string, model: string | null) {
    this.db.prepare("UPDATE hires SET model = ? WHERE id = ?").run(model, id);
  }

  removeHire(id: string) {
    this.db.prepare("DELETE FROM hires WHERE id = ?").run(id);
    for (const t of ["rows", "policies", "routines", "usage"]) {
      this.db.prepare(`DELETE FROM ${t} WHERE hire_id = ?`).run(id);
    }
  }

  // ── transcript rows ──────────────────────────────────────────────────────
  appendRow(hireId: string, row: Row): StoredRow {
    const at = new Date().toISOString();
    const res = this.db
      .prepare("INSERT INTO rows (hire_id, at, body) VALUES (?, ?, ?)")
      .run(hireId, at, JSON.stringify(row));
    return { seq: Number(res.lastInsertRowid), hireId, at, row };
  }

  rows(hireId: string, limit = 50): StoredRow[] {
    const list = this.db
      .prepare("SELECT * FROM rows WHERE hire_id = ? ORDER BY seq DESC LIMIT ?")
      .all(hireId, limit) as any[];
    return list.reverse().map((r) => ({ seq: r.seq, hireId: r.hire_id, at: r.at, row: JSON.parse(r.body) }));
  }

  // ── approval policies ("always allow") ──────────────────────────────────
  getPolicy(hireId: string, tool: string): Policy | null {
    const r = this.db.prepare("SELECT policy FROM policies WHERE hire_id = ? AND tool = ?").get(hireId, tool) as any;
    return r ? (r.policy as Policy) : null;
  }

  policies(hireId: string): Array<{ tool: string; policy: Policy }> {
    return this.db.prepare("SELECT tool, policy FROM policies WHERE hire_id = ? ORDER BY tool").all(hireId) as any[];
  }

  removePolicy(hireId: string, tool: string): boolean {
    const res = this.db.prepare("DELETE FROM policies WHERE hire_id = ? AND tool = ?").run(hireId, tool);
    return Number(res.changes) > 0;
  }

  setPolicy(hireId: string, tool: string, policy: Policy) {
    this.db
      .prepare(
        "INSERT INTO policies (hire_id, tool, policy) VALUES (?, ?, ?) ON CONFLICT(hire_id, tool) DO UPDATE SET policy = excluded.policy"
      )
      .run(hireId, tool, policy);
  }

  // ── routines ─────────────────────────────────────────────────────────────
  upsertRoutine(r: StoredRoutine) {
    this.db
      .prepare(
        `INSERT INTO routines (id, hire_id, cron, prompt, enabled, source, last_run_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(hire_id, id) DO UPDATE SET cron = excluded.cron, prompt = excluded.prompt, enabled = excluded.enabled`
      )
      .run(r.id, r.hireId, r.cron, r.prompt, r.enabled ? 1 : 0, r.source, r.lastRunAt);
  }

  routines(hireId?: string): StoredRoutine[] {
    const list = (
      hireId
        ? this.db.prepare("SELECT * FROM routines WHERE hire_id = ?").all(hireId)
        : this.db.prepare("SELECT * FROM routines").all()
    ) as any[];
    return list.map((r) => ({
      id: r.id,
      hireId: r.hire_id,
      cron: r.cron,
      prompt: r.prompt,
      enabled: !!r.enabled,
      source: r.source,
      lastRunAt: r.last_run_at,
    }));
  }

  setRoutineEnabled(hireId: string, id: string, enabled: boolean): boolean {
    const res = this.db
      .prepare("UPDATE routines SET enabled = ? WHERE hire_id = ? AND id = ?")
      .run(enabled ? 1 : 0, hireId, id);
    return Number(res.changes) > 0;
  }

  removeRoutine(hireId: string, id: string): boolean {
    const res = this.db.prepare("DELETE FROM routines WHERE hire_id = ? AND id = ?").run(hireId, id);
    return Number(res.changes) > 0;
  }

  markRoutineRun(hireId: string, id: string) {
    this.db
      .prepare("UPDATE routines SET last_run_at = ? WHERE hire_id = ? AND id = ?")
      .run(new Date().toISOString(), hireId, id);
  }

  // ── social accounts and posts ─────────────────────────────────────────
  socialAccounts(): SocialAccount[] {
    return (this.db.prepare("SELECT body FROM social_accounts ORDER BY id").all() as any[]).map((r) => JSON.parse(r.body));
  }

  socialAccount(id: string): SocialAccount | null {
    const r = this.db.prepare("SELECT body FROM social_accounts WHERE id = ?").get(id) as any;
    return r ? JSON.parse(r.body) : null;
  }

  saveSocialAccount(a: SocialAccount) {
    this.db
      .prepare("INSERT INTO social_accounts (id, body) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET body = excluded.body")
      .run(a.id, JSON.stringify(a));
  }

  removeSocialAccount(id: string): boolean {
    return Number(this.db.prepare("DELETE FROM social_accounts WHERE id = ?").run(id).changes) > 0;
  }

  addSocialPost(p: Pick<SocialPost, "accountId" | "hireId" | "text" | "media" | "status">): SocialPost {
    const post: SocialPost = { id: randomUUID().slice(0, 8), at: new Date().toISOString(), url: null, error: null, ...p };
    this.db
      .prepare("INSERT INTO social_posts (id, account_id, hire_id, at, body) VALUES (?, ?, ?, ?, ?)")
      .run(post.id, post.accountId, post.hireId, post.at, JSON.stringify(post));
    return post;
  }

  updateSocialPost(id: string, patch: Partial<Pick<SocialPost, "status" | "url" | "error">>): boolean {
    const r = this.db.prepare("SELECT body FROM social_posts WHERE id = ?").get(id) as any;
    if (!r) return false;
    const post = { ...JSON.parse(r.body), ...patch };
    this.db.prepare("UPDATE social_posts SET body = ? WHERE id = ?").run(JSON.stringify(post), id);
    return true;
  }

  socialPosts(opts: { accountId?: string; limit?: number } = {}): SocialPost[] {
    const limit = opts.limit ?? 100;
    const list = (
      opts.accountId
        ? this.db.prepare("SELECT body FROM social_posts WHERE account_id = ? ORDER BY at DESC LIMIT ?").all(opts.accountId, limit)
        : this.db.prepare("SELECT body FROM social_posts ORDER BY at DESC LIMIT ?").all(limit)
    ) as any[];
    return list.map((r) => JSON.parse(r.body));
  }

  // ── usage ────────────────────────────────────────────────────────────────
  recordUsage(u: UsageRecord) {
    this.db
      .prepare("INSERT INTO usage (id, hire_id, model, input_tokens, output_tokens, at, cost_usd) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(randomUUID(), u.hireId, u.model, u.inputTokens, u.outputTokens, new Date().toISOString(), u.costUsd ?? null);
  }

  /** Spend since a moment, for one employee or the whole team. Turns on unpriced models count as unpriced. */
  spendSince(since: string, hireId?: string): { usd: number; turns: number; unpricedTurns: number; tokens: number } {
    const r = (
      hireId
        ? this.db
            .prepare(
              "SELECT COALESCE(SUM(cost_usd),0) usd, COUNT(*) n, SUM(CASE WHEN cost_usd IS NULL THEN 1 ELSE 0 END) unpriced, COALESCE(SUM(input_tokens+output_tokens),0) tok FROM usage WHERE at >= ? AND hire_id = ?"
            )
            .get(since, hireId)
        : this.db
            .prepare(
              "SELECT COALESCE(SUM(cost_usd),0) usd, COUNT(*) n, SUM(CASE WHEN cost_usd IS NULL THEN 1 ELSE 0 END) unpriced, COALESCE(SUM(input_tokens+output_tokens),0) tok FROM usage WHERE at >= ?"
            )
            .get(since)
    ) as any;
    return { usd: Number(r.usd) || 0, turns: Number(r.n) || 0, unpricedTurns: Number(r.unpriced) || 0, tokens: Number(r.tok) || 0 };
  }

  usageSummary(): Array<{ hireId: string; model: string; inputTokens: number; outputTokens: number; turns: number }> {
    return (
      this.db
        .prepare(
          "SELECT hire_id, model, SUM(input_tokens) i, SUM(output_tokens) o, COUNT(*) n FROM usage GROUP BY hire_id, model"
        )
        .all() as any[]
    ).map((r) => ({ hireId: r.hire_id, model: r.model, inputTokens: r.i, outputTokens: r.o, turns: r.n }));
  }
}

function toHire(r: any): Hire {
  return {
    id: r.id,
    name: r.name,
    packId: r.pack_id,
    model: r.model ?? null,
    createdAt: r.created_at,
    paused: !!r.paused,
    budgetUsd: r.budget_usd ?? null,
  };
}
