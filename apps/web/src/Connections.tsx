import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Plus, Send, Trash2, Video, Search } from "lucide-react";
import { api } from "./api";

// ── types mirrored from @dude/server's /api/connections ────────────────────
type Platform = "x" | "linkedin" | "instagram" | "facebook" | "threads" | "youtube" | "tiktok" | "reddit" | "pinterest" | "other";

interface Plan {
  enabled: boolean;
  time: string;
  days: number[];
  format: "text" | "image" | "video" | "mix";
  videoEngine: "auto" | "remotion" | "hyperframes";
  brief: string;
  topics: string[];
  approval: "ask" | "auto";
}

interface SocialAccount {
  id: string;
  platform: Platform;
  platformName: string;
  toolkit: string;
  handle: string;
  method: "browser" | "composio";
  loginUrl: string | null;
  defaultLoginUrl: string;
  hireId: string | null;
  hireName: string | null;
  autopost: Plan;
  login: { saved: boolean; username: string | null; twoStep: boolean };
  lastRunAt: string | null;
}

interface Post {
  id: string;
  accountId: string;
  at: string;
  status: string;
  text: string;
  media: string[];
  url: string | null;
  error: string | null;
}

interface AppAccount {
  id: string;
  toolkit: string;
  alias: string | null;
  status: string;
}

interface AppCard {
  slug: string;
  name: string;
  blurb: string;
  category: string;
  logo?: string | null;
}

interface McpServer {
  name: string;
  kind: "url" | "command";
  target: string;
}

interface ConnView {
  apps: { configured: boolean; masked: string | null; accounts: AppAccount[]; error: string | null };
  mcpServers: McpServer[];
  telegram: {
    configured: boolean;
    running: boolean;
    bot: string | null;
    error: string | null;
    masked: string | null;
    chats: number[];
    pending: Array<{ code: string; chatId: number; name: string; at: string }>;
    defaultHire: string | null;
    notify: boolean;
  };
  social: { accounts: SocialAccount[]; posts: Post[]; posters: Array<{ id: string; name: string }> };
  platforms: Array<{ id: Platform; name: string; toolkit: string; maxChars: number; video: string }>;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const BLANK_PLAN: Plan = { enabled: true, time: "10:00", days: [], format: "mix", videoEngine: "auto", brief: "", topics: [], approval: "ask" };

export function ConnectionsPage(props: { version: number; hires: Array<{ id: string; name: string }>; onHire: () => void }) {
  const [view, setView] = useState<ConnView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      setView(await api<ConnView>("connections"));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    load();
  }, [props.version]);

  return (
    <div className="page settings-page">
      <header className="page-head">
        <div>
          <h1>Connections</h1>
          <p className="page-meta">Social accounts, apps and chat channels your team can use. Logins and keys stay on this computer.</p>
        </div>
      </header>
      {error && <p className="error">{error}</p>}
      {!view ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <SocialSection view={view} reload={load} onHire={props.onHire} />
          <AppsSection view={view} reload={load} />
          <TelegramSection view={view} reload={load} hires={props.hires} />
          <McpSection view={view} reload={load} />
        </>
      )}
    </div>
  );
}

// ── social accounts and daily autopost ─────────────────────────────────────
function SocialSection({ view, reload, onHire }: { view: ConnView; reload: () => void; onHire: () => void }) {
  const [adding, setAdding] = useState(false);
  const { accounts, posts, posters } = view.social;
  return (
    <section aria-labelledby="social-h">
      <h2 id="social-h">Social accounts and daily autopost</h2>
      <p className="note">
        Add an account, choose who posts and when. Every day your employee writes the post, makes the image or a video herself (Remotion or
        HyperFrames), signs in and publishes. Choose "Ask me first" to approve each post here or on Telegram.
      </p>
      {!posters.length && (
        <div className="panel">
          <p>Nobody on your team can post yet. Hire a Social Media Manager: she plans, makes videos and publishes every day.</p>
          <div className="row-actions">
            <button className="btn primary" onClick={onHire}>
              <Plus size={15} aria-hidden /> Hire a Social Media Manager
            </button>
          </div>
        </div>
      )}
      {accounts.length > 0 && (
        <ul className="providers" style={{ marginTop: 12 }}>
          {accounts.map((a) => (
            <SocialRow key={a.id} a={a} view={view} reload={reload} />
          ))}
        </ul>
      )}
      <div className="row-actions" style={{ marginTop: 12 }}>
        {!adding && (
          <button className="btn" onClick={() => setAdding(true)}>
            <Plus size={15} aria-hidden /> Add a social account
          </button>
        )}
      </div>
      {adding && <AccountForm view={view} onDone={() => { setAdding(false); reload(); }} onCancel={() => setAdding(false)} />}
      {posts.length > 0 && (
        <>
          <h3 className="sub-h section-h">Recent posts</h3>
          <div className="panel">
            <ul className="ledger">
              {posts.slice(0, 15).map((p) => (
                <li key={p.id} style={{ display: "grid", gridTemplateColumns: "110px 90px minmax(0,1fr) auto", gap: 10, padding: "8px 4px", borderTop: "1px solid var(--line)", fontSize: 13.5 }}>
                  <span className="muted">{new Date(p.at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                  <span className={p.status === "posted" ? "ok" : p.status === "failed" ? "error" : "muted"}>{p.status}</span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={p.error ?? p.text}>
                    {accounts.find((a) => a.id === p.accountId)?.handle ?? p.accountId}: {p.text}
                    {p.media.length > 0 && <Video size={13} aria-label="with media" style={{ marginLeft: 6, verticalAlign: -2 }} />}
                  </span>
                  {p.url ? (
                    <a className="link" href={p.url} target="_blank" rel="noreferrer">
                      Open
                    </a>
                  ) : (
                    <span />
                  )}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </section>
  );
}

function SocialRow({ a, view, reload }: { a: SocialAccount; view: ConnView; reload: () => void }) {
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const status = !a.hireId
    ? "Nobody assigned"
    : a.autopost.enabled
      ? `Daily ${a.autopost.time}${a.autopost.days.length && a.autopost.days.length < 7 ? ` · ${a.autopost.days.map((d) => DAYS[d]).join(" ")}` : ""}`
      : "Autopost off";
  const ready = a.method === "composio" ? view.apps.accounts.some((x) => x.toolkit === a.toolkit && x.status === "ACTIVE") : a.login.saved;
  return (
    <li className={`provider${a.autopost.enabled && a.hireId ? " on" : ""}`}>
      <button className="provider-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="provider-name">
          {a.platformName} · {a.handle}
          {a.hireName && <span className="tag">{a.hireName}</span>}
          {!ready && <span className="tag" style={{ background: "var(--amber-soft)", color: "#7a4f00" }}>{a.method === "composio" ? "App not connected" : "No login saved"}</span>}
        </span>
        <span className={`pill ${a.autopost.enabled && a.hireId ? "ok" : ""}`}>{status}</span>
      </button>
      {open && (
        <div className="provider-body">
          <AccountForm view={view} existing={a} onDone={() => { setOpen(false); reload(); }} onCancel={() => setOpen(false)} />
          <div className="card-actions">
            <button
              className="btn"
              disabled={!a.hireId}
              onClick={async () => {
                try {
                  await api(`social/accounts/${encodeURIComponent(a.id)}/post-now`, { method: "POST" });
                  setMsg({ ok: true, text: `${a.hireName} is making today's post now. Watch it in their chat.` });
                } catch (e) {
                  setMsg({ ok: false, text: (e as Error).message });
                }
              }}
            >
              <Send size={15} aria-hidden /> Post now
            </button>
            <button
              className="btn quiet apart"
              onClick={async () => {
                if (!confirm(`Remove ${a.handle} and its saved login? Posts already published stay up.`)) return;
                await api(`social/accounts/${encodeURIComponent(a.id)}`, { method: "DELETE" });
                reload();
              }}
            >
              <Trash2 size={15} aria-hidden /> Remove account
            </button>
          </div>
          {msg && <p className={msg.ok ? "ok" : "error"}>{msg.text}</p>}
        </div>
      )}
    </li>
  );
}

function AccountForm(props: { view: ConnView; existing?: SocialAccount; onDone: () => void; onCancel: () => void }) {
  const { view, existing } = props;
  const [platform, setPlatform] = useState<Platform>(existing?.platform ?? "instagram");
  const [handle, setHandle] = useState(existing?.handle ?? "");
  const [method, setMethod] = useState<"browser" | "composio">(existing?.method ?? "browser");
  const [loginUrl, setLoginUrl] = useState(existing?.loginUrl ?? "");
  const [hireId, setHireId] = useState(existing?.hireId ?? view.social.posters[0]?.id ?? "");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [plan, setPlan] = useState<Plan>(existing?.autopost ?? BLANK_PLAN);
  const [topics, setTopics] = useState((existing?.autopost.topics ?? []).join(", "));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const meta = view.platforms.find((p) => p.id === platform);
  const appConnected = view.apps.accounts.some((x) => x.toolkit === meta?.toolkit && x.status === "ACTIVE");

  const save = async () => {
    setBusy(true);
    setError(null);
    const body = {
      platform,
      handle,
      method,
      loginUrl,
      hireId: hireId || null,
      autopost: { ...plan, topics: topics.split(",").map((t) => t.trim()).filter(Boolean) },
    };
    try {
      if (existing) {
        await api(`social/accounts/${encodeURIComponent(existing.id)}`, { method: "PATCH", body });
        if (method === "browser" && (username || password || totp)) {
          await api(`social/accounts/${encodeURIComponent(existing.id)}/login`, { method: "PUT", body: { username: username || undefined, password: password || undefined, totpSecret: totp || undefined } });
        }
      } else {
        await api("social/accounts", {
          method: "POST",
          body: { ...body, login: method === "browser" && username && password ? { username, password, totpSecret: totp || undefined } : undefined },
        });
      }
      setPassword("");
      setTotp("");
      props.onDone();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  };

  const set = <K extends keyof Plan>(k: K, v: Plan[K]) => setPlan((p) => ({ ...p, [k]: v }));

  return (
    <div className={existing ? "provider-section" : "panel"} style={existing ? undefined : { marginTop: 12 }}>
      {!existing && <h3 className="sub-h">Add a social account</h3>}
      <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
        <label className="field">
          Platform
          <select className="select" value={platform} disabled={!!existing} onChange={(e) => setPlatform(e.target.value as Platform)}>
            {view.platforms.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Handle or page name
          <input value={handle} disabled={!!existing} onChange={(e) => setHandle(e.target.value)} placeholder="@yourbrand" />
        </label>
        <label className="field">
          Who posts
          <select className="select" value={hireId} onChange={(e) => setHireId(e.target.value)}>
            <option value="">Nobody yet</option>
            {view.social.posters.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend style={{ marginBottom: 6 }}>How they sign in</legend>
        <label className="switch">
          <input type="radio" name={`m-${existing?.id ?? "new"}`} checked={method === "browser"} onChange={() => setMethod("browser")} />
          <span>Your username and password (the employee signs in with their own browser)</span>
        </label>
        <label className="switch">
          <input type="radio" name={`m-${existing?.id ?? "new"}`} checked={method === "composio"} onChange={() => setMethod("composio")} disabled={!meta?.toolkit} />
          <span>Connected app over OAuth{meta?.toolkit ? (appConnected ? " (connected)" : " (connect it below under Apps)") : " (not available)"}</span>
        </label>
      </fieldset>

      {method === "browser" && (
        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
          <label className="field">
            Username or email {existing?.login.username && <span className="muted">(saved: {existing.login.username})</span>}
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" placeholder={existing?.login.saved ? "Leave empty to keep" : ""} />
          </label>
          <label className="field">
            Password {existing?.login.saved && <span className="muted">(saved)</span>}
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" placeholder={existing?.login.saved ? "Leave empty to keep" : ""} />
          </label>
          <label className="field">
            Two-step secret <span className="muted">(optional{existing?.login.twoStep ? ", saved" : ""})</span>
            <input value={totp} onChange={(e) => setTotp(e.target.value)} autoComplete="off" placeholder="Base32 key from the authenticator setup" />
          </label>
          {platform === "other" && (
            <label className="field">
              Sign-in page
              <input value={loginUrl} onChange={(e) => setLoginUrl(e.target.value)} placeholder="https://…/login" />
            </label>
          )}
        </div>
      )}
      {method === "browser" && (
        <p className="note">
          Saved encrypted in <code>.dude/vault.json</code>. The AI model never sees it: the employee types it straight into the sign-in page. The
          browser keeps the session, so it signs in again only when the site asks. If a site shows a captcha or a new-device check, the employee
          asks you to finish it on their Screen.
        </p>
      )}

      <h4 className="sub-h">Daily autopost</h4>
      <label className="switch">
        <input type="checkbox" checked={plan.enabled} onChange={(e) => set("enabled", e.target.checked)} />
        <span>Post every day</span>
      </label>
      <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
        <label className="field">
          Time
          <input type="time" value={plan.time} onChange={(e) => set("time", e.target.value)} />
        </label>
        <label className="field">
          Format
          <select className="select" value={plan.format} onChange={(e) => set("format", e.target.value as Plan["format"])}>
            <option value="mix">Mix (text, image, video)</option>
            <option value="video">Video every day</option>
            <option value="image">Image post</option>
            <option value="text">Text only</option>
          </select>
        </label>
        <label className="field">
          Video made with
          <select className="select" value={plan.videoEngine} onChange={(e) => set("videoEngine", e.target.value as Plan["videoEngine"])}>
            <option value="auto">Whichever fits</option>
            <option value="remotion">Remotion (templated scenes)</option>
            <option value="hyperframes">HyperFrames (custom motion)</option>
          </select>
        </label>
        <label className="field">
          Before posting
          <select className="select" value={plan.approval} onChange={(e) => set("approval", e.target.value as Plan["approval"])}>
            <option value="ask">Ask me first</option>
            <option value="auto">Post without asking</option>
          </select>
        </label>
      </div>
      <div className="field">
        Days <span className="muted">(none selected = every day)</span>
        <div className="model-chips">
          {DAYS.map((d, i) => (
            <button
              key={d}
              type="button"
              className={`chip${plan.days.includes(i) ? " active" : ""}`}
              onClick={() => set("days", plan.days.includes(i) ? plan.days.filter((x) => x !== i) : [...plan.days, i].sort())}
            >
              {d}
            </button>
          ))}
        </div>
      </div>
      <label className="field">
        Brief
        <textarea className="goals" rows={3} value={plan.brief} onChange={(e) => set("brief", e.target.value)} placeholder="Who we talk to, our voice, what we sell, what never to say." />
      </label>
      <label className="field">
        Topics to rotate <span className="muted">(comma separated)</span>
        <input value={topics} onChange={(e) => setTopics(e.target.value)} placeholder="tips, behind the scenes, customer story, product feature" />
      </label>
      {plan.approval === "auto" && (
        <p className="note">
          Posts go live without asking. The employee can also make images, voiceovers and videos without asking for this account. You can
          take that back in the employee's About tab.
        </p>
      )}
      {error && <p className="error">{error}</p>}
      <div className="card-actions">
        <button className="btn primary" disabled={busy || !handle.trim()} onClick={save}>
          {existing ? "Save changes" : "Add account"}
        </button>
        <button className="btn quiet" onClick={props.onCancel}>
          Cancel
        </button>
        {existing?.login.saved && method === "browser" && (
          <button
            className="btn quiet apart"
            onClick={async () => {
              await api(`social/accounts/${encodeURIComponent(existing.id)}/login`, { method: "DELETE" });
              props.onDone();
            }}
          >
            Forget saved login
          </button>
        )}
      </div>
    </div>
  );
}

// ── connected apps (Composio) ──────────────────────────────────────────────
function AppsSection({ view, reload }: { view: ConnView; reload: () => void }) {
  const [key, setKey] = useState("");
  const [q, setQ] = useState("");
  const [catalog, setCatalog] = useState<AppCard[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const { apps } = view;

  useEffect(() => {
    const t = setTimeout(() => {
      api<{ apps: AppCard[] }>(`apps/catalog?q=${encodeURIComponent(q)}`).then((r) => setCatalog(r.apps)).catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [q, apps.configured]);

  const connected = useMemo(() => new Set(apps.accounts.filter((a) => a.status === "ACTIVE").map((a) => a.toolkit)), [apps.accounts]);

  const connect = async (slug: string) => {
    setMsg(null);
    const tab = window.open("about:blank", "_blank"); // opened during the click so it isn't blocked
    try {
      const r = await api<{ url: string }>("apps/connect", { method: "POST", body: { toolkit: slug } });
      if (tab) tab.location.href = r.url;
      else window.open(r.url, "_blank");
      setMsg({ ok: true, text: `Finish signing in to ${slug} in the new tab, then come back. Employees get its tools on their next task.` });
    } catch (e) {
      tab?.close();
      setMsg({ ok: false, text: (e as Error).message });
    }
  };

  return (
    <section aria-labelledby="apps-h">
      <h2 id="apps-h">Apps</h2>
      <p className="note">
        Connect Gmail, Slack, X, LinkedIn, Instagram, YouTube, Notion, HubSpot and 500+ more over OAuth through{" "}
        <a href="https://composio.dev" target="_blank" rel="noreferrer">
          Composio
        </a>
        . You sign in on the app's own page; employees then use it as tools, and anything that sends or changes something still asks you first.
      </p>
      <div className="panel">
        <label className="field">
          Composio project key {apps.masked && <span className="muted">(current {apps.masked})</span>}
          <div className="row">
            <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="ak_…" autoComplete="off" />
            <button
              className="btn primary"
              disabled={!key.trim()}
              onClick={async () => {
                try {
                  await api("keys/COMPOSIO_API_KEY", { method: "PUT", body: { value: key } });
                  setKey("");
                  reload();
                } catch (e) {
                  setMsg({ ok: false, text: (e as Error).message });
                }
              }}
            >
              Save
            </button>
            {apps.configured && (
              <button
                className="btn quiet"
                onClick={async () => {
                  await api("keys/COMPOSIO_API_KEY", { method: "DELETE" });
                  reload();
                }}
              >
                Remove
              </button>
            )}
          </div>
        </label>
        <p className="note">
          Free at{" "}
          <a href="https://dashboard.composio.dev" target="_blank" rel="noreferrer">
            dashboard.composio.dev
          </a>{" "}
          → your project → Settings → API keys. Use the project key (starts with <code>ak_</code>).
        </p>
        {apps.error && <p className="error">{apps.error}</p>}
        {apps.accounts.length > 0 && (
          <>
            <h3 className="sub-h">Connected</h3>
            <div className="model-chips">
              {apps.accounts.map((a) => (
                <span key={a.id} className="chip" style={{ display: "inline-flex", gap: 6, alignItems: "center", fontFamily: "inherit" }}>
                  {a.toolkit}
                  {a.alias ? ` (${a.alias})` : ""} · <span className={a.status === "ACTIVE" ? "ok" : "error"}>{a.status.toLowerCase()}</span>
                  <button
                    className="icon-btn"
                    style={{ width: 22, height: 22 }}
                    aria-label={`Disconnect ${a.toolkit}`}
                    onClick={async () => {
                      if (!confirm(`Disconnect ${a.toolkit}? Employees lose access to it.`)) return;
                      await api(`apps/accounts/${encodeURIComponent(a.id)}`, { method: "DELETE" });
                      reload();
                    }}
                  >
                    <Trash2 size={13} aria-hidden />
                  </button>
                </span>
              ))}
            </div>
          </>
        )}
        <h3 className="sub-h">Add an app</h3>
        <div className="row">
          <Search size={16} aria-hidden style={{ alignSelf: "center", color: "var(--muted)" }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search apps (instagram, gmail, notion…)" />
        </div>
        <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", maxHeight: 360, overflowY: "auto" }}>
          {catalog.map((app) => (
            <div key={app.slug} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 10, display: "grid", gap: 4 }}>
              <strong style={{ fontSize: 14 }}>{app.name}</strong>
              <span className="note">{app.blurb || app.category}</span>
              <div>
                {connected.has(app.slug) ? (
                  <span className="pill ok">Connected</span>
                ) : (
                  <button className="btn" disabled={!apps.configured} onClick={() => connect(app.slug)}>
                    <ExternalLink size={14} aria-hidden /> Connect
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        {!apps.configured && <p className="note">Save a Composio key to connect apps.</p>}
        {msg && <p className={msg.ok ? "ok" : "error"}>{msg.text}</p>}
      </div>
    </section>
  );
}

// ── Telegram ───────────────────────────────────────────────────────────────
function TelegramSection({ view, reload, hires }: { view: ConnView; reload: () => void; hires: Array<{ id: string; name: string }> }) {
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const t = view.telegram;
  return (
    <section aria-labelledby="tg-h">
      <h2 id="tg-h">Telegram</h2>
      <p className="note">Message your employees from your phone, approve posts with one tap and get what scheduled work did.</p>
      <div className="panel">
        <label className="field">
          Bot token {t.masked && <span className="muted">(current {t.masked})</span>}
          <div className="row">
            <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="123456:ABC…" autoComplete="off" />
            <button
              className="btn primary"
              disabled={!token.trim()}
              onClick={async () => {
                try {
                  await api("keys/TELEGRAM_BOT_TOKEN", { method: "PUT", body: { value: token } });
                  setToken("");
                  setTimeout(reload, 1500);
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Save
            </button>
            {t.configured && (
              <button
                className="btn quiet"
                onClick={async () => {
                  await api("keys/TELEGRAM_BOT_TOKEN", { method: "DELETE" });
                  reload();
                }}
              >
                Remove
              </button>
            )}
          </div>
        </label>
        <p className="note">
          In Telegram, message <strong>@BotFather</strong>, send <code>/newbot</code>, and paste the token it gives you. Then message your bot: it
          replies with a code to approve here.
        </p>
        {t.configured && (
          <p className={t.running ? "ok" : "error"}>
            {t.running ? `Running${t.bot ? ` as ${t.bot}` : ""}.` : `Not running${t.error ? `: ${t.error}` : "."}`}
          </p>
        )}
        {t.pending.map((p) => (
          <div key={p.code} className="row-actions">
            <span>
              <strong>{p.name}</strong> wants to connect · code <code>{p.code}</code>
            </span>
            <button
              className="btn primary"
              onClick={async () => {
                try {
                  await api(`telegram/pair/${p.code}`, { method: "POST" });
                  reload();
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Approve
            </button>
            <button
              className="btn quiet"
              onClick={async () => {
                await api(`telegram/pair/${p.code}`, { method: "DELETE" });
                reload();
              }}
            >
              Ignore
            </button>
          </div>
        ))}
        {t.chats.length > 0 && (
          <>
            <h3 className="sub-h">Connected chats</h3>
            <div className="model-chips">
              {t.chats.map((c) => (
                <span key={c} className="chip" style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                  {c}
                  <button
                    className="icon-btn"
                    style={{ width: 22, height: 22 }}
                    aria-label={`Disconnect chat ${c}`}
                    onClick={async () => {
                      await api(`telegram/chats/${c}`, { method: "DELETE" });
                      reload();
                    }}
                  >
                    <Trash2 size={13} aria-hidden />
                  </button>
                </span>
              ))}
            </div>
            <label className="field">
              Messages without a name go to
              <select
                className="select"
                value={t.defaultHire ?? ""}
                onChange={async (e) => {
                  await api("telegram", { method: "PATCH", body: { defaultHire: e.target.value || null } });
                  reload();
                }}
              >
                <option value="">The first employee</option>
                {hires.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="switch">
              <input
                type="checkbox"
                checked={t.notify}
                onChange={async (e) => {
                  await api("telegram", { method: "PATCH", body: { notify: e.target.checked } });
                  reload();
                }}
              />
              <span>Send me what routines and daily posts did</span>
            </label>
          </>
        )}
        {error && <p className="error">{error}</p>}
      </div>
    </section>
  );
}

// ── app servers (MCP) ──────────────────────────────────────────────────────
function McpSection({ view, reload }: { view: ConnView; reload: () => void }) {
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [extra, setExtra] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const body = () => {
    const pairs = Object.fromEntries(
      extra
        .split(/\r?\n/)
        .map((l) => l.match(/^\s*([^=:]+?)\s*[=:]\s*(.+)\s*$/))
        .filter(Boolean)
        .map((m) => [m![1], m![2]])
    );
    if (/^https?:\/\//.test(target.trim())) return { url: target.trim(), headers: pairs };
    const [command, ...args] = target.trim().match(/"[^"]*"|\S+/g)?.map((s) => s.replace(/^"|"$/g, "")) ?? [];
    return { command, args, env: pairs };
  };

  const submit = async (test: boolean) => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ ok: boolean; tools: number; error?: string }>(`mcp-servers/${encodeURIComponent(name)}${test ? "/test" : ""}`, {
        method: test ? "POST" : "PUT",
        body: body(),
      });
      if (test) setMsg(r.ok ? { ok: true, text: `Connected: ${r.tools} tools.` } : { ok: false, text: r.error ?? "Couldn't connect" });
      else {
        setMsg({ ok: true, text: `Added: ${r.tools} tools. Employees can use them on their next task.` });
        setName("");
        setTarget("");
        setExtra("");
        reload();
      }
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
    setBusy(false);
  };

  return (
    <section aria-labelledby="mcp-h">
      <h2 id="mcp-h">App servers (MCP)</h2>
      <p className="note">Any MCP server works: your company's own, GitHub, Zapier, Linear, Notion. Tools that only read run at once; the rest ask.</p>
      <div className="panel">
        {view.mcpServers.length > 0 && (
          <ul className="ledger">
            {view.mcpServers.map((s) => (
              <li key={s.name} className="row-actions" style={{ padding: "6px 0", borderTop: "1px solid var(--line)" }}>
                <strong>{s.name}</strong>
                <code style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, flex: 1 }}>{s.target}</code>
                <button
                  className="btn quiet"
                  onClick={async () => {
                    await api(`mcp-servers/${encodeURIComponent(s.name)}`, { method: "DELETE" });
                    reload();
                  }}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "180px minmax(0, 1fr)" }}>
          <label className="field">
            Name
            <input value={name} onChange={(e) => setName(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ""))} placeholder="github" />
          </label>
          <label className="field">
            URL or command
            <input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="https://mcp.example.com/mcp   or   npx -y @modelcontextprotocol/server-github" />
          </label>
        </div>
        <label className="field">
          Headers (for a URL) or environment (for a command), one per line <span className="muted">e.g. Authorization=Bearer …</span>
          <textarea className="goals" rows={2} value={extra} onChange={(e) => setExtra(e.target.value)} spellCheck={false} />
        </label>
        <div className="card-actions">
          <button className="btn" disabled={busy || !name || !target.trim()} onClick={() => submit(true)}>
            {busy ? "Connecting…" : "Test"}
          </button>
          <button className="btn primary" disabled={busy || !name || !target.trim()} onClick={() => submit(false)}>
            Add server
          </button>
        </div>
        {msg && <p className={msg.ok ? "ok" : "error"}>{msg.text}</p>}
      </div>
    </section>
  );
}
