import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUp, Check, ChevronDown, ChevronRight, CircleAlert, FileText, LoaderCircle, Hourglass, Paperclip, Square, X } from "lucide-react";
import { api, fileKind, fileUrl, upload, type AppState, type Approval, type HireView, type Question, type SkillView, type StoredRow } from "./api";
import { Markdown } from "./markdown";
import { ApprovalSlip, QuestionSlip } from "./Slips";
import { Avatar, STATUS_LABEL, StatusMark, duration, empNo, plainSummary, roleStyle, statusOf, stepHint, stepLabel, timeOf, useTick } from "./ui";

interface Turn {
  key: number;
  ask?: StoredRow;
  steps: StoredRow[];
  reply?: StoredRow;
}

/** Group the transcript into turns: the request, the steps taken, the reply. */
function toTurns(rows: StoredRow[]): Turn[] {
  const turns: Turn[] = [];
  let cur: Turn | null = null;
  for (const r of rows) {
    if (r.row.kind === "message" && r.row.added && cur) {
      cur.steps.push(r);
    } else if (r.row.kind === "message" && r.row.role === "user") {
      cur = { key: r.seq, ask: r, steps: [] };
      turns.push(cur);
    } else if (r.row.kind === "message") {
      if (!cur || cur.reply) {
        cur = { key: r.seq, steps: [] };
        turns.push(cur);
      }
      cur.reply = r;
      cur = null;
    } else {
      if (!cur) {
        cur = { key: r.seq, steps: [] };
        turns.push(cur);
      }
      cur.steps.push(r);
    }
  }
  return turns;
}

export function Chat(props: {
  state: AppState;
  hire: HireView;
  rows: StoredRow[];
  approvals: Approval[];
  questions: Question[];
  panelToggle: ReactNode;
}) {
  const { hire, rows } = props;
  const turns = toTurns(rows);
  const live = hire.live;
  const status = statusOf(props.state, hire);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  });

  const lastOpen = turns.length && !turns[turns.length - 1].reply ? turns[turns.length - 1] : null;
  const waiting = props.approvals.length + props.questions.length > 0;

  return (
    <section
      className={`chat${Date.now() - Date.parse(hire.createdAt) < 10_000 && !turns.length ? " issued" : ""}`}
      aria-label={`Work with ${hire.name}`}
      style={roleStyle(hire.packId)}
    >
      <header className="chat-head">
        <span className="chat-band" aria-hidden />
        <Avatar name={hire.name} packId={hire.packId} size={38} />
        <div className="chat-id">
          <h1>{hire.name}</h1>
          <p>
            {hire.title} · <span className="num">{empNo(props.state, hire.id)}</span>
          </p>
        </div>
        <span className={`chat-status ${status}`}>
          <StatusMark status={status} />
          {STATUS_LABEL[status]}
        </span>
        {props.panelToggle}
      </header>

      <div
        className="chat-scroll"
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        <div className="chat-inner">
          {!turns.length && !live && <Intro hire={hire} />}
          {turns.map((t) => (
            <TurnView key={t.key} turn={t} hire={hire} live={t === lastOpen ? live : null} waiting={waiting} />
          ))}
          {live && !lastOpen && <TurnView turn={{ key: -1, steps: [] }} hire={hire} live={live} waiting={waiting} />}
          {props.questions.map((q) => (
            <QuestionSlip key={q.id} q={q} hire={hire} />
          ))}
          {props.approvals.map((a) => (
            <ApprovalSlip key={a.id} a={a} hire={hire} />
          ))}
        </div>
      </div>

      <Composer key={hire.id} hire={hire} busy={!!live} />
    </section>
  );
}

function Intro({ hire }: { hire: HireView }) {
  return (
    <div className="intro">
      <h2>Give {hire.name} a first task</h2>
      <p>
        Brief {hire.name} the way you would brief a new {hire.title.toLowerCase()}. You will see every step, and anything that
        sends, posts, schedules or calls waits for your OK. Type <kbd>/</kbd> to run one of their skills.
      </p>
    </div>
  );
}

function TurnView({ turn, hire, live, waiting }: { turn: Turn; hire: HireView; live: HireView["live"]; waiting: boolean }) {
  const [open, setOpen] = useState(false);
  useTick(!!live);
  const tools = turn.steps.filter((s) => s.row.kind === "tool");
  const started = turn.ask?.at ?? live?.since;
  const ended = turn.reply?.at;
  const spent = started ? (ended ? Date.parse(ended) : Date.now()) - Date.parse(started) : 0;
  const longest = Math.max(1, ...tools.map((s) => (s.row.kind === "tool" ? s.row.ms : 0)));
  const failed = tools.some((s) => s.row.kind === "tool" && s.row.error);

  return (
    <div className="turn">
      {turn.ask && turn.ask.row.kind === "message" && (
        <div className="msg user">
          <p className="msg-meta">
            {turn.ask.row.from ? fromLabel(turn.ask.row.from) : "You"} · <time>{timeOf(turn.ask.at)}</time>
          </p>
          <div className="bubble">
            <Markdown text={turn.ask.row.text} />
          </div>
          {!!turn.ask.row.attachments?.length && <Attachments hireId={hire.id} paths={turn.ask.row.attachments} />}
        </div>
      )}

      {turn.steps.map(
        (s) =>
          s.row.kind === "message" && (
            <div className="msg user" key={s.seq}>
              <p className="msg-meta">
                You, while they worked · <time>{timeOf(s.at)}</time>
              </p>
              <div className="bubble">
                <Markdown text={s.row.text} />
              </div>
            </div>
          )
      )}
      {live?.pending?.map((text, i) => (
        <div className="msg user pending" key={`p${i}`}>
          <p className="msg-meta">{hire.name} reads this at the next step</p>
          <div className="bubble">
            <Markdown text={text} />
          </div>
        </div>
      ))}

      {(turn.steps.length > 0 || live) && (
        <div className={`work${live ? (waiting ? " waiting" : " live") : ""}`}>
          <button className="work-chip" onClick={() => setOpen(!open)} aria-expanded={open}>
            {live ? (
              waiting ? (
                <Hourglass size={15} aria-hidden />
              ) : (
                <LoaderCircle size={15} className="spin" aria-hidden />
              )
            ) : failed ? (
              <CircleAlert size={15} aria-hidden />
            ) : (
              <Check size={15} aria-hidden />
            )}
            <span>
              {live ? (waiting ? "Waiting for you" : "Working") : "Worked"} for <span className="num">{duration(spent)}</span>
              {tools.length > 0 && ` · ${tools.length} step${tools.length === 1 ? "" : "s"}`}
              {live && !waiting && live.detail && <span className="work-now"> · {stepLabel(live.detail).toLowerCase()}</span>}
            </span>
            {open ? <ChevronDown size={15} aria-hidden /> : <ChevronRight size={15} aria-hidden />}
          </button>
          {open && (
            <ol className="steps">
              {turn.steps.map((s) => (
                <Step key={s.seq} row={s} longest={longest} />
              ))}
            </ol>
          )}
        </div>
      )}

      {live && live.text && (
        <div className="msg bot">
          <p className="msg-meta">{hire.name}</p>
          <div className="reply streaming">
            <Markdown text={live.text} />
          </div>
        </div>
      )}

      {turn.reply && turn.reply.row.kind === "message" && (
        <div className="msg bot">
          <p className="msg-meta">
            {hire.name} · <time>{timeOf(turn.reply.at)}</time>
          </p>
          <div className="reply">
            <Markdown text={turn.reply.row.text || "(no reply)"} />
          </div>
        </div>
      )}
    </div>
  );
}

/** Files sent with a message: pictures as thumbnails, the rest by name. */
function Attachments({ hireId, paths }: { hireId: string; paths: string[] }) {
  return (
    <ul className="attached">
      {paths.map((p) => (
        <li key={p}>
          <a href={fileUrl(hireId, p)} target="_blank" rel="noreferrer">
            {fileKind(p) === "image" ? (
              <img src={fileUrl(hireId, p)} alt={fileName(p)} loading="lazy" />
            ) : (
              <span className="attached-file">
                <FileText size={14} aria-hidden /> {fileName(p)}
              </span>
            )}
          </a>
        </li>
      ))}
    </ul>
  );
}

function fileName(path: string) {
  return path.split("/").pop() ?? path;
}

function fromLabel(from: string) {
  return from.startsWith("routine:") ? `Routine · ${from.slice(8)}` : from;
}

/** One step; its bar's length is its share of the turn's longest step. */
function Step({ row, longest }: { row: StoredRow; longest: number }) {
  const [open, setOpen] = useState(false);
  const r = row.row;
  if (r.kind === "approval") {
    const word = r.expired ? "Nobody answered" : r.decision === "deny" ? "You declined" : r.decision === "always" ? "You always allowed" : "You allowed";
    return (
      <li className={`step decision ${r.decision}`}>
        {word}: {plainSummary(r.summary)}
      </li>
    );
  }
  if (r.kind === "notice") return <li className="step notice">{r.text}</li>;
  if (r.kind !== "tool") return null;
  const hint = stepHint(r.input);
  return (
    <li className={`step${r.error ? " failed" : ""}`}>
      <button className="step-line" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="step-name">{stepLabel(r.tool)}</span>
        <span className="step-hint">{hint}</span>
        <span className="step-bar" aria-hidden>
          <span style={{ width: `${Math.max(4, (r.ms / longest) * 100)}%` }} />
        </span>
        <span className="step-ms">{r.error ? "failed" : duration(r.ms)}</span>
      </button>
      {open && (
        <pre className="code-block">{JSON.stringify({ input: r.input, [r.error ? "error" : "output"]: r.error ?? r.output }, null, 2)}</pre>
      )}
    </li>
  );
}

function Composer({ hire, busy }: { hire: HireView; busy: boolean }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [skills, setSkills] = useState<SkillView[]>([]);
  const [active, setActive] = useState(0);
  const [files, setFiles] = useState<string[]>([]);
  const [uploading, setUploading] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [stopping, setStopping] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!busy) setStopping(false);
  }, [busy]);

  const attach = async (list: File[]) => {
    setError(null);
    for (const file of list.slice(0, 10)) {
      setUploading((n) => n + 1);
      try {
        const path = await upload(hire.id, file);
        setFiles((all) => [...all, path].slice(0, 10));
      } catch (e) {
        setError(`${file.name}: ${(e as Error).message}`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
  };

  useEffect(() => {
    ref.current?.focus();
    api<SkillView[]>(`hires/${hire.id}/skills`).then(setSkills).catch(() => setSkills([]));
  }, [hire.id]);

  // "/" at the start opens the skill menu, like slash commands in Claude Code.
  const slash = text.match(/^\/([\w:.-]*)$/);
  const matches = slash
    ? skills
        .filter((s) => s.userInvocable && s.name.toLowerCase().includes(slash[1].toLowerCase()))
        .sort((a, b) => Number(b.name.startsWith(slash[1])) - Number(a.name.startsWith(slash[1])) || (a.source === "pack" ? -1 : 1))
        .slice(0, 8)
    : [];
  const pick = (s: SkillView) => {
    setText(`/${s.name} `);
    setActive(0);
    ref.current?.focus();
  };

  const send = async () => {
    const value = text.trim();
    const sent = files;
    if ((!value && !sent.length) || uploading) return;
    setText("");
    setFiles([]);
    setError(null);
    try {
      await api(`hires/${hire.id}/messages`, { method: "POST", body: { text: value, attachments: sent } });
    } catch (e) {
      setText(value);
      setFiles(sent);
      setError((e as Error).message);
    }
  };

  const stop = async () => {
    setStopping(true);
    try {
      await api(`hires/${hire.id}/stop`, { method: "POST" });
    } catch (e) {
      setStopping(false);
      setError((e as Error).message);
    }
  };

  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      {error && <p className="error">{error}</p>}
      {hire.paused && (
        <p className="paused-note">
          {hire.budgetUsd !== null && hire.spend.usd >= hire.budgetUsd
            ? `${hire.name} reached the $${hire.budgetUsd} monthly budget and is paused.`
            : `${hire.name} is paused and won't take work or run routines.`}{" "}
          <button
            type="button"
            className="btn small"
            onClick={() => api(`hires/${hire.id}`, { method: "PATCH", body: { paused: false } }).catch((e) => setError((e as Error).message))}
          >
            Resume {hire.name}
          </button>
        </p>
      )}
      {!hire.modelReady && (
        <p className="error">
          {hire.name}'s model ({hire.model}) has no key yet. Connect the provider in Settings.
        </p>
      )}
      {(files.length > 0 || uploading > 0) && (
        <ul className="to-send" aria-label="Attached files">
          {files.map((f) => (
            <li key={f}>
              {fileKind(f) === "image" ? <img src={fileUrl(hire.id, f)} alt="" /> : <FileText size={14} aria-hidden />}
              <span>{fileName(f)}</span>
              <button type="button" onClick={() => setFiles(files.filter((x) => x !== f))} aria-label={`Remove ${fileName(f)}`}>
                <X size={13} aria-hidden />
              </button>
            </li>
          ))}
          {uploading > 0 && (
            <li>
              <LoaderCircle size={14} className="spin" aria-hidden /> <span>Uploading…</span>
            </li>
          )}
        </ul>
      )}
      <div
        className={`composer-box${dragging ? " dragging" : ""}`}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          if (!e.dataTransfer.files.length) return;
          e.preventDefault();
          setDragging(false);
          attach([...e.dataTransfer.files]);
        }}
      >
        <input
          ref={picker}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            attach([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
        <button type="button" className="attach" onClick={() => picker.current?.click()} aria-label="Attach files" title="Attach files">
          <Paperclip size={18} aria-hidden />
        </button>
        {matches.length > 0 && (
          <ul className="slash-menu" role="listbox" aria-label="Skills">
            {matches.map((s, i) => (
              <li key={s.name} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  className={i === active ? "active" : ""}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(s);
                  }}
                >
                  <span className="slash-name">/{s.name}</span>
                  {s.argumentHint && <span className="slash-hint">{s.argumentHint}</span>}
                  <span className="slash-desc">{s.description}</span>
                  {s.source !== "pack" && <span className="tag">{s.source}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
        <textarea
          ref={ref}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setActive(0);
          }}
          onPaste={(e) => {
            const pasted = [...e.clipboardData.files];
            if (!pasted.length) return;
            e.preventDefault();
            attach(pasted);
          }}
          onKeyDown={(e) => {
            if (matches.length) {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => (a + 1) % matches.length);
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => (a - 1 + matches.length) % matches.length);
                return;
              }
              if (e.key === "Tab" || e.key === "Enter") {
                e.preventDefault();
                pick(matches[Math.min(active, matches.length - 1)]);
                return;
              }
              if (e.key === "Escape") {
                setText("");
                return;
              }
            }
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          rows={1}
          placeholder={busy ? `Add something while ${hire.name} works` : `Brief ${hire.name}, or type / for a skill`}
          aria-label={`Message ${hire.name}`}
        />
        {busy && (
          <button type="button" className="stop" onClick={stop} disabled={stopping} aria-label={`Stop ${hire.name}`} title={`Stop ${hire.name}`}>
            <Square size={14} fill="currentColor" aria-hidden />
          </button>
        )}
        <button className="send" disabled={(!text.trim() && !files.length) || uploading > 0} aria-label="Send">
          <ArrowUp size={18} aria-hidden />
        </button>
      </div>
    </form>
  );
}
