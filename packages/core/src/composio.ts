import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

/**
 * Connected apps through Composio (500+ apps over OAuth: Gmail, Slack, X, LinkedIn, Instagram, YouTube, …).
 *
 * The user pastes one Composio project key (ak_…) as COMPOSIO_API_KEY. dudee keeps one stable Composio user
 * for the workspace and one Tool Router Session, which owns the connections and serves an MCP endpoint.
 * Every employee gets that MCP server as `apps__*` tools. Connecting an app returns a sign-in link the user
 * opens in their own browser; dudee never sees the app's password.
 */
const API = () => (process.env.DUDE_COMPOSIO_API ?? "https://backend.composio.dev/api/v3.1").replace(/\/$/, "");
const TOOLKITS_API = () => (process.env.DUDE_COMPOSIO_TOOLKITS_API ?? "https://backend.composio.dev/api/v3").replace(/\/$/, "");

export interface ComposioState {
  userId: string;
  sessionId?: string;
  mcpUrl?: string;
}

export interface ConnectedAccount {
  id: string;
  toolkit: string;
  alias: string | null;
  status: string;
  updatedAt: string | null;
}

export interface AppCard {
  slug: string;
  name: string;
  blurb: string;
  category: string;
  logo?: string | null;
}

/** Apps worth showing before the user searches. Social ones first: they power daily posting. */
export const CURATED_APPS: AppCard[] = [
  { slug: "twitter", name: "X (Twitter)", blurb: "Post, reply and read on X", category: "Social" },
  { slug: "linkedin", name: "LinkedIn", blurb: "Share posts to your profile or page", category: "Social" },
  { slug: "instagram", name: "Instagram", blurb: "Publish photos, reels and carousels (business accounts)", category: "Social" },
  { slug: "facebook", name: "Facebook Pages", blurb: "Post to pages you manage", category: "Social" },
  { slug: "youtube", name: "YouTube", blurb: "Upload videos and Shorts", category: "Social" },
  { slug: "tiktok", name: "TikTok", blurb: "Upload videos", category: "Social" },
  { slug: "reddit", name: "Reddit", blurb: "Post and comment", category: "Social" },
  { slug: "pinterest", name: "Pinterest", blurb: "Create pins", category: "Social" },
  { slug: "threads", name: "Threads", blurb: "Post to Threads", category: "Social" },
  { slug: "gmail", name: "Gmail", blurb: "Read and send email", category: "Communication" },
  { slug: "slack", name: "Slack", blurb: "Post updates and read channels", category: "Communication" },
  { slug: "discord", name: "Discord", blurb: "Messages and channels", category: "Communication" },
  { slug: "googlecalendar", name: "Google Calendar", blurb: "Read and create events", category: "Productivity" },
  { slug: "googlesheets", name: "Google Sheets", blurb: "Read and update spreadsheets", category: "Productivity" },
  { slug: "googledocs", name: "Google Docs", blurb: "Read and write documents", category: "Productivity" },
  { slug: "googledrive", name: "Google Drive", blurb: "Browse and manage files", category: "Files" },
  { slug: "notion", name: "Notion", blurb: "Pages and databases", category: "Productivity" },
  { slug: "hubspot", name: "HubSpot", blurb: "CRM contacts and deals", category: "Sales" },
  { slug: "salesforce", name: "Salesforce", blurb: "CRM records and reports", category: "Sales" },
  { slug: "github", name: "GitHub", blurb: "Issues, pull requests and code", category: "Developer" },
  { slug: "linear", name: "Linear", blurb: "Issues and projects", category: "Developer" },
  { slug: "jira", name: "Jira", blurb: "Issues and sprints", category: "Developer" },
  { slug: "airtable", name: "Airtable", blurb: "Bases and records", category: "Productivity" },
  { slug: "trello", name: "Trello", blurb: "Boards and cards", category: "Productivity" },
  { slug: "asana", name: "Asana", blurb: "Tasks and projects", category: "Productivity" },
  { slug: "dropbox", name: "Dropbox", blurb: "Files and folders", category: "Files" },
  { slug: "canva", name: "Canva", blurb: "Designs and brand assets", category: "Design" },
  { slug: "figma", name: "Figma", blurb: "Files and comments", category: "Design" },
  { slug: "stripe", name: "Stripe", blurb: "Payments and customers", category: "Finance" },
  { slug: "shopify", name: "Shopify", blurb: "Orders, products and customers", category: "Commerce" },
  { slug: "wordpress", name: "WordPress", blurb: "Publish blog posts", category: "Content" },
  { slug: "mailchimp", name: "Mailchimp", blurb: "Audiences and campaigns", category: "Marketing" },
];

export function composioKey(env: NodeJS.ProcessEnv = process.env) {
  return env.COMPOSIO_API_KEY?.trim() || null;
}

function headers(key: string, json = false): Record<string, string> {
  return json ? { "x-api-key": key, "content-type": "application/json" } : { "x-api-key": key };
}

async function failure(res: Response, what: string) {
  const body: any = await res.json().catch(() => null);
  const msg = body?.error?.message ?? body?.message ?? (typeof body?.error === "string" ? body.error : "");
  return new Error(`${what}: Composio said ${res.status}${msg ? ` (${msg})` : ""}`);
}

/** Composio only hands out MCP URLs and sign-in links on its own hosts; anything else is refused. */
function trusted(url: string) {
  try {
    const u = new URL(url);
    if (process.env.DUDE_COMPOSIO_API && u.origin === new URL(process.env.DUDE_COMPOSIO_API).origin) return true;
    return u.protocol === "https:";
  } catch {
    return false;
  }
}

export class Composio {
  private file: string;

  constructor(private home: string) {
    this.file = path.join(home, "composio.json");
  }

  get configured() {
    return !!composioKey();
  }

  state(): ComposioState {
    if (fs.existsSync(this.file)) {
      try {
        const s = JSON.parse(fs.readFileSync(this.file, "utf8"));
        if (s?.userId) return s;
      } catch {
        /* rewritten below */
      }
    }
    const fresh: ComposioState = { userId: `dudee_${randomUUID().replace(/-/g, "").slice(0, 16)}` };
    this.save(fresh);
    return fresh;
  }

  private save(s: ComposioState) {
    fs.mkdirSync(this.home, { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(s, null, 2), { mode: 0o600 });
  }

  private requireKey() {
    const key = composioKey();
    if (!key) throw new Error("Add a Composio project key (ak_…) in Connections to connect apps.");
    return key;
  }

  /** The workspace's Tool Router Session, made on first use and reused after. */
  async session(opts: { fresh?: boolean } = {}): Promise<{ sessionId: string; mcpUrl: string }> {
    const key = this.requireKey();
    const s = this.state();
    if (s.sessionId && s.mcpUrl && !opts.fresh) {
      const res = await fetch(`${API()}/tool_router/session/${encodeURIComponent(s.sessionId)}`, {
        headers: headers(key),
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) return { sessionId: s.sessionId, mcpUrl: s.mcpUrl };
      if (res.status !== 404 && res.status !== 401 && res.status !== 403) throw await failure(res, "Composio session");
    }
    const res = await fetch(`${API()}/tool_router/session`, {
      method: "POST",
      headers: headers(key, true),
      body: JSON.stringify({
        user_id: s.userId,
        manage_connections: { enable: true, enable_wait_for_connections: true, enable_connection_removal: true },
        multi_account: { enable: true, max_accounts_per_toolkit: 10, require_explicit_selection: true },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw await failure(res, "Composio rejected this key");
    const body: any = await res.json();
    const mcpUrl = body?.mcp?.url;
    if (!body?.session_id || typeof mcpUrl !== "string" || !trusted(mcpUrl)) throw new Error("Composio returned an unexpected session");
    this.save({ ...s, sessionId: body.session_id, mcpUrl });
    return { sessionId: body.session_id, mcpUrl };
  }

  /** Forget the session (the key changed; a new key belongs to another project). The user id stays. */
  forgetSession() {
    const s = this.state();
    this.save({ userId: s.userId });
  }

  /** The cached session's MCP address, without network. Null until a session exists. */
  cachedMcp(): { url: string; headers: Record<string, string> } | null {
    const key = composioKey();
    const s = this.state();
    if (!key || !s.mcpUrl) return null;
    return { url: s.mcpUrl, headers: { "x-api-key": key } };
  }

  /** A sign-in link for one app. The user finishes the OAuth in their own browser. */
  async connectLink(toolkit: string, alias?: string): Promise<string> {
    const key = this.requireKey();
    const slug = toolkit.trim().toLowerCase();
    if (!/^[a-z0-9_-]+$/.test(slug)) throw new Error("Bad app name");
    const { sessionId } = await this.session();
    const body: Record<string, string> = { toolkit: slug };
    if (alias?.trim()) body.alias = alias.trim().slice(0, 40);
    const res = await fetch(`${API()}/tool_router/session/${encodeURIComponent(sessionId)}/link`, {
      method: "POST",
      headers: headers(key, true),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw await failure(res, `Connecting ${slug}`);
    const data: any = await res.json();
    const url = data?.redirect_url ?? data?.redirectUrl;
    if (typeof url !== "string" || !trusted(url)) throw new Error("Composio returned no sign-in link");
    return url;
  }

  async accounts(): Promise<ConnectedAccount[]> {
    const key = this.requireKey();
    const { userId } = this.state();
    const out: ConnectedAccount[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      const params = new URLSearchParams({ limit: "50", user_ids: userId, order_by: "updated_at", order_direction: "desc" });
      if (cursor) params.set("cursor", cursor);
      const res = await fetch(`${API()}/connected_accounts?${params}`, { headers: headers(key), signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw await failure(res, "Listing connected apps");
      const body: any = await res.json();
      for (const a of body.items ?? []) {
        if (a.user_id && a.user_id !== userId) continue; // only this workspace's accounts
        out.push({
          id: String(a.id),
          toolkit: String(a.toolkit?.slug ?? "").toLowerCase(),
          alias: a.alias ?? null,
          status: String(a.status ?? "UNKNOWN"),
          updatedAt: a.updated_at ?? null,
        });
      }
      cursor = body.next_cursor || undefined;
      if (!cursor) break;
    }
    return out;
  }

  async disconnect(accountId: string) {
    const key = this.requireKey();
    const mine = (await this.accounts()).some((a) => a.id === accountId);
    if (!mine) throw new Error("That account is not one of this workspace's connections");
    const res = await fetch(`${API()}/connected_accounts/${encodeURIComponent(accountId)}?revoke_on_delete=true`, {
      method: "DELETE",
      headers: headers(key),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw await failure(res, "Disconnecting");
  }

  /** Search Composio's app catalog; falls back to the curated list when offline or unconfigured. */
  async catalog(search = ""): Promise<{ apps: AppCard[]; source: "api" | "curated" }> {
    const q = search.trim().toLowerCase();
    const curated = () =>
      CURATED_APPS.filter((a) => !q || a.slug.includes(q) || a.name.toLowerCase().includes(q) || a.category.toLowerCase().includes(q));
    const key = composioKey();
    if (!key) return { apps: curated(), source: "curated" };
    try {
      const params = new URLSearchParams({ limit: "60", sort_by: "usage" });
      if (q) params.set("search", q);
      const res = await fetch(`${TOOLKITS_API()}/toolkits?${params}`, { headers: headers(key), signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(String(res.status));
      const body: any = await res.json();
      const apps: AppCard[] = (body.items ?? []).map((t: any) => ({
        slug: String(t.slug).toLowerCase(),
        name: String(t.name ?? t.slug),
        blurb: String(t.meta?.description ?? "").slice(0, 120),
        category: String(t.meta?.categories?.[0]?.name ?? "Other"),
        logo: typeof t.meta?.logo === "string" ? t.meta.logo : null,
      }));
      return apps.length ? { apps, source: "api" } : { apps: curated(), source: "curated" };
    } catch {
      return { apps: curated(), source: "curated" };
    }
  }
}

/** Composio's Tool Router meta tools that only look things up run without asking. */
export function composioPolicy(tool: string): "auto" | undefined {
  return /SEARCH|GET_TOOL_SCHEMAS|LIST|WAIT_FOR_CONNECTION|GET_/i.test(tool) && !/EXECUTE/i.test(tool) ? "auto" : undefined;
}
