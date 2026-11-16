import { useState } from "react";
import { Globe, Image as ImageIcon, PhoneCall, BadgeCheck } from "lucide-react";
import { api, type HireView, type PackView } from "./api";
import { Avatar, roleLine, roleStyle } from "./ui";

/** Hiring = issuing a badge: choose a role, name them, see the badge before you issue it. */
export function HirePicker(props: {
  packs: PackView[];
  taken: string[];
  nextNo: number;
  onHired: (h: HireView) => void;
  onCancel?: () => void;
}) {
  const [pack, setPack] = useState<PackView | null>(null);
  const [name, setName] = useState("");
  const [model, setModel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pick = (p: PackView) => {
    setPack(p);
    let n = p.defaultName;
    for (let i = 2; props.taken.some((t) => t.toLowerCase() === n.toLowerCase()); i++) n = `${p.defaultName} ${i}`;
    setName(n);
    setError(null);
    // On narrow screens the badge being issued sits below the roles; bring it into view.
    if (window.innerWidth <= 900) {
      requestAnimationFrame(() => document.querySelector(".issue")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  };

  const hire = async () => {
    if (!pack) return;
    setBusy(true);
    setError(null);
    try {
      const h = await api<HireView>("hires", {
        method: "POST",
        body: { packId: pack.id, name: name.trim() || undefined, model: model.trim() || undefined },
      });
      props.onHired(h);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const no = `EMP-${String(props.nextNo).padStart(3, "0")}`;

  return (
    <div className="hire">
      <fieldset className="roles">
        <legend>Choose a role</legend>
        {props.packs.map((p) => (
          <label key={p.id} className={`role${pack?.id === p.id ? " on" : ""}`} style={roleStyle(p.id)}>
            <input type="radio" name="role" checked={pack?.id === p.id} onChange={() => pick(p)} />
            <span className="role-band">{p.title}</span>
            <span className="role-body">
              <span className="role-desc">{p.description}</span>
              <span className="role-skills">
                {p.skills.map((s) => (
                  <span key={s.name}>/{s.name}</span>
                ))}
              </span>
              <span className="role-tools">
                {p.tools.includes("web") && (
                  <span>
                    <Globe size={13} aria-hidden /> Web research
                  </span>
                )}
                {p.tools.includes("browser") && (
                  <span>
                    <Globe size={13} aria-hidden /> Own browser
                  </span>
                )}
                {p.tools.includes("media") && (
                  <span>
                    <ImageIcon size={13} aria-hidden /> Images and video
                  </span>
                )}
                {p.tools.includes("phone") && (
                  <span>
                    <PhoneCall size={13} aria-hidden /> Phone calls
                  </span>
                )}
              </span>
            </span>
          </label>
        ))}
      </fieldset>

      <form
        className={`issue${pack ? "" : " idle"}`}
        onSubmit={(e) => {
          e.preventDefault();
          hire();
        }}
      >
        <div className="issue-preview" style={pack ? roleStyle(pack.id) : undefined} aria-hidden={!pack}>
          <span className="badge-band">
            <span>{pack?.title ?? "Pick a role"}</span>
            <span className="badge-no">{no}</span>
          </span>
          <span className="badge-body">
            {pack ? <Avatar name={name || "?"} packId={pack.id} size={64} /> : <span className="avatar blank" />}
            <span className="badge-id">
              <span className="badge-name">{name || "Name"}</span>
              <span className="badge-role">{pack ? roleLine(pack.description) : "Your next employee"}</span>
            </span>
          </span>
        </div>
        {pack ? (
          <>
            <label className="field">
              <span>Name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </label>
            <label className="field">
              <span>
                Model <span className="muted">(optional)</span>
              </span>
              <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="Same as the workspace" spellCheck={false} />
            </label>
            {!!pack.requires.env?.length && (
              <p className="note">
                {pack.requires.env.some((e) => e.startsWith("VAPI"))
                  ? `To place calls, ${name || "they"} need${name ? "s" : ""} a Vapi account. You can connect it in Settings after hiring.`
                  : "Some of their tools need an extra key. You can add it in Settings after hiring."}
              </p>
            )}
            {error && <p className="error">{error}</p>}
            <div className="row-actions">
              <button className="btn primary" disabled={busy || !name.trim()}>
                <BadgeCheck size={16} aria-hidden /> Issue badge to {name.trim() || "them"}
              </button>
              {props.onCancel && (
                <button type="button" className="btn quiet apart" onClick={props.onCancel}>
                  Cancel
                </button>
              )}
            </div>
          </>
        ) : (
          <p className="note">Choose a role on the left. You can rename them and pick their model before you issue the badge.</p>
        )}
      </form>
    </div>
  );
}
