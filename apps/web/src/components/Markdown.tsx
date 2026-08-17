// Minimal markdown renderer for digests and simple notes — headings, bullets,
// checkboxes (read-only), bold. React elements, never innerHTML.
import { Fragment } from "react";

function inline(text: string) {
  return text.split(/\*\*([^*]+)\*\*/g).map((part, i) =>
    i % 2 ? <b key={i} className="text-[var(--bright)]">{part}</b> : <Fragment key={i}>{part}</Fragment>,
  );
}

export function Markdown({ md }: { md: string }) {
  return (
    <div className="max-w-[760px] font-sans text-[13.5px] leading-relaxed text-[var(--text)]">
      {md.split("\n").map((line, i) => {
        if (line.trim() === "") return null;
        const h1 = line.match(/^# (.+)$/);
        if (h1) return <h1 key={i} className="mb-3 mt-2 text-xl text-[var(--bright)]">{h1[1]}</h1>;
        const h2 = line.match(/^## (.+)$/);
        if (h2)
          return (
            <h2 key={i} className="mb-2 mt-5 text-[11px] uppercase tracking-[1.5px] text-[var(--cyan)]">
              {h2[1]}
            </h2>
          );
        const box = line.match(/^\s*(?:\d+\.\s*)?- \[( |x)\] (.*)$/);
        if (box)
          return (
            <div key={i} className="ml-2 mb-1 flex gap-2">
              <span className="text-[var(--cyan)]">{box[1] === "x" ? "☑" : "☐"}</span>
              <span className={box[1] === "x" ? "text-[var(--dim)] line-through" : ""}>{inline(box[2])}</span>
            </div>
          );
        const li = line.match(/^\s*(?:[-*]|\d+\.)\s+(.*)$/);
        if (li) return <li key={i} className="ml-5 mb-1">{inline(li[1])}</li>;
        return <p key={i} className="mb-2">{inline(line)}</p>;
      })}
    </div>
  );
}
