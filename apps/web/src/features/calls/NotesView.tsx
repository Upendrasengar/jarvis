// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// Renders call-notes markdown as React elements (no innerHTML, no XSS
// surface) — and every text line is contentEditable in place. Because each
// rendered element corresponds to exactly one markdown source line, an edit
// maps back trivially: blur → rebuild that line with its original prefix
// (##, -, - [ ]) → parent saves the whole note (reports + vault together).
//
// The v2 design renders each ## section as a CARD in a two-column grid
// (Summary and Participants up top, Discussion full-width, then Decisions /
// Action items / Open questions). Grouping is display-only: lines keep their
// file order and indexes, so edits and checkbox toggles map back unchanged.
import { Fragment, memo, useRef } from "react";
import { calloutMeta } from "../../components/Markdown";
import { ago, parseStamp } from "../../lib/time";

function em(text: string, key: number) {
  return (
    <Fragment key={key}>
      {text.split(/\*([^*]+)\*/g).map((part, j) =>
        j % 2 ? <i key={j} className="font-medium not-italic text-[var(--bright)]">{part}</i> : <Fragment key={j}>{part}</Fragment>,
      )}
    </Fragment>
  );
}

function inline(text: string) {
  return text.split(/\*\*([^*]+)\*\*/g).map((part, i) =>
    i % 2 ? <b key={i} className="text-[var(--bright)]">{part}</b> : em(part, i),
  );
}

// contentEditable DOM → markdown: keep **bold**, flatten everything else
function domToMd(el: HTMLElement): string {
  let out = "";
  el.childNodes.forEach((n) => {
    if (n.nodeType === Node.TEXT_NODE) out += n.textContent ?? "";
    else if (n instanceof HTMLElement) {
      const inner = domToMd(n);
      out +=
        n.tagName === "B" || n.tagName === "STRONG" ? `**${inner}**`
        : n.tagName === "I" || n.tagName === "EM" ? `*${inner}*`
        : inner;
    }
  });
  return out.replace(/\n+/g, " ").trim();
}

type Props = {
  notes: string;
  onToggle: (index: number) => void;
  onEditLine?: (lineIndex: number, newLine: string) => void;
  onComment?: (index: number) => void;
  // card mode groups ## sections into the call-notes grid; flat mode (Notes
  // page) renders the document as one flow — freeform notes rarely have the
  // section skeleton the cards assume
  cards?: boolean;
};

// visual placement per known section (matched on the H2 text, lowercased);
// unknown sections get a full-width card after the known ones
const LAYOUT: Record<string, { order: number; span?: boolean; glyph?: string }> = {
  summary: { order: 1, glyph: "✳" },
  participants: { order: 2 },
  discussion: { order: 3, span: true },
  decisions: { order: 4, glyph: "✓" },
  "action items": { order: 5 },
  "open questions": { order: 6 },
};

// while a line has focus, ignore incoming re-renders so live-channel refetches
// can't wipe an edit in progress
let editingNow = false;

export const NotesView = memo(
  function NotesView({ notes, onToggle, onEditLine, onComment, cards = true }: Props) {
    const rootRef = useRef<HTMLDivElement>(null);
    let checkboxIndex = -1;
    // frontmatter lines render as nothing but KEEP their indexes so inline
    // edits still map to the right source line
    let fmEnd = -1;
    if (notes.startsWith("---\n")) {
      const close = notes.indexOf("\n---", 3);
      if (close > 0) fmEnd = notes.slice(0, close + 4).split("\n").length - 1;
    }
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
          className={`${className} -mx-1 rounded px-1 outline-none focus:bg-[var(--cyan-2)] focus:ring-1 focus:ring-[var(--cyan-3)]`}
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

    // one markdown line → one element; `section` tweaks list styling per card
    const renderLine = (line: string, i: number, section: string) => {
      if (i <= fmEnd) return null;                     // frontmatter — metadata, not prose
      if (line.trim() === "") { inCheckboxBlock = false; return null; }
      if (/^# /.test(line)) { inCheckboxBlock = false; return null; }
      if (/^\*\*Topics:\*\*/.test(line)) return null; // shown as chips in the header
      const co = line.match(/^>\s*\[!(\w+)\][+-]?\s*(.*)$/);
      if (co) {
        const meta = calloutMeta(co[1]);
        return (
          <div key={i} className={`mt-3 flex items-center gap-2 rounded-t-lg border-l-2 bg-[var(--surf-2)] px-3 pb-1 pt-2 ${meta.cls.split(" ")[0]}`}>
            <span className={`text-[8.5px] tracking-[2px] ${meta.cls.split(" ")[1]}`}>{meta.label}</span>
            {co[2] && <span className="text-[12.5px] font-semibold text-[var(--bright)]">{editable(i, line.slice(0, line.length - co[2].length), "", co[2])}</span>}
          </div>
        );
      }
      const q = line.match(/^>\s?(.*)$/);
      if (q) {
        return (
          <div key={i} className="border-l-2 border-[var(--line-2)] bg-[var(--surf-2)] px-3 py-[3px]">
            {q[1] ? editable(i, "> ", "", q[1]) : "\u00a0"}
          </div>
        );
      }
      const h3 = line.match(/^### (.+)$/);
      if (h3) {
        inCheckboxBlock = false;
        return (
          <h3 key={i} className="mb-1 mt-4 text-[12.5px] font-semibold text-[var(--bright)]">
            {editable(i, "### ", "", h3[1])}
          </h3>
        );
      }
      const box = line.match(/^- \[( |x)\] (.*)$/);
      if (box) {
        inCheckboxBlock = true;
        const idx = ++checkboxIndex;
        const checked = box[1] === "x";
        return (
          <div key={i} className="group my-[3px] flex items-start gap-2 rounded-lg px-2 py-[6px] hover:bg-[var(--surf-2)]">
            <input type="checkbox" checked={checked} onChange={() => onToggle(idx)} className="chk mt-[2px]" />
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
      if (li) {
        if (section === "participants") {
          const initial = li[2].replace(/^\W+/, "").charAt(0).toUpperCase() || "?";
          return (
            <div key={i} className="mb-[7px] flex items-start gap-3">
              <span className="mt-[1px] flex h-[24px] w-[24px] shrink-0 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--surf-2)] text-[10.5px] font-semibold text-[var(--bright)]">
                {initial}
              </span>
              <span className="min-w-0 pt-[2px]">{editable(i, li[1], "", li[2])}</span>
            </div>
          );
        }
        if (section === "decisions") {
          return (
            <div key={i} className="mb-[5px] flex items-start gap-2">
              <span className="mt-[1px] shrink-0 text-[var(--green)]">✓</span>
              <span className="min-w-0">{editable(i, li[1], "", li[2])}</span>
            </div>
          );
        }
        return (
          <li key={i} className="ml-5 mb-[3px]">
            {editable(i, li[1], "", li[2])}
          </li>
        );
      }
      return <p key={i} className="mb-2">{editable(i, "", "", line)}</p>;
    };

    if (!cards)
      return (
        <div ref={rootRef} className="max-w-[720px] font-sans text-[13.5px] leading-relaxed text-[var(--text)]">
          {lines.map((line, i) => {
            const h2 = line.match(/^## (.+)$/);
            if (h2)
              return (
                <h2 key={i} className="mb-2 mt-6 border-b border-[var(--line)] pb-1 text-[13px] font-semibold text-[var(--bright)]">
                  {editable(i, "## ", "", h2[1])}
                </h2>
              );
            return renderLine(line, i, "");
          })}
        </div>
      );

    // group lines into ## sections (display-only; file order preserved)
    type Sec = { title?: { text: string; i: number }; rows: Array<{ line: string; i: number }> };
    const sections: Sec[] = [{ rows: [] }];
    lines.forEach((line, i) => {
      const h2 = line.match(/^## (.+)$/);
      if (h2) sections.push({ title: { text: h2[1], i }, rows: [] });
      else sections[sections.length - 1].rows.push({ line, i });
    });

    return (
      <div ref={rootRef} className="grid gap-4 font-sans text-[13.5px] leading-relaxed text-[var(--text)] xl:grid-cols-2">
        {sections.map((sec, s) => {
          const key = (sec.title?.text ?? "").trim().toLowerCase();
          const lay = sec.title ? LAYOUT[key] ?? { order: 7, span: true } : { order: 0, span: true };
          const body = sec.rows.map(({ line, i }) => renderLine(line, i, key));
          if (!sec.title)
            return body.some(Boolean) ? (
              <div key={s} className="text-[11.5px] text-[var(--dim)] xl:col-span-2" style={{ order: lay.order }}>
                {body}
              </div>
            ) : null;
          return (
            <section
              key={s}
              style={{ order: lay.order }}
              className={`rounded-2xl border border-[var(--line)] bg-[var(--surf)] p-5 [box-shadow:var(--shadow)] ${lay.span ? "xl:col-span-2" : ""}`}
            >
              <h2 className="mb-3 flex items-center gap-2 text-[14px] font-semibold text-[var(--bright)]">
                {lay.glyph && <span className="text-[var(--cyan)]">{lay.glyph}</span>}
                {editable(sec.title.i, "## ", "", sec.title.text)}
              </h2>
              {body}
            </section>
          );
        })}
      </div>
    );
  },
  // skip re-renders entirely while the user is typing in a line
  (prev, next) => (editingNow ? true : prev.notes === next.notes),
);
