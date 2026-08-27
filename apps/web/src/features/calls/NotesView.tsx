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
import { Fragment, memo, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { calloutMeta } from "../../components/Markdown";
import { CodeBlock, Embed, IMAGE_RE, Table } from "../../components/blocks";
import { uploadPastedImage } from "../../lib/pasteImage";
import { imagesFromClipboard } from "../../lib/image";
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

// Obsidian [[target|label]] — rendered as a real link; data-md carries the
// original markdown so domToMd can round-trip it through an inline edit
function wiki(text: string, keyBase: number) {
  const out: React.ReactNode[] = [];
  // the leading ! is part of the match so an embed never leaves a stray "!"
  const re = /(!?)\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
  let last = 0, k = 0, m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(em(text.slice(last, m.index), keyBase * 100 + k++));
    const target = m[2].trim();
    const label = (m[3] ?? target).trim();
    if (m[1] === "!" && IMAGE_RE.test(target)) {
      out.push(<Embed key={`e${keyBase}-${k++}`} name={target} alt={label} />);
      last = m.index + m[0].length;
      continue;
    }
    const call = target.match(/^call(?:-notes)?-(\d{4}-\d{2}-\d{2}-\d{4})$/);
    out.push(
      <Link key={`w${keyBase}-${k++}`} data-md={m[0]} contentEditable={false}
        to={call ? `/calls/${call[1]}` : `/brain?focus=${encodeURIComponent(target)}`}
        className={call
          ? "text-[var(--cyan)] underline decoration-dotted underline-offset-2 hover:text-[var(--bright)]"
          : "rounded-full border border-[var(--indigo-3)] bg-[var(--indigo-2)] px-[7px] py-[1px] text-[11px] text-[var(--indigo)] hover:border-[var(--indigo)]"}>
        {label}
      </Link>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(em(text.slice(last), keyBase * 100 + k++));
  return <Fragment>{out}</Fragment>;
}

function inline(text: string) {
  return text.split(/\*\*([^*]+)\*\*/g).map((part, i) =>
    i % 2 ? <b key={i} className="text-[var(--bright)]">{wiki(part, i)}</b> : wiki(part, i),
  );
}

// a line that is nothing but an image — Obsidian embed or plain markdown
export function imageOnly(line: string): { name: string; alt: string } | null {
  const t = line.trim();
  const wl = t.match(/^!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/);
  if (wl && IMAGE_RE.test(wl[1].trim())) return { name: wl[1].trim(), alt: (wl[2] ?? "").trim() };
  const md = t.match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/);
  if (md && IMAGE_RE.test(md[2])) return { name: md[2], alt: md[1] };
  return null;
}

// contentEditable DOM → markdown: keep **bold**, flatten everything else
function domToMd(el: HTMLElement): string {
  let out = "";
  el.childNodes.forEach((n) => {
    if (n.nodeType === Node.TEXT_NODE) out += n.textContent ?? "";
    else if (n instanceof HTMLElement) {
      if (n.dataset.md) { out += n.dataset.md; return; }
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
  // Identity of the note being shown. The editing guard below may only skip
  // renders WITHIN one note — switching to a different call or note must
  // always re-render, or the body freezes on the previous one.
  noteId?: string;
  onToggle: (index: number) => void;
  onEditLine?: (lineIndex: number, newLine: string) => void;
  // Enter splits a line and a pasted image lands next to the caret, so the
  // view needs to ADD lines, not only rewrite them. One callback per gesture
  // rather than an edit plus an insert — two calls would be two saves, and
  // the second would race the first's write.
  onSplitLine?: (lineIndex: number, before: string, after: string) => void;
  onInsertLine?: (afterIndex: number, line: string) => void;
  onComment?: (index: number) => void;
  // card mode groups ## sections into the call-notes grid; flat mode (Notes
  // page) renders the document as one flow — freeform notes rarely have the
  // section skeleton the cards assume
  cards?: boolean;
};

// visual placement per known section (matched on the H2 text, lowercased);
// unknown sections get a full-width card after the known ones
const LAYOUT: Record<string, { order: number; span?: boolean; glyph?: string; cols?: boolean }> = {
  summary: { order: 1, glyph: "✳" },
  // Spans and splits into two columns: a dozen participants in a half-width
  // card made a tall ladder of wrapped text with dead space beside it.
  participants: { order: 2, span: true, cols: true },
  discussion: { order: 3, span: true },
  decisions: { order: 4, glyph: "✓" },
  "action items": { order: 5 },
  "open questions": { order: 6 },
};

// while a line has focus, ignore incoming re-renders so live-channel refetches
// can't wipe an edit in progress
let editingNow = false;

export const NotesView = memo(
  function NotesView({ notes, onToggle, onEditLine, onSplitLine, onInsertLine, onComment, cards = true }: Props) {
    const rootRef = useRef<HTMLDivElement>(null);
    // last line the caret was in — a pasted image inserts after it instead of
    // being dumped at the end of the note
    const focusedLine = useRef<number>(-1);
    // A line that still has focus when this unmounts never fires onBlur, so
    // the flag stayed true and every later render was skipped — the symptom
    // was picking another call and getting the previous call's notes.
    useEffect(() => () => { editingNow = false; }, []);
    let checkboxIndex = -1;
    // frontmatter lines render as nothing but KEEP their indexes so inline
    // edits still map to the right source line
    let fmEnd = -1;
    if (notes.startsWith("---\n")) {
      const close = notes.indexOf("\n---", 3);
      if (close > 0) fmEnd = notes.slice(0, close + 4).split("\n").length - 1;
      else {
        // Unterminated frontmatter — hide the YAML run rather than dumping it
        // as prose. Line indexes are preserved either way, so inline edits and
        // checkbox toggles still map to the right source line.
        const ls = notes.split("\n");
        const body = ls.findIndex((l, i) => i > 0 && (l.startsWith("# ") || l.startsWith("> ")));
        if (body > 0) fmEnd = body - 1;
      }
    }
    // ↳-comment styling applies ONLY to indented bullets directly under a
    // checkbox; nested bullets elsewhere are ordinary list items
    let inCheckboxBlock = false;
    let railColor = "";                     // active callout border, carried down the rail
    const lines = notes.split("\n");

    // Character offset of the caret within the element's text, counting
    // through nested <b>/<a> nodes — needed to split a line where the cursor
    // actually is rather than at the end.
    const caretOffset = (el: HTMLElement): number => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return el.textContent?.length ?? 0;
      const r = sel.getRangeAt(0).cloneRange();
      r.selectNodeContents(el);
      r.setEnd(sel.getRangeAt(0).endContainer, sel.getRangeAt(0).endOffset);
      return r.toString().length;
    };

    // A new line inherits the list marker so Enter inside a bullet makes
    // another bullet, the way every editor behaves. A checkbox yields an
    // unchecked one; a heading yields a plain line.
    const continuationPrefix = (prefix: string): string => {
      const p = prefix ?? "";
      if (/^\s*- \[[ x]\] $/.test(p)) return p.replace(/\[[ x]\]/, "[ ]");
      if (/^\s*[-*] $/.test(p)) return p;
      return "";
    };

    // An image pasted while editing belongs where the caret is, not at the
    // end of the document — that was the first cut and it read as a bug.
    const pasteImages = async (e: React.ClipboardEvent) => {
      if (!onInsertLine) return;
      const files = imagesFromClipboard(e);
      if (!files.length) return;                     // no image — normal paste
      e.preventDefault();
      const after = focusedLine.current >= 0 ? focusedLine.current : lines.length - 1;
      const embeds: string[] = [];
      for (const f of files.slice(0, 4)) {
        const em = await uploadPastedImage(f);
        if (em) embeds.push(em);
      }
      if (embeds.length) onInsertLine(after, embeds.join("\n"));
    };

    const editable = (lineIndex: number, prefix: string, className: string, content: string) =>
      onEditLine ? (
        <span
          contentEditable
          suppressContentEditableWarning
          spellCheck={false}
          className={`${className} -mx-1 rounded px-1 outline-none focus:bg-[var(--cyan-2)] focus:ring-1 focus:ring-[var(--cyan-3)]`}
          onFocus={() => { editingNow = true; focusedLine.current = lineIndex; }}
          onBlur={(e) => {
            editingNow = false;
            const next = domToMd(e.currentTarget);
            if (next && next !== content) onEditLine(lineIndex, prefix + next);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              const el = e.currentTarget as HTMLElement;
              // Shift+Enter keeps the old behaviour: commit and get out
              if (e.shiftKey || !onSplitLine) { el.blur(); return; }
              const text = domToMd(el);
              const at = caretOffset(el);
              editingNow = false;
              onSplitLine(lineIndex, prefix + text.slice(0, at), continuationPrefix(prefix) + text.slice(at));
              el.blur();
              return;
            }
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

    // Code fences and tables span SEVERAL source lines, but the renderer's
    // contract is one element per line. So the block renders at its FIRST
    // line and every other line of it returns null — the array keeps its
    // length and every index still points at its own source line.
    const blockAt = new Map<number, { kind: "code"; lang: string; body: string[] } | { kind: "table"; rows: string[] }>();
    const swallowed = new Set<number>();
    for (let i = 0; i < lines.length; i++) {
      if (swallowed.has(i) || i <= fmEnd) continue;
      const fence = lines[i].match(/^\s*```(\w*)\s*$/);
      if (fence) {
        const body: string[] = [];
        let j = i + 1;
        for (; j < lines.length && !/^\s*```\s*$/.test(lines[j]); j++) body.push(lines[j]);
        blockAt.set(i, { kind: "code", lang: fence[1], body });
        for (let k = i + 1; k <= Math.min(j, lines.length - 1); k++) swallowed.add(k);
        i = j;
        continue;
      }
      // a table is a pipe row followed by a |---|---| separator
      if (/^\s*\|/.test(lines[i]) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] ?? "")) {
        const rows = [lines[i]];
        let j = i + 2;
        for (; j < lines.length && /^\s*\|/.test(lines[j]); j++) rows.push(lines[j]);
        blockAt.set(i, { kind: "table", rows });
        for (let k = i + 1; k < j; k++) swallowed.add(k);
        i = j - 1;
      }
    }

    // one markdown line → one element; `section` tweaks list styling per card
    const renderLine = (line: string, i: number, section: string) => {
      if (i <= fmEnd) return null;                     // frontmatter — metadata, not prose
      if (swallowed.has(i)) {
        // The checkbox index is ORDINAL and the server counts every "- [ ]"
        // in the file, so a checkbox hidden inside a code fence must still
        // advance the counter or every toggle after it targets the wrong line.
        if (/^\s*- \[( |x)\] /.test(line)) checkboxIndex++;
        return null;                                   // consumed by a block below
      }
      const img = imageOnly(line);
      if (img) return <Embed key={i} name={img.name} alt={img.alt} />;
      const blk = blockAt.get(i);
      if (blk?.kind === "code") return <CodeBlock key={i} lang={blk.lang} body={blk.body} />;
      if (blk?.kind === "table") return <Table key={i} rows={blk.rows} inline={inline} />;
      if (line.trim() === "") { inCheckboxBlock = false; railColor = ""; return null; }
      if (/^# /.test(line)) { inCheckboxBlock = false; return null; }
      if (/^\*\*Topics:\*\*/.test(line)) return null; // shown as chips in the header
      const nextIsQuote = /^>/.test(lines[i + 1] ?? "");
      const co = line.match(/^>\s*\[!(\w+)\][+-]?\s*(.*)$/);
      if (co) {
        const meta = calloutMeta(co[1]);
        railColor = meta.cls.split(" ")[0];
        return (
          <div key={i} className={`mt-3 flex items-center gap-2 rounded-t-lg border-l-2 bg-[var(--surf-2)] px-3 pt-2 ${nextIsQuote ? "pb-1" : "rounded-b-lg pb-2 mb-3"} ${meta.cls.split(" ")[0]}`}>
            <span className={`text-[8.5px] tracking-[2px] ${meta.cls.split(" ")[1]}`}>{meta.label}</span>
            {co[2] && <span className="text-[12.5px] font-semibold text-[var(--bright)]">{editable(i, line.slice(0, line.length - co[2].length), "", co[2])}</span>}
          </div>
        );
      }
      const q = line.match(/^>\s?(.*)$/);
      if (q) {
        const railCls = /^>/.test(lines[i - 1] ?? "") ? "" : "mt-3 rounded-t-lg pt-2";
        const endCls = nextIsQuote ? "py-[3px]" : "rounded-b-lg pt-[3px] pb-2.5 mb-3";
        const qi = q[1].match(/^- (.*)$/);
        return (
          <div key={i} className={`border-l-2 ${railColor || "border-[var(--line-2)]"} bg-[var(--surf-2)] px-3 ${endCls} ${railCls}`}>
            {qi ? <span className="flex gap-2"><span className="text-[var(--dim)]">•</span><span>{editable(i, "> - ", "", qi[1])}</span></span>
                : q[1] ? editable(i, "> ", "", q[1]) : "\u00a0"}
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
            <div key={i} className="mb-[7px] flex items-start gap-3 break-inside-avoid">
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
        <div ref={rootRef} onPaste={pasteImages} className="max-w-[720px] font-sans text-[13.5px] leading-relaxed text-[var(--text)]">
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
      <div
        ref={rootRef}
        onPaste={pasteImages}
        className="grid gap-4 font-sans text-[13.5px] leading-relaxed text-[var(--text)] xl:grid-cols-2">
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
              {lay.cols ? <div className="sm:columns-2 sm:gap-x-8">{body}</div> : body}
            </section>
          );
        })}
      </div>
    );
  },
  // Skip re-renders while the user is typing in a line — but ONLY within the
  // same note. A different noteId always renders, so a stuck editing flag can
  // no longer freeze the pane on a stale call.
  (prev, next) =>
    prev.noteId === next.noteId && (editingNow ? true : prev.notes === next.notes),
);
