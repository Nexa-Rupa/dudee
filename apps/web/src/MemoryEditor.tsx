import { useEffect, useState } from "react";
import { Pencil } from "lucide-react";
import { api } from "./api";

/** Notes an employee (or the whole team) keeps, readable and editable. */
export function MemoryEditor(props: { path: string; version: number; empty: string; label: string }) {
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<{ value: string; base: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setDraft(null);
    setError(null);
  }, [props.path]);
  useEffect(() => {
    api<{ text: string }>(props.path).then((m) => setText(m.text)).catch(() => setText(""));
  }, [props.path, props.version]);

  if (draft) {
    return (
      <form
        className="memory-edit"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            const saved = await api<{ text: string }>(props.path, { method: "PUT", body: { text: draft.value, base: draft.base } });
            setText(saved.text);
            setDraft(null);
            setError(null);
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        <textarea className="goals" rows={12} value={draft.value} onChange={(e) => setDraft({ ...draft, value: e.target.value })} aria-label={props.label} autoFocus />
        <p className="note">One fact per line, starting with “- ”.</p>
        {error && <p className="error">{error}</p>}
        <div className="row-actions">
          <button className="btn primary">Save notes</button>
          <button type="button" className="btn quiet" onClick={() => setDraft(null)}>
            Cancel
          </button>
        </div>
      </form>
    );
  }

  const entries = text
    .split("\n")
    .filter((l) => l.startsWith("- "))
    .map((l) => l.slice(2));
  return (
    <div className="memory-view">
      {entries.length ? (
        <ul className="memory">
          {entries.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      ) : (
        <p className="empty">{props.empty}</p>
      )}
      <button className="btn small" onClick={() => setDraft({ value: text || "# Memory\n\n- ", base: text })}>
        <Pencil size={13} aria-hidden /> {entries.length ? "Edit notes" : "Add notes"}
      </button>
    </div>
  );
}
