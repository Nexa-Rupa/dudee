import type { ReactNode } from "react";

/** Small, safe Markdown: paragraphs, headings, lists, code, bold, italics, links. React escapes all text. */
export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("```")) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) code.push(lines[i++]);
      i++;
      blocks.push(<pre key={key++}><code>{code.join("\n")}</code></pre>);
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      blocks.push(<p key={key++} className="md-h">{inline(heading[2])}</p>);
      i++;
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*]|\d+\.)\s+/, ""));
      const children = items.map((it, n) => <li key={n}>{inline(it)}</li>);
      blocks.push(ordered ? <ol key={key++}>{children}</ol> : <ul key={key++}>{children}</ul>);
      continue;
    }
    if (/^\|.*\|\s*$/.test(line)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) {
        const cells = lines[i++].trim().slice(1, -1).split("|").map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
      }
      blocks.push(
        <div key={key++} className="md-table">
          <table>
            <tbody>
              {rows.map((r, n) => (
                <tr key={n}>{r.map((c, m) => (n === 0 ? <th key={m}>{inline(c)}</th> : <td key={m}>{inline(c)}</td>))}</tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(```|#{1,4}\s|\s*([-*]|\d+\.)\s+|\|)/.test(lines[i])) para.push(lines[i++]);
    if (!para.length) para.push(lines[i++]);
    blocks.push(<p key={key++}>{inline(para.join("\n"))}</p>);
  }
  return <div className="md">{blocks}</div>;
}

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\((https?:\/\/[^)\s]+)\)|https?:\/\/[^\s)]+|\*[^*\s][^*]*\*)/g;
  let last = 0;
  let k = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith("`")) out.push(<code key={k++}>{t.slice(1, -1)}</code>);
    else if (t.startsWith("**")) out.push(<strong key={k++}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith("[")) {
      const label = t.slice(1, t.indexOf("]("));
      out.push(<a key={k++} href={m[2]} target="_blank" rel="noreferrer">{label}</a>);
    } else if (t.startsWith("http")) out.push(<a key={k++} href={t} target="_blank" rel="noreferrer">{t}</a>);
    else out.push(<em key={k++}>{t.slice(1, -1)}</em>);
    last = m.index! + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
