import { useEffect, useState } from "react";
import { api, type HireView, type PackView, type ProvidersView, type Routine, type Screen, type SkillView } from "./api";
import { ModelInput, useModelOptions } from "./Settings";
import { Markdown } from "./markdown";
import { ArrowLeft, Pause, Play, X } from "lucide-react";
import { allowLabel, timeOf, usd } from "./ui";

type Tab = "screen" | "files" | "memory" | "routines" | "about";

export function Details(props: {
  hire: HireView;
  pack: PackView | undefined;
  screen: Screen | null;
  version: number;
  initialTab?: Tab;
  onFired: () => void;
  onClose: () => void;
}) {
  const { hire } = props;
  const tabs: Tab[] = hire.hasBrowser ? ["screen", "files", "memory", "routines", "about"] : ["files", "memory", "routines", "about"];
  const [tab, setTab] = useState<Tab>(props.initialTab ?? tabs[0]);
  useEffect(() => setTab(props.initialTab ?? tabs[0]), [hire.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <aside className="details" aria-label={`${hire.name}'s details`}>
      <div className="tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
        <button className="icon-btn tabs-close" onClick={props.onClose} aria-label="Close panel">
          <X size={17} aria-hidden />
        </button>
      </div>
      <div className="tab-body">
        {tab === "screen" && <ScreenTab hire={hire} screen={props.screen} />}
        {tab === "files" && <FilesTab hire={hire} version={props.version} />}
        {tab === "memory" && <MemoryTab hire={hire} version={props.version} />}
        {tab === "routines" && <RoutinesTab hire={hire} version={props.version} />}
        {tab === "about" && <AboutTab hire={hire} pack={props.pack} onFired={props.onFired} />}
      </div>
    </aside>
  );
}

function ScreenTab({ hire, screen }: { hire: HireView; screen: Screen | null }) {
  if (!screen) {
    return (
      <p className="empty">
        {hire.name}'s browser opens the first time they need it. It runs as a window on this computer, so you can watch it
        or take over there. The latest view shows here.
      </p>
    );
  }
  return (
    <figure className="screen">
      <img src={`data:${screen.mime};base64,${screen.data}`} alt={`${hire.name}'s browser`} />
      <figcaption>Last updated {timeOf(screen.at)}</figcaption>
    </figure>
  );
}

function FilesTab({ hire, version }: { hire: HireView; version: number }) {
  const [files, setFiles] = useState<Array<{ path: string; size: number; modified: string }>>([]);
  const [open, setOpen] = useState<{ path: string; text: string } | null>(null);
  useEffect(() => {
    api<typeof files>(`hires/${hire.id}/files`).then(setFiles).catch(() => setFiles([]));
  }, [hire.id, version]);
  useEffect(() => setOpen(null), [hire.id]);

  if (open) {
    return (
      <div className="file-view">
        <button className="btn quiet small" onClick={() => setOpen(null)}>
          <ArrowLeft size={14} aria-hidden /> All files
        </button>
        <h3>{open.path}</h3>
        {open.path.endsWith(".md") ? <Markdown text={open.text} /> : <pre>{open.text}</pre>}
      </div>
    );
  }
  if (!files.length) return <p className="empty">Drafts, reports and plans {hire.name} saves will appear here.</p>;
  return (
    <ul className="files">
      {files.map((f) => (
        <li key={f.path}>
          <button
            onClick={() =>
              api<{ path: string; text: string }>(`hires/${hire.id}/files?path=${encodeURIComponent(f.path)}`).then(setOpen)
            }
          >
            <span className="file-name">{f.path}</span>
            <span className="file-meta">{new Date(f.modified).toLocaleDateString()}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function MemoryTab({ hire, version }: { hire: HireView; version: number }) {
  const [text, setText] = useState("");
  useEffect(() => {
    api<{ text: string }>(`hires/${hire.id}/memory`).then((m) => setText(m.text)).catch(() => setText(""));
  }, [hire.id, version]);
  const entries = text.split("\n").filter((l) => l.startsWith("- ")).map((l) => l.slice(2));
  if (!entries.length) return <p className="empty">Facts {hire.name} learns about your company and preferences show up here.</p>;
  return (
    <ul className="memory">
      {entries.map((e, i) => (
        <li key={i}>{e}</li>
      ))}
    </ul>
  );
}

function RoutinesTab({ hire, version }: { hire: HireView; version: number }) {
  const [routines, setRoutines] = useState<Routine[]>([]);
  const load = () => api<Routine[]>(`hires/${hire.id}/routines`).then(setRoutines).catch(() => setRoutines([]));
  useEffect(() => {
    load();
  }, [hire.id, version]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!routines.length) {
    return <p className="empty">No routines yet. Ask {hire.name} to do something every week and they can schedule it.</p>;
  }
  return (
    <ul className="routines">
      {routines.map((r) => (
        <li key={r.id}>
          <label className="switch">
            <input
              type="checkbox"
              checked={r.enabled}
              onChange={async (e) => {
                await api(`hires/${hire.id}/routines/${encodeURIComponent(r.id)}`, {
                  method: "PATCH",
                  body: { enabled: e.target.checked },
                });
                load();
              }}
            />
            <span className="routine-id">{r.id}</span>
          </label>
          <code className="cron">{r.cron}</code>
          <p>{r.prompt}</p>
          <div className="routine-foot">
            <span className="file-meta">{r.lastRunAt ? `Last ran ${new Date(r.lastRunAt).toLocaleString()}` : "Hasn't run yet"}</span>
            <button
              className="btn small"
              disabled={hire.paused}
              title={hire.paused ? `${hire.name} is paused` : undefined}
              onClick={async () => {
                await api(`hires/${hire.id}/routines/${encodeURIComponent(r.id)}/run`, { method: "POST" });
                load();
              }}
            >
              <Play size={13} aria-hidden /> Run now
            </button>
          </div>
        </li>
      ))}
      <li className="file-meta">
        Routines run while <code>dudee ui</code> or <code>dudee start</code> is running.
      </li>
    </ul>
  );
}

/** Monthly budget, this month's spend, and pause / resume. */
function BudgetBlock({ hire }: { hire: HireView }) {
  const [budget, setBudget] = useState(hire.budgetUsd?.toString() ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => setBudget(hire.budgetUsd?.toString() ?? ""), [hire.id, hire.budgetUsd]);
  const patch = async (body: object, ok: string) => {
    try {
      await api(`hires/${hire.id}`, { method: "PATCH", body });
      setMsg(ok);
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  const pct = hire.budgetUsd ? Math.min(100, (hire.spend.usd / hire.budgetUsd) * 100) : 0;
  return (
    <section className="budget" aria-labelledby={`budget-${hire.id}`}>
      <h3 id={`budget-${hire.id}`}>Spend this month</h3>
      <p className="budget-line">
        <strong className="num">{usd(hire.spend.usd)}</strong>
        {hire.budgetUsd !== null && <span className="muted"> of {usd(hire.budgetUsd)}</span>}
        <span className="muted"> · {hire.spend.turns} {hire.spend.turns === 1 ? "task" : "tasks"}</span>
      </p>
      {hire.budgetUsd !== null && (
        <div className={`meter${pct >= 100 ? " full" : pct >= 80 ? " high" : ""}`} aria-hidden>
          <span style={{ width: `${pct}%` }} />
        </div>
      )}
      {hire.spend.unpricedTurns > 0 && (
        <p className="note">
          {hire.spend.unpricedTurns} task{hire.spend.unpricedTurns === 1 ? "" : "s"} used a model with no price yet. Add its price in
          Settings so budgets count it.
        </p>
      )}
      <label className="field" htmlFor={`budget-in-${hire.id}`}>
        <span>Monthly budget in US dollars</span>
      </label>
      <div className="row">
        <input
          id={`budget-in-${hire.id}`}
          inputMode="decimal"
          value={budget}
          onChange={(e) => setBudget(e.target.value)}
          placeholder="No limit"
        />
        <button className="btn" onClick={() => patch({ budgetUsd: budget.trim() || null }, budget.trim() ? "Budget saved" : "Limit removed")}>
          Save
        </button>
      </div>
      <p className="note">At 80% you get a note; at 100% {hire.name} pauses until you raise it or resume them.</p>
      <div className="row-actions">
        {hire.paused ? (
          <button className="btn primary" onClick={() => patch({ paused: false }, `${hire.name} is back at work`)}>
            <Play size={14} aria-hidden /> Resume {hire.name}
          </button>
        ) : (
          <button className="btn" onClick={() => patch({ paused: true }, `${hire.name} is paused`)}>
            <Pause size={14} aria-hidden /> Pause {hire.name}
          </button>
        )}
      </div>
      {msg && <p className="note">{msg}</p>}
    </section>
  );
}

/** Actions this employee may take without asking, with a way to take that back. */
function AllowedBlock({ hire }: { hire: HireView }) {
  const [rules, setRules] = useState<Array<{ tool: string; policy: string }>>([]);
  const load = () => api<typeof rules>(`hires/${hire.id}/policies`).then(setRules).catch(() => setRules([]));
  useEffect(() => {
    load();
  }, [hire.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!rules.length) return null;
  return (
    <section aria-labelledby={`allowed-${hire.id}`}>
      <h3 id={`allowed-${hire.id}`}>Allowed without asking</h3>
      <ul className="allowed">
        {rules.map((r) => (
          <li key={r.tool}>
            <span>{allowLabel(r.tool)}</span>
            <button
              className="btn small quiet"
              onClick={async () => {
                await api(`hires/${hire.id}/policies/${encodeURIComponent(r.tool)}`, { method: "DELETE" });
                load();
              }}
            >
              Ask again
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function AboutTab({ hire, pack, onFired }: { hire: HireView; pack: PackView | undefined; onFired: () => void }) {
  const [skills, setSkills] = useState<SkillView[]>([]);
  const [view, setView] = useState<ProvidersView | null>(null);
  const [model, setModel] = useState(hire.ownModel ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  const options = useModelOptions(view, {});
  useEffect(() => {
    api<SkillView[]>(`hires/${hire.id}/skills`).then(setSkills).catch(() => setSkills([]));
    api<ProvidersView>("providers").then(setView).catch(() => {});
    setModel(hire.ownModel ?? "");
    setMsg(null);
  }, [hire.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveModel = async () => {
    try {
      await api(`hires/${hire.id}`, { method: "PATCH", body: { model: model.trim() || null } });
      setMsg("Saved");
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  const own = skills.filter((s) => s.source === "pack");
  const shared = skills.filter((s) => s.source !== "pack");

  return (
    <div className="about">
      <dl>
        <dt>Role</dt>
        <dd>{hire.title}</dd>
        <dt>Model</dt>
        <dd>
          <code>{hire.model}</code> {!hire.modelReady && <span className="pill">No key</span>}
        </dd>
        <dt>Hired</dt>
        <dd>{new Date(hire.createdAt).toLocaleDateString()}</dd>
      </dl>
      {pack?.description && <p>{pack.description}</p>}
      <div className="hire-form">
        <label htmlFor={`model-${hire.id}`}>Model for {hire.name}</label>
        <div className="row">
          <ModelInput id={`model-${hire.id}`} value={model} onChange={setModel} options={options} placeholder="workspace default" />
          <button className="btn" onClick={saveModel}>
            Save
          </button>
        </div>
        {msg && <p className="note">{msg}</p>}
      </div>
      <BudgetBlock hire={hire} />
      <AllowedBlock hire={hire} />
      {!!own.length && (
        <>
          <h3>{hire.name}'s skills</h3>
          <ul className="skills">
            {own.map((s) => (
              <li key={s.name}>
                <strong>/{s.name}</strong> {s.description}
              </li>
            ))}
          </ul>
        </>
      )}
      {!!shared.length && (
        <details className="shared-skills">
          <summary>{shared.length} shared skills</summary>
          <ul className="skills">
            {shared.map((s) => (
              <li key={s.name}>
                <strong>/{s.name}</strong> <span className="tag">{s.source}</span> {s.description.slice(0, 160)}
              </li>
            ))}
          </ul>
        </details>
      )}
      <button
        className="btn danger apart-block"
        onClick={async () => {
          if (!confirm(`Remove ${hire.name}? Their memory, files and browser profile are deleted.`)) return;
          await api(`hires/${hire.id}`, { method: "DELETE" });
          onFired();
        }}
      >
        Remove {hire.name}
      </button>
    </div>
  );
}
