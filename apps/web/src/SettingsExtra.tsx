import { useEffect, useState } from "react";
import { Download, Upload } from "lucide-react";
import { api, token } from "./api";

/** Company goals: every employee sees them and ties their work to one. */
export function GoalsSettings({ onChanged }: { onChanged: () => void }) {
  const [text, setText] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    api<{ goals: string[] }>("settings")
      .then((s) => setText(s.goals.join("\n")))
      .catch(() => setText(""));
  }, []);
  if (text === null) return null;
  return (
    <section aria-labelledby="goals-h">
      <h2 id="goals-h" className="section-h">
        Company goals
      </h2>
      <div className="panel">
        <p className="note">One per line. Every employee sees these and says which goal their work serves.</p>
        <textarea
          className="goals"
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"Grow course sign-ups 20% this quarter\nPublish two posts a week"}
          aria-label="Company goals, one per line"
        />
        <div className="row-actions">
          <button
            className="btn primary"
            onClick={async () => {
              try {
                await api("config", { method: "PATCH", body: { goals: text.split("\n") } });
                setMsg("Goals saved");
                onChanged();
              } catch (e) {
                setMsg((e as Error).message);
              }
            }}
          >
            Save goals
          </button>
          {msg && <span className="note">{msg}</span>}
        </div>
      </div>
    </section>
  );
}

interface PriceRow {
  model: string;
  price: { in: number; out: number } | null;
  custom: boolean;
}

/** Team budget and the prices used to count spend. */
export function CostSettings({ onChanged }: { onChanged: () => void }) {
  const [budget, setBudget] = useState<string | null>(null);
  const [rows, setRows] = useState<PriceRow[]>([]);
  const [edit, setEdit] = useState<Record<string, { in: string; out: string }>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const load = () =>
    api<{ budgetUsd: number | null; prices: PriceRow[] }>("settings").then((s) => {
      setBudget(s.budgetUsd?.toString() ?? "");
      setRows(s.prices);
      setEdit(Object.fromEntries(s.prices.map((r) => [r.model, { in: r.price?.in.toString() ?? "", out: r.price?.out.toString() ?? "" }])));
    });
  useEffect(() => {
    load().catch(() => setBudget(""));
  }, []);
  if (budget === null) return null;
  const save = async (body: object, ok: string) => {
    try {
      await api("config", { method: "PATCH", body });
      setMsg(ok);
      await load();
      onChanged();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  return (
    <section aria-labelledby="costs-h">
      <h2 id="costs-h" className="section-h">
        Costs
      </h2>
      <div className="panel">
        <label className="field" htmlFor="team-budget">
          <span>Monthly budget for the whole team, in US dollars</span>
        </label>
        <div className="row">
          <input id="team-budget" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="No limit" />
          <button className="btn" onClick={() => save({ budgetUsd: budget.trim() || null }, budget.trim() ? "Team budget saved" : "Limit removed")}>
            Save
          </button>
        </div>
        <p className="note">
          When the team reaches it, nobody starts new work until you raise it. Each employee can also have their own budget, in their
          About tab.
        </p>

        <h3 className="sub-h">Model prices</h3>
        <p className="note">
          Dollars per million tokens. Claude prices are built in and local models are free; add the rest from your provider's price page.
        </p>
        <div className="table-wrap">
          <table className="prices">
            <thead>
              <tr>
                <th scope="col">Model</th>
                <th scope="col">Input</th>
                <th scope="col">Output</th>
                <th scope="col">
                  <span className="sr-only">Save</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.model}>
                  <td>
                    <code>{r.model}</code> {!r.price && <span className="pill">No price</span>}
                  </td>
                  <td>
                    <input
                      inputMode="decimal"
                      aria-label={`Input price for ${r.model}`}
                      value={edit[r.model]?.in ?? ""}
                      onChange={(e) => setEdit({ ...edit, [r.model]: { ...edit[r.model], in: e.target.value } })}
                    />
                  </td>
                  <td>
                    <input
                      inputMode="decimal"
                      aria-label={`Output price for ${r.model}`}
                      value={edit[r.model]?.out ?? ""}
                      onChange={(e) => setEdit({ ...edit, [r.model]: { ...edit[r.model], out: e.target.value } })}
                    />
                  </td>
                  <td>
                    <button
                      className="btn small"
                      onClick={() =>
                        save({ price: { model: r.model, in: edit[r.model]?.in, out: edit[r.model]?.out } }, `Price saved for ${r.model}`)
                      }
                    >
                      Save
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {msg && <p className="note">{msg}</p>}
      </div>
    </section>
  );
}

/** Share a team as a file, or bring one in. Keys are never included. */
export function TeamSettings({ onChanged }: { onChanged: () => void }) {
  const [memory, setMemory] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const exportUrl = `/api/team/export?token=${encodeURIComponent(token)}${memory ? "&memory=1" : ""}`;
  return (
    <section aria-labelledby="team-h">
      <h2 id="team-h" className="section-h">
        Share your team
      </h2>
      <div className="panel">
        <p className="note">
          A team file holds your employees with their roles, models, budgets, routines and allowed actions, plus goals and workspace
          skills. It never holds keys.
        </p>
        <label className="switch">
          <input type="checkbox" checked={memory} onChange={(e) => setMemory(e.target.checked)} />
          <span>Include what employees remember (can contain private company facts)</span>
        </label>
        <div className="row-actions">
          <a className="btn" href={exportUrl} download>
            <Download size={15} aria-hidden /> Download team file
          </a>
          <label className="btn">
            <Upload size={15} aria-hidden /> Import a team file
            <input
              type="file"
              accept="application/json,.json"
              className="sr-only"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                  const r = await api<{ hired: Array<{ name: string }>; skipped: Array<{ name: string; reason: string }>; skills: string[] }>(
                    "team/import",
                    { method: "POST", body: JSON.parse(await file.text()) }
                  );
                  setMsg(
                    `Hired ${r.hired.map((h) => h.name).join(", ") || "nobody"}` +
                      (r.skills.length ? `; added skills ${r.skills.join(", ")}` : "") +
                      (r.skipped.length ? `; skipped ${r.skipped.map((s) => `${s.name} (${s.reason})`).join(", ")}` : "") +
                      "."
                  );
                  onChanged();
                } catch (err) {
                  setMsg((err as Error).message);
                }
                e.target.value = "";
              }}
            />
          </label>
        </div>
        {msg && <p className="note">{msg}</p>}
      </div>
    </section>
  );
}
