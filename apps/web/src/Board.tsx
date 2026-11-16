import { useEffect, useState } from "react";
import { FileText, UserPlus } from "lucide-react";
import { api, type AppState, type HireView, type StoredRow } from "./api";
import { ApprovalSlip, QuestionSlip } from "./Slips";
import { Avatar, deliverableNo, duration, empNo, plainSummary, roleLine, roleStyle, statusOf, stepLabel, timeOf, usd, useTick, type Status } from "./ui";

interface FileRow {
  path: string;
  size: number;
  modified: string;
}

interface Activity {
  last: string | null;
  lastAt: string | null;
  files: FileRow[];
}

/** Every file across the team, numbered in the order it was first saved. */
export function useDeliverables(state: AppState, version: number) {
  const [activity, setActivity] = useState<Record<string, Activity>>({});
  useEffect(() => {
    let alive = true;
    Promise.all(
      state.hires.map(async (h) => {
        const [rows, files] = await Promise.all([
          api<StoredRow[]>(`hires/${h.id}/rows?limit=20`).catch(() => [] as StoredRow[]),
          api<FileRow[]>(`hires/${h.id}/files`).catch(() => [] as FileRow[]),
        ]);
        const reply = [...rows].reverse().find((r) => r.row.kind === "message" && r.row.role === "assistant");
        return [
          h.id,
          {
            last: reply && reply.row.kind === "message" ? reply.row.text.split("\n").find((l) => l.trim()) ?? null : null,
            lastAt: reply?.at ?? null,
            files,
          },
        ] as const;
      })
    ).then((list) => alive && setActivity(Object.fromEntries(list)));
    return () => {
      alive = false;
    };
  }, [state.hires.map((h) => h.id).join(","), version]); // eslint-disable-line react-hooks/exhaustive-deps

  const all = state.hires
    .flatMap((h) => (activity[h.id]?.files ?? []).map((f) => ({ ...f, hire: h })))
    .sort((a, b) => a.modified.localeCompare(b.modified))
    .map((f, i) => ({ ...f, no: deliverableNo(i + 1) }));
  return { activity, deliverables: all };
}

export function Board(props: {
  state: AppState;
  version: number;
  onOpen: (id: string, tab?: "files") => void;
  onHire: () => void;
}) {
  const { state } = props;
  const { activity, deliverables } = useDeliverables(state, props.version);
  const today = new Date().toDateString();
  const doneToday = deliverables.filter((d) => new Date(d.modified).toDateString() === today).reverse();
  const working = state.hires.filter((h) => statusOf(state, h) === "working").length;
  const needs = state.approvals.length + state.questions.length;
  const byId = (id: string) => state.hires.find((h) => h.id === id);

  return (
    <div className="board">
      <section className="board-main" aria-labelledby="board-title">
        <header className="page-head">
          <div>
            <h1 id="board-title">{state.company.name ? `${state.company.name} team` : "Your team"}</h1>
            <p className="page-meta">
              {state.hires.length} {state.hires.length === 1 ? "employee" : "employees"} · {working} working ·{" "}
              {needs ? <strong>{needs === 1 ? "1 needs you" : `${needs} need you`}</strong> : "nothing waiting on you"} ·{" "}
              <span className="num">
                {usd(state.spend.usd)}
                {state.budgetUsd !== null ? ` of ${usd(state.budgetUsd)}` : ""}
              </span>{" "}
              this month
            </p>
          </div>
          <button className="btn primary" onClick={props.onHire}>
            <UserPlus size={16} aria-hidden /> Hire an employee
          </button>
        </header>

        <ul className="badges">
          {state.hires.map((h) => (
            <li key={h.id}>
              <BadgeCard
                hire={h}
                no={empNo(state, h.id)}
                status={statusOf(state, h)}
                needsText={
                  state.approvals.find((a) => a.hireId === h.id)?.summary ??
                  state.questions.find((q) => q.hireId === h.id)?.question
                }
                activity={activity[h.id]}
                roleText={roleLine(state.packs.find((p) => p.id === h.packId)?.description ?? h.title)}
                onOpen={() => props.onOpen(h.id)}
              />
            </li>
          ))}
        </ul>
      </section>

      <aside className="board-side" aria-label="Needs you and done today">
        {needs > 0 && (
        <section className="needs-sec" aria-labelledby="needs-title">
          <h2 id="needs-title">
            Needs you <span className="count">{needs}</span>
          </h2>
          <div className="slips">
            {state.questions.map((q) => {
              const h = byId(q.hireId);
              return h ? <QuestionSlip key={q.id} q={q} hire={h} showWho /> : null;
            })}
            {state.approvals.map((a) => {
              const h = byId(a.hireId);
              return h ? <ApprovalSlip key={a.id} a={a} hire={h} showWho /> : null;
            })}
          </div>
        </section>
        )}

        <section className="done-sec" aria-labelledby="done-title">
          <h2 id="done-title">Done today</h2>
          {doneToday.length === 0 ? (
            <p className="empty">Drafts, reports and plans saved today show up here.</p>
          ) : (
            <ol className="ledger">
              {doneToday.slice(0, 12).map((d) => (
                <li key={`${d.hire.id}/${d.path}`}>
                  <button onClick={() => props.onOpen(d.hire.id, "files")} style={roleStyle(d.hire.packId)}>
                    <span className="ledger-no">{d.no}</span>
                    <span className="ledger-name">
                      <FileText size={14} aria-hidden />
                      {d.path}
                    </span>
                    <span className="ledger-who">{d.hire.name}</span>
                    <time className="ledger-time">{timeOf(d.modified)}</time>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </section>
      </aside>
    </div>
  );
}

function BadgeCard(props: {
  hire: HireView;
  no: string;
  status: Status;
  needsText?: string;
  activity?: Activity;
  roleText: string;
  onOpen: () => void;
}) {
  const { hire, status } = props;
  useTick(status === "working");
  const live = hire.live;
  let strip: string;
  let time = "";
  if (status === "needs") strip = props.needsText ? `Wants to ${plainSummary(props.needsText)}` : "Waiting on you";
  else if (status === "working" && live) {
    strip = live.detail ? stepLabel(live.detail) : "Thinking";
    time = duration(Date.now() - Date.parse(live.since));
  } else if (status === "paused") {
    const over = hire.budgetUsd !== null && hire.spend.usd >= hire.budgetUsd;
    strip = over ? `Paused: reached the ${usd(hire.budgetUsd!)} monthly budget` : "Paused. Open to resume.";
  } else strip = props.activity?.last ? `Last: ${props.activity.last}` : "Ready for a first task";

  return (
    <button className={`badge ${status}`} onClick={props.onOpen} style={roleStyle(hire.packId)} aria-label={`Open ${hire.name}, ${hire.title}`}>
      <span className="badge-band">
        <span>{hire.title}</span>
        <span className="badge-no">{props.no}</span>
      </span>
      <span className="badge-body">
        <Avatar name={hire.name} packId={hire.packId} size={52} />
        <span className="badge-id">
          <span className="badge-name">{hire.name}</span>
          <span className="badge-role">{props.roleText}</span>
        </span>
      </span>
      <span className={`strip ${status}`}>
        <span className="strip-text">{strip}</span>
        {status === "needs" ? <span className="strip-tag">Needs you</span> : time ? <span className="strip-time">{time}</span> : null}
      </span>
    </button>
  );
}
