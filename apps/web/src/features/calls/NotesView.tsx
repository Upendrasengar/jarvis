// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// Renders call-notes markdown as React elements (no innerHTML, no XSS
// surface) — and every text line is contentEditable in place. Because each
// rendered element corresponds to exactly one markdown source line, an edit
// maps back trivially: blur → rebuild that line with its original prefix
// (##, -, - [ ]) → parent saves the whole note (reports + vault together).
import { Fragment, memo, useRef } from "react";
import { ago, parseStamp } from "../../lib/time";

function inline(text: string) {
  return text.split(/\*\*([^*]+)\*\*/g).map((part, i) =>
    i % 2 ? <b key={i} className="text-[var(--bright)]">{part}</b> : <Fragment key={i}>{part}</Fragment>,
  );
}

// contentEditable DOM → markdown: keep **bold**, flatten everything else
function domToMd(el: HTMLElement): string {
  let out = "";
  el.childNodes.forEach((n) => {
    if (n.nodeType === Node.TEXT_NODE) out += n.textContent ?? "";
    else if (n instanceof HTMLElement) {
      const inner = domToMd(n);
      out += n.tagName === "B" || n.tagName === "STRONG" ? `**${inner}**` : inner;
    }
  });
  return out.replace(/\n+/g, " ").trim();
}

type Props = {
  notes: string;
  onToggle: (index: number) => void;
  onEditLine?: (lineIndex: number, newLine: string) => void;
  onComment?: (index: number) => void;
};

// while a line has focus, ignore incoming re-renders so live-channel refetches
// can't wipe an edit in progress
let editingNow = false;

export const NotesView = memo(
  function NotesView({ notes, onToggle, onEditLine, onComment }: Props) {
    const rootRef = useRef<HTMLDivElement>(null);
    let checkboxIndex = -1;
    // ↳-comment styling applies ONLY to indented bullets directly under a
    // checkbox; nested bullets elsewhere are ordinary list items
    let inCheckboxBlock = false;
    const lines = notes.split("\n");

    const editable = (lineIndex: number, prefix: string, className: string, content: string) =>
      onEditLine ? (
        <span
          contentEditable
          suppressContentEditableWarning
          spellCheck={false}
          className={`${className} -mx-1 rounded px-1 outline-none focus:bg-[rgba(57,215,255,.07)] focus:ring-1 focus:ring-[rgba(57,215,255,.35)]`}
          onFocus={() => { editingNow = true; }}
          onBlur={(e) => {
            editingNow = false;
            const next = domToMd(e.currentTarget);
            if (next && next !== content) onEditLine(lineIndex, prefix + next);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLElement).blur(); }
            if (e.key === "Escape") {
              (e.target as HTMLElement).textContent = content; // discard
              (e.target as HTMLElement).blur();
            }
          }}
        >
          {inline(content)}
        </span>
      ) : (
        <span className={className}>{inline(content)}</span>
      );

    return (
      <div ref={rootRef} className="max-w-[720px] font-sans text-[13.5px] leading-relaxed text-[var(--text)]">
        {lines.map((line, i) => {
          if (line.trim() === "") { inCheckboxBlock = false; return null; }
          if (/^# /.test(line)) { inCheckboxBlock = false; return null; }
          const h3 = line.match(/^### (.+)$/);
          if (h3) {
            inCheckboxBlock = false;
            return (
              <h3 key={i} className="mb-1 mt-4 text-[12.5px] font-semibold text-[var(--bright)]">
                {editable(i, "### ", "", h3[1])}
              </h3>
            );
          }
          const h2 = line.match(/^## (.+)$/);
          if (h2)
            return (
              <h2
                key={i}
                className="mb-2 mt-6 border-b border-[var(--line)] pb-1 text-[11px] uppercase tracking-[1.5px] text-[var(--cyan)]"
              >
                {editable(i, "## ", "", h2[1])}
              </h2>
            );
          const box = line.match(/^- \[( |x)\] (.*)$/);
          if (box) {
            inCheckboxBlock = true;
            const idx = ++checkboxIndex;
            const checked = box[1] === "x";
            return (
              <div key={i} className="group my-[3px] flex items-start gap-2 rounded-lg px-2 py-[6px] hover:bg-[rgba(57,215,255,.05)]">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(idx)}
                  className="mt-[3px] cursor-pointer accent-[var(--cyan)]"
                />
                <span className="min-w-0 flex-1">
                  {editable(
                    i,
                    `- [${box[1]}] `,
                    checked ? "text-[var(--dim)] line-through" : "",
                    box[2],
                  )}
                </span>
                {onComment && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onComment(idx); }}
                    title="Add a comment (context, resolution, reference)"
                    className="invisible shrink-0 rounded-full border border-[var(--line)] px-2 py-[1px] text-[10px] text-[var(--dim)] hover:border-[var(--cyan)] hover:text-[var(--cyan)] group-hover:visible"
                  >
                    ＋
                  </button>
                )}
              </div>
            );
          }
          const sub = line.match(/^(\s{2,}[-*] )(.*)$/);
          if (sub) {
            if (inCheckboxBlock) {
              const { when, stamp, text } = parseStamp(sub[2]);
              return (
                <div key={i} className="mb-[2px] ml-10 text-[12px] leading-snug text-[var(--dim)]">
                  <span className="mr-1 text-[var(--cyan-dim,#5b9ec4)]">↳</span>
                  {editable(i, sub[1] + stamp, "", text)}
                  {when && (
                    <span className="ml-2 text-[9.5px] opacity-70" title={new Date(when).toLocaleString()}>
                      · {ago(when)}
                    </span>
                  )}
                </div>
              );
            }
            return (
              <li key={i} className="mb-[3px] ml-10">
                {editable(i, sub[1], "", sub[2])}
              </li>
            );
          }
          inCheckboxBlock = false;
          const li = line.match(/^(\s*[-*] )(.*)$/);
          if (li)
            return (
              <li key={i} className="ml-5 mb-[3px]">
                {editable(i, li[1], "", li[2])}
              </li>
            );
          return <p key={i} className="mb-2">{editable(i, "", "", line)}</p>;
        })}
      </div>
    );
  },
  // skip re-renders entirely while the user is typing in a line
  (prev, next) => (editingNow ? true : prev.notes === next.notes),
);
