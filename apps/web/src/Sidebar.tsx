import { Inbox, LayoutGrid, Settings as SettingsIcon, UserPlus, Plug } from "lucide-react";
import type { AppState } from "./api";
import { STATUS_LABEL, StatusMark, roleStyle, statusOf } from "./ui";

export type View = { kind: "board" } | { kind: "employee"; id: string } | { kind: "hire" } | { kind: "settings" };

export function Sidebar(props: { state: AppState; view: View; go: (v: View) => void; connected: boolean }) {
  const { state, view } = props;
  const needs = state.approvals.length + state.questions.length;
  return (
    <nav className="rail" aria-label="Main">
      <div className="logo">
        dude
        <span className={`conn${props.connected ? "" : " off"}`} title={props.connected ? "Connected" : "Reconnecting…"} />
      </div>

      <ul className="rail-nav">
        <li>
          <button aria-current={view.kind === "board"} onClick={() => props.go({ kind: "board" })}>
            <LayoutGrid size={17} aria-hidden /> Team board
          </button>
        </li>
        <li>
          <button
            onClick={() => {
              props.go({ kind: "board" });
              requestAnimationFrame(() =>
                requestAnimationFrame(() => document.getElementById("needs-title")?.scrollIntoView({ behavior: "smooth", block: "start" }))
              );
            }}
          >
            <Inbox size={17} aria-hidden /> Needs you
            {needs > 0 ? (
              <span className="count" aria-label={`${needs} waiting`}>
                {needs}
              </span>
            ) : (
              <span className="rail-zero">0</span>
            )}
          </button>
        </li>
        <li>
          <button aria-current={view.kind === "settings"} onClick={() => props.go({ kind: "settings" })}>
            <SettingsIcon size={17} aria-hidden /> Settings
          </button>
        </li>
      </ul>

      {!state.modelReady && (
        <button className="rail-warn" onClick={() => props.go({ kind: "settings" })}>
          <Plug size={16} aria-hidden /> Connect a model to start
        </button>
      )}

      <p className="rail-label">Employees</p>
      <ul className="roster">
        {state.hires.map((h) => {
          const status = statusOf(state, h);
          return (
            <li key={h.id}>
              <button
                aria-current={view.kind === "employee" && view.id === h.id}
                onClick={() => props.go({ kind: "employee", id: h.id })}
                style={roleStyle(h.packId)}
              >
                <span className="swatch" aria-hidden />
                <span className="roster-text">
                  <span className="roster-name">{h.name}</span>
                  <span className="roster-role">{status === "idle" ? h.title : STATUS_LABEL[status]}</span>
                </span>
                <StatusMark status={status} />
              </button>
            </li>
          );
        })}
      </ul>

      <button className="rail-hire" aria-current={view.kind === "hire"} onClick={() => props.go({ kind: "hire" })}>
        <UserPlus size={16} aria-hidden /> Hire an employee
      </button>
      <p className="rail-model" title="Default model">
        {state.model}
      </p>
    </nav>
  );
}
