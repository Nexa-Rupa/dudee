import { useState } from "react";
import { ChevronDown, ChevronRight, PhoneCall, ShieldQuestion, MessageCircleQuestion } from "lucide-react";
import { api, type Approval, type HireView, type Question } from "./api";
import { plainSummary, roleStyle, timeOf } from "./ui";

/** An approval request: what the employee wants to do, in their words, with the decision buttons. */
export function ApprovalSlip({ a, hire, showWho = false }: { a: Approval; hire: HireView; showWho?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [details, setDetails] = useState(false);
  const isCall = a.tool === "phone_call";
  const decide = async (decision: "allow" | "always" | "deny") => {
    setBusy(true);
    try {
      await api(`approvals/${a.id}`, { method: "POST", body: { decision } });
    } catch {
      setBusy(false);
    }
  };
  return (
    <article className="slip needs" style={roleStyle(hire.packId)} aria-label={`${hire.name} needs your OK`}>
      <header className="slip-head">
        {isCall ? <PhoneCall size={15} aria-hidden /> : <ShieldQuestion size={15} aria-hidden />}
        <span className="slip-who">{showWho ? `${hire.name} · ${hire.title}` : "Needs your OK"}</span>
        <time className="slip-time">{timeOf(a.at)}</time>
      </header>
      <p className="slip-title">
        {showWho ? "Wants to " : `${hire.name} wants to `}
        {plainSummary(a.summary)}
      </p>
      <button className="disclose" onClick={() => setDetails(!details)} aria-expanded={details}>
        {details ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
        Exact request
      </button>
      {details && <pre className="code-block">{JSON.stringify(a.input, null, 2)}</pre>}
      <div className="slip-actions">
        <button className="btn primary" disabled={busy} onClick={() => decide("allow")}>
          Allow
        </button>
        {!isCall && (
          <button className="btn" disabled={busy} onClick={() => decide("always")}>
            Always allow
          </button>
        )}
        <button className="btn quiet apart" disabled={busy} onClick={() => decide("deny")}>
          Don't allow
        </button>
      </div>
      {isCall && <p className="slip-note">Calls are approved one at a time.</p>}
    </article>
  );
}

/** A question from an employee, answered in place. */
export function QuestionSlip({ q, hire, showWho = false }: { q: Question; hire: HireView; showWho?: boolean }) {
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (value: string | null) => {
    setBusy(true);
    try {
      await api(`questions/${q.id}`, { method: "POST", body: { answer: value } });
    } catch {
      setBusy(false);
    }
  };
  return (
    <form
      className="slip question"
      style={roleStyle(hire.packId)}
      onSubmit={(e) => {
        e.preventDefault();
        if (answer.trim()) submit(answer.trim());
      }}
    >
      <header className="slip-head">
        <MessageCircleQuestion size={15} aria-hidden />
        <span className="slip-who">{showWho ? `${hire.name} asks` : `${hire.name} asks`}</span>
        <time className="slip-time">{timeOf(q.at)}</time>
      </header>
      <p className="slip-title">{q.question}</p>
      <textarea value={answer} onChange={(e) => setAnswer(e.target.value)} rows={2} placeholder="Your answer" aria-label="Your answer" />
      <div className="slip-actions">
        <button className="btn primary" disabled={busy || !answer.trim()}>
          Answer
        </button>
        <button type="button" className="btn quiet apart" disabled={busy} onClick={() => submit(null)}>
          Let {hire.name} decide
        </button>
      </div>
    </form>
  );
}
