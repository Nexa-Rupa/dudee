import { useEffect, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { CostSettings, FallbackSettings, GoalsSettings, TeamMemorySettings, TeamSettings } from "./SettingsExtra";
import { api, type ChatProvider, type MediaProvider, type ProvidersView } from "./api";

/** Every model id we can suggest: provider defaults plus models fetched from connected providers. */
export function useModelOptions(view: ProvidersView | null, fetched: Record<string, string[]>) {
  return useMemo(() => {
    if (!view) return [];
    const out: string[] = [];
    for (const p of view.chat) {
      if (!p.configured) continue;
      for (const m of [...(fetched[p.id] ?? []), ...p.models]) out.push(`${p.id}:${m}`);
    }
    return [...new Set(out)];
  }, [view, fetched]);
}

export function ModelInput(props: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  id: string;
  placeholder?: string;
}) {
  return (
    <>
      <input
        list={`${props.id}-list`}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.placeholder ?? "provider:model"}
        spellCheck={false}
        autoComplete="off"
      />
      <datalist id={`${props.id}-list`}>
        {props.options.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
    </>
  );
}

/** Connect providers and pick the default model. Used in Settings and on first run. */
export function ModelsPanel(props: { compact?: boolean; onDefaultChanged?: () => void }) {
  const [view, setView] = useState<ProvidersView | null>(null);
  const [fetched, setFetched] = useState<Record<string, string[]>>({});
  const [model, setModel] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(!props.compact);
  const [custom, setCustom] = useState(false);
  const options = useModelOptions(view, fetched);

  const load = () =>
    api<ProvidersView>("providers").then((v) => {
      setView(v);
      setModel((m) => m || v.defaultModel);
    });
  useEffect(() => {
    load();
  }, []);

  const saveDefault = async (value = model) => {
    setError(null);
    try {
      await api("config", { method: "PATCH", body: { model: value.trim() } });
      setModel(value.trim());
      setSaved("Saved");
      setTimeout(() => setSaved(null), 2000);
      load();
      props.onDefaultChanged?.();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (!view) return <p className="muted">Loading…</p>;
  const connected = view.chat.filter((p) => p.configured && !p.local);
  const popular = ["anthropic", "openai", "google", "openrouter", "groq", "deepseek"];
  const list = showAll ? view.chat : view.chat.filter((p) => popular.includes(p.id) || (p.configured && !p.local));
  const providerOf = (id: string) => view.chat.find((p) => p.id === id.slice(0, id.indexOf(":")));
  const shortName = (p?: ChatProvider) => (p ? p.name.split(" (")[0] : "Unknown provider");
  const currentProvider = providerOf(view.defaultModel);
  const currentWorks = !!currentProvider?.configured;
  // Models from connected providers first; the current default stays listed, marked honestly if it can't run.
  const usable = options.filter((o) => !providerOf(o)?.local || !connected.length);
  const choices = usable.includes(view.defaultModel) ? usable : [view.defaultModel, ...usable];
  const label = (o: string) => {
    const p = providerOf(o);
    const name = `${o.slice(o.indexOf(":") + 1)} — ${shortName(p)}`;
    if (o !== view.defaultModel) return name;
    return p?.configured ? `${name} (current)` : `${name} (current, but ${shortName(p)} isn't connected)`;
  };
  // Once a provider is connected and the current default can't run, start on that provider's first model.
  const firstUsable = usable.find((o) => providerOf(o)?.configured && !providerOf(o)?.local);
  const selected = !currentWorks && firstUsable && model === view.defaultModel ? firstUsable : model;

  const picker = (
    <section className="default-model" aria-labelledby="default-model-label">
      <label id="default-model-label" htmlFor="default-model">
        Model for new employees
      </label>
      <div className="row">
        {!custom ? (
          <select id="default-model" value={selected} onChange={(e) => setModel(e.target.value)}>
            {choices.map((o) => (
              <option key={o} value={o}>
                {label(o)}
              </option>
            ))}
          </select>
        ) : (
          <ModelInput id="default-model" value={model} onChange={setModel} options={options} placeholder="provider:model, e.g. groq:llama-3.3-70b-versatile" />
        )}
        <button
          className="btn primary"
          onClick={() => saveDefault(custom ? model : selected)}
          disabled={custom ? !model.trim() || model === view.defaultModel : selected === view.defaultModel}
        >
          {saved ?? "Use this model"}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {!currentWorks && connected.length > 0 && (
        <p className="note warn-note">
          Your employees are set to use {shortName(currentProvider)}, which isn't connected. Pick a model from{" "}
          {connected.map((p) => shortName(p)).join(" or ")} and press Use this model.
        </p>
      )}
      <p className="note">
        {connected.length
          ? `Connected: ${connected.map((p) => p.name.split(" (")[0]).join(", ")}.`
          : "Connect a provider to see its models here."}{" "}
        <button className="btn quiet small" onClick={() => setCustom(!custom)}>
          {custom ? "Pick from the list" : "Use a model that isn't listed"}
        </button>
      </p>
    </section>
  );

  const providerList = (
    <section aria-labelledby="providers-label" className="provider-section">
      <h3 id="providers-label" className="sub-h">
        {connected.length ? "Providers" : "Pick a provider and paste its key"}
      </h3>
      <ul className="providers">
        {list.map((p) => (
          <ProviderRow
            key={p.id}
            p={p}
            models={fetched[p.id]}
            onModels={(m) => setFetched((f) => ({ ...f, [p.id]: m }))}
            onChanged={setView}
            onPick={(m) => saveDefault(`${p.id}:${m}`)}
            current={view.defaultModel}
          />
        ))}
      </ul>
      {!showAll && (
        <button className="btn small more" onClick={() => setShowAll(true)}>
          <ChevronDown size={14} aria-hidden /> Show all {view.chat.length} providers
          <span className="muted">Moonshot, Z.ai, Qwen, xAI, Mistral, Ollama…</span>
        </button>
      )}
    </section>
  );

  return (
    <div className="models">
      {props.compact && connected.length === 0 ? (
        providerList
      ) : props.compact ? (
        <>
          {providerList}
          {picker}
        </>
      ) : (
        <>
          {picker}
          {providerList}
        </>
      )}
      {!props.compact && (
        <>
          <h2 className="section-h">Media and tools</h2>
          <ul className="providers">
            {view.media.map((m) => (
              <MediaRow key={m.id} m={m} onChanged={setView} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function ProviderRow(props: {
  p: ChatProvider;
  models?: string[];
  onModels: (m: string[]) => void;
  onChanged: (v: ProvidersView) => void;
  onPick: (model: string) => void;
  current: string;
}) {
  const { p } = props;
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [base, setBase] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const check = async () => {
    setBusy(true);
    setMsg(null);
    const r = await api<{ models: string[]; error?: string }>(`providers/${p.id}/models`);
    setBusy(false);
    if (r.error) setMsg({ ok: false, text: r.error });
    else {
      props.onModels(r.models);
      setMsg({ ok: true, text: `Working. ${r.models.length} models available.` });
    }
  };

  const saveKey = async () => {
    setBusy(true);
    setMsg(null);
    try {
      if (base.trim() && p.baseURLEnv) props.onChanged(await api(`keys/${p.baseURLEnv}`, { method: "PUT", body: { value: base } }));
      if (key.trim() && p.keyEnv) props.onChanged(await api(`keys/${p.keyEnv}`, { method: "PUT", body: { value: key } }));
      setKey("");
      setBusy(false);
      await check();
    } catch (e) {
      setBusy(false);
      setMsg({ ok: false, text: (e as Error).message });
    }
  };

  const removeKey = async () => {
    if (!p.keyEnv) return;
    props.onChanged(await api(`keys/${p.keyEnv}`, { method: "DELETE" }));
    props.onModels([]);
    setMsg(null);
  };

  const status = p.local ? "Local" : p.configured ? (p.keySource === "env" ? "From .env" : "Connected") : "Not connected";
  const usingThis = props.current.startsWith(`${p.id}:`) && p.configured;

  return (
    <li className={`provider${p.configured && !p.local ? " on" : ""}`}>
      <button className="provider-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="provider-name">
          {p.name}
          {usingThis && <span className="tag accent">Default</span>}
        </span>
        <span className={`pill ${p.local ? "local" : p.configured ? "ok" : ""}`}>{status}</span>
      </button>
      {open && (
        <div className="provider-body">
          {p.note && <p className="note">{p.note}</p>}
          {p.keyEnv && (
            <label>
              <span>
                API key {p.masked && <span className="muted">(current {p.masked})</span>}
              </span>
              <input
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder={p.local ? "Optional" : `Paste your ${p.name.split(" (")[0]} key`}
                autoComplete="off"
              />
            </label>
          )}
          {p.baseURLEnv && (
            <label>
              <span>
                Address <span className="muted">(optional)</span>
              </span>
              <input value={base} onChange={(e) => setBase(e.target.value)} placeholder={p.baseURL ?? ""} spellCheck={false} />
            </label>
          )}
          <div className="card-actions">
            {(p.keyEnv || p.baseURLEnv) && (
              <button className="btn primary" disabled={busy || (!key.trim() && !base.trim())} onClick={saveKey}>
                Save and check
              </button>
            )}
            <button className="btn" disabled={busy || (!p.configured && !p.local)} onClick={check}>
              {busy ? "Checking…" : "Check and list models"}
            </button>
            {p.keySource === "saved" && (
              <button className="btn quiet apart" onClick={removeKey}>
                Remove key
              </button>
            )}
            {p.keyUrl && (
              <a className="link" href={p.keyUrl} target="_blank" rel="noreferrer">
                Get a key
              </a>
            )}
          </div>
          {msg && <p className={msg.ok ? "ok" : "error"}>{msg.text}</p>}
          {(p.configured || p.local) && !!(props.models?.length || p.models.length) && (
            <div className="model-chips">
              <span className="note">Use as default:</span>
              {[...new Set([...p.models, ...(props.models ?? [])])].slice(0, 40).map((m) => (
                <button key={m} className={`chip${props.current === `${p.id}:${m}` ? " active" : ""}`} onClick={() => props.onPick(m)}>
                  {m}
                </button>
              ))}
            </div>
          )}
          {p.keyEnv && !p.local && (
            <p className="note">
              Keys are saved in <code>.dude/secrets.env</code> on this computer and only sent to {p.name.split(" (")[0]}.
            </p>
          )}
        </div>
      )}
    </li>
  );
}

function MediaRow({ m, onChanged }: { m: MediaProvider; onChanged: (v: ProvidersView) => void }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    try {
      onChanged(await api(`keys/${m.keyEnv}`, { method: "PUT", body: { value: key } }));
      setKey("");
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <li className={`provider${m.configured ? " on" : ""}`}>
      <button className="provider-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="provider-name">{m.name}</span>
        <span className={`pill ${m.configured ? "ok" : ""}`}>{m.configured ? "Connected" : "Not connected"}</span>
      </button>
      {open && (
        <div className="provider-body">
          <p className="note">{m.note}</p>
          <label>
            <span>
              {m.keyEnv} {m.masked && <span className="muted">(current {m.masked})</span>}
            </span>
            <input type="password" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" />
          </label>
          <div className="card-actions">
            <button className="btn primary" disabled={!key.trim()} onClick={save}>
              Save
            </button>
            {m.keySource === "saved" && (
              <button className="btn quiet apart" onClick={async () => onChanged(await api(`keys/${m.keyEnv}`, { method: "DELETE" }))}>
                Remove key
              </button>
            )}
            <a className="link" href={m.keyUrl} target="_blank" rel="noreferrer">
              Get a key
            </a>
          </div>
          {error && <p className="error">{error}</p>}
        </div>
      )}
    </li>
  );
}

export function SettingsPage(props: { onChanged: () => void }) {
  return (
    <div className="page settings-page">
      <header className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="page-meta">Models, keys and skills for the whole team. Keys stay on this computer.</p>
        </div>
      </header>
      <section aria-labelledby="models-h">
        <h2 id="models-h">Models</h2>
        <ModelsPanel onDefaultChanged={props.onChanged} />
      </section>
      <FallbackSettings />
      <GoalsSettings onChanged={props.onChanged} />
      <TeamMemorySettings />
      <CostSettings onChanged={props.onChanged} />
      <TeamSettings onChanged={props.onChanged} />
      <SkillsSettings />
    </div>
  );
}

function SkillsSettings() {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    api<{ globalSkills?: boolean }>("settings").then((s) => setOn(s.globalSkills !== false)).catch(() => setOn(true));
  }, []);
  return (
    <section>
      <h2 className="section-h">Skills</h2>
      <label className="switch">
        <input
          type="checkbox"
          checked={!!on}
          disabled={on === null}
          onChange={async (e) => {
            setOn(e.target.checked);
            await api("config", { method: "PATCH", body: { globalSkills: e.target.checked } });
          }}
        />
        <span>Share my global skills with every employee</span>
      </label>
      <p className="note">
        Loads Agent Skills from <code>~/.claude/skills</code> and <code>~/.agents/skills</code>, the same ones Claude Code and
        Codex use. Workspace skills go in <code>.dude/skills/</code>. Type <code>/</code> in a chat to run one.
      </p>
    </section>
  );
}
