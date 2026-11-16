import { useCallback, useEffect, useState } from "react";
import { PanelRightClose, PanelRightOpen, Check, RefreshCw } from "lucide-react";
import { api, ApiError, subscribe, type AppState, type HireView, type Screen, type ServerEvent, type StoredRow } from "./api";
import { Board } from "./Board";
import { Chat } from "./Chat";
import { Details } from "./Details";
import { HirePicker } from "./HireDialog";
import { ModelsPanel, SettingsPage } from "./Settings";
import { Sidebar, type View } from "./Sidebar";

function remembered(): View {
  try {
    const v = JSON.parse(sessionStorage.getItem("dude-view") ?? "null");
    if (v && typeof v.kind === "string") return v;
  } catch {
    /* fall through */
  }
  return { kind: "board" };
}

export function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [view, setView] = useState<View>(remembered);
  const [panelTab, setPanelTab] = useState<"files" | undefined>(undefined);
  const [rows, setRows] = useState<Record<string, StoredRow[]>>({});
  const [screens, setScreens] = useState<Record<string, Screen>>({});
  const [version, setVersion] = useState(0);
  const [showDetails, setShowDetails] = useState(() => window.innerWidth > 1180);

  const go = (v: View, tab?: "files") => {
    setView(v);
    setPanelTab(tab);
    if (tab) setShowDetails(true);
    try {
      sessionStorage.setItem("dude-view", JSON.stringify(v));
    } catch {
      /* private mode */
    }
  };

  const refresh = useCallback(async () => {
    try {
      setState(await api<AppState>("state"));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError && e.status === 401 ? "auth" : (e as Error).message);
    }
  }, []);

  useEffect(() => {
    refresh();
    return subscribe(
      (e: ServerEvent) => {
        switch (e.type) {
          case "hello":
          case "team-changed":
          case "settings-changed":
            refresh();
            break;
          case "row":
            setRows((all) => {
              const list = all[e.hireId];
              if (!list || list.some((r) => r.seq === e.row.seq)) return all;
              return { ...all, [e.hireId]: [...list, e.row] };
            });
            if (e.row.row.kind === "tool" || (e.row.row.kind === "message" && e.row.row.role === "assistant")) setVersion((v) => v + 1);
            break;
          case "status":
          case "delta":
            setState((s) => {
              if (!s) return s;
              return {
                ...s,
                hires: s.hires.map((h) => {
                  if (h.id !== e.hireId) return h;
                  if (e.type === "delta") return h.live ? { ...h, live: { ...h.live, text: h.live.text + e.text } } : h;
                  if (e.status === "idle") return { ...h, live: null };
                  return {
                    ...h,
                    live: { status: e.status, detail: e.detail, since: h.live?.since ?? new Date().toISOString(), text: h.live?.text ?? "" },
                  };
                }),
              };
            });
            break;
          case "screen":
            setScreens((all) => ({ ...all, [e.hireId]: { mime: e.mime, data: e.data, at: e.at } }));
            break;
          case "routines-changed":
            setVersion((v) => v + 1);
            break;
          case "approval":
            setState((s) => s && { ...s, approvals: [...s.approvals.filter((a) => a.id !== e.approval.id), e.approval] });
            break;
          case "approval-closed":
            setState((s) => s && { ...s, approvals: s.approvals.filter((a) => a.id !== e.id) });
            break;
          case "question":
            setState((s) => s && { ...s, questions: [...s.questions.filter((q) => q.id !== e.question.id), e.question] });
            break;
          case "question-closed":
            setState((s) => s && { ...s, questions: s.questions.filter((q) => q.id !== e.id) });
            break;
        }
      },
      setConnected
    );
  }, [refresh]);

  const hires = state?.hires ?? [];
  const current = view.kind === "employee" ? hires.find((h) => h.id === view.id) ?? null : null;

  useEffect(() => {
    if (!current) return;
    if (!rows[current.id]) {
      api<StoredRow[]>(`hires/${current.id}/rows`).then((list) =>
        setRows((all) => ({ ...all, [current.id]: mergeRows(list, all[current.id]) }))
      );
    }
    if (current.hasBrowser && !screens[current.id]) {
      api<Screen | null>(`hires/${current.id}/screen`).then((s) => s && setScreens((all) => ({ ...all, [current.id]: s })));
    }
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error === "auth") {
    return (
      <main className="center-page">
        <h1>Open dude from your terminal</h1>
        <p>
          This page needs the link that <code>dudee ui</code> prints. It carries a one-time key for this browser.
        </p>
      </main>
    );
  }
  if (!state) {
    return <main className="center-page">{error ? <p>Can't reach dude: {error}</p> : <p className="muted">Loading your team…</p>}</main>;
  }

  const onHired = (h: HireView) => {
    refresh();
    go({ kind: "employee", id: h.id });
  };

  if (!hires.length) return <FirstRun state={state} refresh={refresh} onHired={onHired} />;

  let main;
  if (view.kind === "employee" && current) {
    main = (
      <div className={`employee${showDetails ? "" : " no-panel"}`}>
        <Chat
          state={state}
          hire={current}
          rows={rows[current.id] ?? []}
          approvals={state.approvals.filter((a) => a.hireId === current.id)}
          questions={state.questions.filter((q) => q.hireId === current.id)}
          panelToggle={
            <button className="icon-btn" onClick={() => setShowDetails(!showDetails)} aria-pressed={showDetails} aria-label={showDetails ? "Hide panel" : "Show panel"}>
              {showDetails ? <PanelRightClose size={18} aria-hidden /> : <PanelRightOpen size={18} aria-hidden />}
            </button>
          }
        />
        {showDetails && (
          <Details
            key={`${current.id}-${panelTab ?? ""}`}
            hire={current}
            pack={state.packs.find((p) => p.id === current.packId)}
            screen={screens[current.id] ?? null}
            version={version}
            initialTab={panelTab}
            onClose={() => setShowDetails(false)}
            onFired={() => {
              go({ kind: "board" });
              refresh();
            }}
          />
        )}
      </div>
    );
  } else if (view.kind === "hire") {
    main = (
      <div className="page">
        <header className="page-head">
          <div>
            <h1>Hire an employee</h1>
            <p className="page-meta">Each employee gets a role, skills, memory, their own files and a badge on your board.</p>
          </div>
        </header>
        <HirePicker
          packs={state.packs}
          taken={hires.map((h) => h.name)}
          nextNo={hires.length + 1}
          onHired={onHired}
          onCancel={() => go({ kind: "board" })}
        />
      </div>
    );
  } else if (view.kind === "settings") {
    main = <SettingsPage onChanged={refresh} />;
  } else {
    main = <Board state={state} version={version} onOpen={(id, tab) => go({ kind: "employee", id }, tab)} onHire={() => go({ kind: "hire" })} />;
  }

  return (
    <div className="app">
      <Sidebar state={state} view={current || view.kind !== "employee" ? view : { kind: "board" }} go={(v) => go(v)} connected={connected} />
      <main className="main">
        {state.demo && <DemoBanner />}
        {main}
      </main>
    </div>
  );
}

/** First run: connect a model, then issue the first badge. */
function FirstRun({ state, refresh, onHired }: { state: AppState; refresh: () => void; onHired: (h: HireView) => void }) {
  const step = state.modelReady ? 2 : 1;
  return (
    <main className="first-run">
      {state.demo && <DemoBanner />}
      <header className="first-head">
        <span className="logo dark">dude</span>
        <ol className="steps-nav" aria-label="Setup steps">
          <li className={step === 1 ? "on" : "done"} aria-current={step === 1 ? "step" : undefined}>
            {step > 1 ? <Check size={14} aria-hidden /> : <span>1</span>} Connect a model
          </li>
          <li className={step === 2 ? "on" : ""} aria-current={step === 2 ? "step" : undefined}>
            <span>2</span> Hire your first employee
          </li>
        </ol>
      </header>
      {step === 1 ? (
        <section className="first-body" aria-labelledby="fr-title">
          <h1 id="fr-title">Connect a model</h1>
          <p className="lede">
            Your employees think with a model you already pay for: Claude, GPT and Codex, Gemini, Groq, OpenRouter, DeepSeek,
            Kimi, GLM, Qwen, or one running on this computer with Ollama. Keys stay here.
          </p>
          <ModelsPanel compact onDefaultChanged={refresh} />
          <p className="fallback">
            Someone already set up a key on this computer?{" "}
            <button className="btn small" onClick={refresh}>
              <RefreshCw size={14} aria-hidden /> Check again
            </button>
          </p>
        </section>
      ) : (
        <section className="first-body wide" aria-labelledby="fr-title">
          <h1 id="fr-title">Hire your first employee</h1>
          <p className="lede">
            Pick a role and issue their badge. They use the model you just connected and ask before anything that sends, posts,
            schedules or calls.
          </p>
          <HirePicker packs={state.packs} taken={[]} nextNo={1} onHired={onHired} />
        </section>
      )}
    </main>
  );
}

/** Shown on every screen of the demo server, which never calls a real model. */
function DemoBanner() {
  return (
    <p className="demo-banner" role="status">
      <strong>Demo mode.</strong> Replies are scripted and no model is called, even if you connect one. To work with your own
      model, run <code>dudee ui</code> (or <code>pnpm dude ui</code> in the repo).
    </p>
  );
}

function mergeRows(loaded: StoredRow[], streamed: StoredRow[] = []) {
  const seen = new Set(loaded.map((r) => r.seq));
  return [...loaded, ...streamed.filter((r) => !seen.has(r.seq))].sort((a, b) => a.seq - b.seq);
}
