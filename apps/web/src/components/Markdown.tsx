// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// Minimal markdown renderer for digests and simple notes — headings, bullets,
// checkboxes (read-only), bold. React elements, never innerHTML.
// Digest-aware links: ledger headers (### call-notes-… / ### note-slug) and
// inline call-notes-<stamp> references navigate to the call/note pages.
import { Fragment, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ago, parseStamp } from "../lib/time";
import { CodeBlock, Embed, IMAGE_RE, Table } from "./blocks";

function callRefs(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /call(?:-notes)?-(\d{4}-\d{2}-\d{2}-\d{4})(?:\.md)?/g;
  let last = 0, k = 0, m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(
      <Link
        key={`c${k++}`}
        to={`/calls/${m[1]}`}
        className="text-[var(--cyan)] underline decoration-dotted underline-offset-2 hover:text-[var(--bright)]"
      >
        {m[0].replace(/\.md$/, "")}
      </Link>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// Obsidian [[target|label]] / [[target]] — call targets open the call page,
// anything else is a topic and opens the brain graph
function wikiLinks(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(!?)\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
  let last = 0, k = 0, m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(...callRefs(text.slice(last, m.index)));
    const target = m[2].trim();
    const label = (m[3] ?? target).trim();
    if (m[1] === "!" && IMAGE_RE.test(target)) {
      out.push(<Embed key={`e${k++}`} name={target} alt={label} />);
      last = m.index + m[0].length;
      continue;
    }
    const call = target.match(/^call(?:-notes)?-(\d{4}-\d{2}-\d{2}-\d{4})$/);
    out.push(
      call ? (
        <Link key={`w${k++}`} to={`/calls/${call[1]}`}
          className="text-[var(--cyan)] underline decoration-dotted underline-offset-2 hover:text-[var(--bright)]">
          {label}
        </Link>
      ) : (
        <Link key={`w${k++}`} to={`/brain?focus=${encodeURIComponent(target)}`}
          className="rounded-full border border-[var(--indigo-3)] bg-[var(--indigo-2)] px-[7px] py-[1px] text-[11px] text-[var(--indigo)] hover:border-[var(--indigo)]">
          {label}
        </Link>
      ),
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(...callRefs(text.slice(last)));
  return out;
}

function bold(text: string) {
  return text.split(/\*\*([^*]+)\*\*/g).map((part, i) =>
    i % 2
      ? <b key={i} className="text-[var(--bright)]">{wikiLinks(part)}</b>
      : <Fragment key={i}>{wikiLinks(part)}</Fragment>,
  );
}

// `inline code` — paths and commands came through with literal backticks
// until this existed. Runs OUTSIDE bold/wikilinks: code spans are literal.
function inline(text: string) {
  return text.split(/`([^`]+)`/g).map((part, i) =>
    i % 2
      ? (
        <code key={i} className="rounded border border-[var(--line-2)] bg-[var(--surf-2)] px-[5px] py-[1px] font-mono text-[0.92em] text-[var(--cyan)]">
          {part}
        </code>
      )
      : <Fragment key={i}>{bold(part)}</Fragment>,
  );
}

// "### call-notes-2026-08-11-1035 (Aug 11)" → /calls/2026-08-11-1035
// "### some-note-slug (undated)"            → /notes/some-note-slug
function ledgerLink(h3: string): string | null {
  const m = h3.match(/^(\S+?)(?:\.md)?(\s*\(.*\))?$/);
  if (!m) return null;
  const name = m[1];
  if (/^call(-notes)?-\d{4}-\d{2}-\d{2}-\d{4}$/.test(name)) return `/calls/${name.replace(/^call(-notes)?-/, "")}`;
  return `/notes/${encodeURIComponent(name)}`;
}

// Obsidian callouts: > [!type] Title — colored by intent
const CALLOUT: Record<string, { label: string; cls: string }> = {
  summary: { label: "SUMMARY", cls: "border-[var(--cyan-3)] text-[var(--cyan)]" },
  note: { label: "NOTE", cls: "border-[var(--indigo-3)] text-[var(--indigo)]" },
  info: { label: "INFO", cls: "border-[var(--indigo-3)] text-[var(--indigo)]" },
  tip: { label: "TIP", cls: "border-[var(--green)] text-[var(--green)]" },
  warning: { label: "WARNING", cls: "border-[rgba(255,201,92,.5)] text-[var(--amber)]" },
  caution: { label: "CAUTION", cls: "border-[rgba(255,201,92,.5)] text-[var(--amber)]" },
  important: { label: "IMPORTANT", cls: "border-[rgba(255,107,132,.5)] text-[var(--red)]" },
  danger: { label: "DANGER", cls: "border-[rgba(255,107,132,.5)] text-[var(--red)]" },
};
export function calloutMeta(type: string) {
  return CALLOUT[type.toLowerCase()] ?? { label: type.toUpperCase(), cls: "border-[var(--line-2)] text-[var(--dim)]" };
}

// YAML-lite frontmatter: strip it, keep tags for chips
export function splitFrontmatter(md: string): { body: string; tags: string[] } {
  let m = md.match(/^---\n([\s\S]*?)\n---\n?/);
  // Unterminated frontmatter: the generator occasionally omits the closing
  // ---, and without this the whole YAML block renders as prose. Recover by
  // treating everything before the first heading/callout as frontmatter.
  if (!m && md.startsWith("---\n")) {
    const body = md.search(/^(#|> )/m);
    if (body > 0) {
      const head = md.slice(4, body).replace(/\n+$/, "");
      m = [md.slice(0, body), head] as unknown as RegExpMatchArray;
    }
  }
  if (!m) return { body: md, tags: [] };
  const tags: string[] = [];
  const tagBlock = m[1].match(/^tags:\s*\n((?:\s+-\s+.*\n?)+)/m);
  if (tagBlock)
    for (const t of tagBlock[1].split("\n"))
      { const v = t.match(/-\s+(.+)/)?.[1]?.trim(); if (v) tags.push(v.replace(/^"|"$/g, "")); }
  return { body: md.slice(m[0].length), tags };
}

type Block =
  | { kind: "code"; lang: string; body: string[] }
  | { kind: "table"; rows: string[] };

// Code fences and tables span several lines. They render at their FIRST line
// and the rest are swallowed, so the one-element-per-line shape is unchanged.
export function mapBlocks(lines: string[]): { at: Map<number, Block>; swallowed: Set<number> } {
  const at = new Map<number, Block>();
  const swallowed = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    const fence = lines[i].match(/^\s*```(\w*)\s*$/);
    if (fence) {
      const bodyLines: string[] = [];
      let j = i + 1;
      for (; j < lines.length && !/^\s*```\s*$/.test(lines[j]); j++) bodyLines.push(lines[j]);
      at.set(i, { kind: "code", lang: fence[1], body: bodyLines });
      for (let k = i + 1; k <= Math.min(j, lines.length - 1); k++) swallowed.add(k);
      i = j;
      continue;
    }
    if (/^\s*\|/.test(lines[i]) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] ?? "")) {
      const rows = [lines[i]];
      let j = i + 2;
      for (; j < lines.length && /^\s*\|/.test(lines[j]); j++) rows.push(lines[j]);
      at.set(i, { kind: "table", rows });
      for (let k = i + 1; k < j; k++) swallowed.add(k);
      i = j - 1;
    }
  }
  return { at, swallowed };
}

export function imageOnlyLine(line: string): { name: string; alt: string } | null {
  const t = line.trim();
  const wl = t.match(/^!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/);
  if (wl && IMAGE_RE.test(wl[1].trim())) return { name: wl[1].trim(), alt: (wl[2] ?? "").trim() };
  const md = t.match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/);
  if (md && IMAGE_RE.test(md[2])) return { name: md[2], alt: md[1] };
  return null;
}

type LedgerToggle = (source: string, line: string) => Promise<boolean>;
type LedgerState = (source: string, line: string) => boolean | undefined;
type LedgerTitle = (source: string) => string | undefined;

export function Markdown({ md, onLedgerToggle, ledgerState, ledgerTitle, afterH2, ledgerDupe }: {
  md: string; onLedgerToggle?: LedgerToggle; ledgerState?: LedgerState; ledgerTitle?: LedgerTitle;
  // inject a node right below a matching ## heading (the Recurring panel)
  afterH2?: { pattern: RegExp; node: ReactNode };
  // lines grouped into a recurring cluster render dimmed with a ⟳ marker
  ledgerDupe?: (source: string, line: string) => boolean;
}) {
  // optimistic check-state per line index; reverted if the toggle fails
  const [flips, setFlips] = useState<Record<number, boolean>>({});
  let section: string | null = null;   // current ### ledger source
  // ↳-comment styling applies only to indented bullets directly under a
  // checkbox (an item's comment trail), not to ordinary nested lists
  let inCheckboxBlock = false;
  let railColor = "";                        // active callout border, carried down the rail
  const { body, tags } = splitFrontmatter(md);
  const blocks = mapBlocks(body.split("\n"));
  return (
    <div className="max-w-[760px] font-sans text-[13.5px] leading-relaxed text-[var(--text)]">
      {tags.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <span key={t} className="rounded-full border border-[var(--line)] bg-[var(--surf-2)] px-2 py-[2px] font-mono text-[9.5px] text-[var(--dim)]">
              #{t}
            </span>
          ))}
        </div>
      )}
      {body.split("\n").map((line, i) => {
        if (blocks.swallowed.has(i)) return null;
        const blk = blocks.at.get(i);
        if (blk?.kind === "code") return <CodeBlock key={i} lang={blk.lang} body={blk.body} />;
        if (blk?.kind === "table") return <Table key={i} rows={blk.rows} inline={inline} />;
        const only = imageOnlyLine(line);
        if (only) return <Embed key={i} name={only.name} alt={only.alt} />;
        if (line.trim() === "") { inCheckboxBlock = false; railColor = ""; return null; }
        if (/^-{3,}$/.test(line.trim())) return <hr key={i} className="my-4 border-[var(--line)]" />;
        const nextIsQuote = /^>/.test(body.split("\n")[i + 1] ?? "");
        const co = line.match(/^>\s*\[!(\w+)\][+-]?\s*(.*)$/);
        if (co) {
          const meta = calloutMeta(co[1]);
          railColor = meta.cls.split(" ")[0];
          return (
            <div key={i} className={`mt-4 flex items-center gap-2 rounded-t-lg border-l-2 bg-[var(--surf-2)] px-3 pt-2 ${nextIsQuote ? "pb-1" : "rounded-b-lg pb-2 mb-3"} ${railColor}`}>
              <span className={`text-[8.5px] tracking-[2px] ${meta.cls.split(" ")[1]}`}>{meta.label}</span>
              {co[2] && <span className="text-[12.5px] font-semibold text-[var(--bright)]">{inline(co[2])}</span>}
            </div>
          );
        }
        const q = line.match(/^>\s?(.*)$/);
        if (q) {
          // continuation of a callout (or a plain quote) — same rail, and the
          // last line closes the box instead of chopping flush
          const prev = body.split("\n")[i - 1] ?? "";
          const railCls = /^>/.test(prev) ? "" : "mt-4 rounded-t-lg pt-2";
          const endCls = nextIsQuote ? "py-[3px]" : "rounded-b-lg pt-[3px] pb-2.5 mb-3";
          const qi = q[1].match(/^- (.*)$/);
          return (
            <div key={i} className={`border-l-2 ${railColor || "border-[var(--line-2)]"} bg-[var(--surf-2)] px-3 ${endCls} ${railCls}`}>
              {qi ? <span className="flex gap-2"><span className="text-[var(--dim)]">•</span><span>{inline(qi[1])}</span></span>
                  : q[1] ? inline(q[1]) : "\u00a0"}
            </div>
          );
        }
        const h1 = line.match(/^# (.+)$/);
        if (h1) return <h1 key={i} className="mb-3 mt-2 text-xl text-[var(--bright)]">{h1[1]}</h1>;
        const h2 = line.match(/^## (.+)$/);
        if (h2)
          return (
            <Fragment key={i}>
              <h2 className="mb-2 mt-5 text-[11px] uppercase tracking-[1.5px] text-[var(--cyan)]">
                {h2[1]}
              </h2>
              {afterH2?.pattern.test(h2[1]) ? afterH2.node : null}
            </Fragment>
          );
        const h3 = line.match(/^### (.+)$/);
        if (h3) {
          section = h3[1].match(/^(\S+?)(?:\.md)?(?:\s|$)/)?.[1] ?? null;
          const to = ledgerLink(h3[1]);
          // resolve "call-notes-2026-08-11-1035" to the real meeting title
          const title = section ? ledgerTitle?.(section) : undefined;
          return (
            <h3 key={i} className="mb-1 mt-4 text-[12.5px] font-semibold text-[var(--bright)]">
              {to ? (
                <Link to={to} className="no-underline hover:text-[var(--cyan)]">
                  {title ? (
                    <>
                      {title}{" "}
                      <span className="font-normal text-[10px] text-[var(--dim)]">{h3[1]}</span>{" "}
                      <span className="text-[10px] text-[var(--cyan)]">↗</span>
                    </>
                  ) : (
                    <>{h3[1]} <span className="text-[10px] text-[var(--cyan)]">↗</span></>
                  )}
                </Link>
              ) : (
                h3[1]
              )}
            </h3>
          );
        }
        const box = line.match(/^\s*(?:\d+\.\s*)?- \[( |x)\] (.*)$/);
        if (box) inCheckboxBlock = true;
        if (box) {
          // precedence: this session's click > live source state > snapshot
          const live = section ? ledgerState?.(section, box[2]) : undefined;
          const checked = flips[i] ?? live ?? box[1] === "x";
          if (!checked && section && ledgerDupe?.(section, box[2]))
            return (
              <div key={i} className="ml-2 mb-1 flex gap-2 opacity-45" title="Grouped in Recurring above — check it off there">
                <span className="text-[var(--cyan)]">⟳</span>
                <span>{inline(box[2])}</span>
              </div>
            );
          const src = section;
          const canToggle = !!onLedgerToggle && !!src;
          const toggle = async () => {
            if (!canToggle) return;
            setFlips((f) => ({ ...f, [i]: !checked }));       // optimistic
            const ok = await onLedgerToggle!(src!, box[2]);
            if (!ok) setFlips((f) => ({ ...f, [i]: checked })); // revert
          };
          return (
            <div key={i} className="ml-2 mb-1 flex gap-2">
              <input
                type="checkbox"
                checked={checked}
                onChange={toggle}
                disabled={!canToggle}
                title={canToggle ? "Check off in the source note — no need to leave the digest" : undefined}
                className="chk mt-[2px] disabled:cursor-default disabled:opacity-60"
              />
              <span className={checked ? "text-[var(--dim)] line-through" : ""}>{inline(box[2])}</span>
            </div>
          );
        }
        const sub = line.match(/^\s{2,}[-*]\s+(.*)$/);
        if (sub && inCheckboxBlock) {
          const { when, text } = parseStamp(sub[1]);
          return (
            <div key={i} className="mb-[2px] ml-9 text-[12px] leading-snug text-[var(--dim)]">
              <span className="mr-1 text-[var(--cyan-dim,#5b9ec4)]">↳</span>
              {inline(text)}
              {when && (
                <span className="ml-2 text-[9.5px] opacity-70" title={new Date(when).toLocaleString()}>
                  · {ago(when)}
                </span>
              )}
            </div>
          );
        }
        // Nested bullets: the indent used to be matched and thrown away, so a
        // two-level list rendered as one flat level and every answer read as
        // a wall. Depth now drives the margin and the marker.
        const li = line.match(/^([ \t]*)(?:[-*]|\d+\.)\s+(.*)$/);
        if (li) {
          inCheckboxBlock = false;
          const cols = li[1].replace(/\t/g, "  ").length;
          const depth = Math.min(Math.floor(cols / 2), 3);
          const indent = ["ml-5", "ml-10", "ml-[60px]", "ml-20"][depth];
          const marker = depth === 0 ? "" : "list-[circle]";
          return (
            <li key={i} className={`mb-1 ${indent} ${marker} marker:text-[var(--dim)]`}>
              {inline(li[2])}
            </li>
          );
        }
        inCheckboxBlock = false;
        return <p key={i} className="mb-2">{inline(line)}</p>;
      })}
    </div>
  );
}
