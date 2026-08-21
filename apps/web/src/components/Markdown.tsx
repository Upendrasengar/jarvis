// Minimal markdown renderer for digests and simple notes — headings, bullets,
// checkboxes (read-only), bold. React elements, never innerHTML.
// Digest-aware links: ledger headers (### call-notes-… / ### note-slug) and
// inline call-notes-<stamp> references navigate to the call/note pages.
import { Fragment, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ago, parseStamp } from "../lib/time";

function callRefs(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /call-notes-(\d{4}-\d{2}-\d{2}-\d{4})(?:\.md)?/g;
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

function inline(text: string) {
  return text.split(/\*\*([^*]+)\*\*/g).map((part, i) =>
    i % 2
      ? <b key={i} className="text-[var(--bright)]">{callRefs(part)}</b>
      : <Fragment key={i}>{callRefs(part)}</Fragment>,
  );
}

// "### call-notes-2026-08-11-1035 (Aug 11)" → /calls/2026-08-11-1035
// "### some-note-slug (undated)"   → /notes/some-note-slug
function ledgerLink(h3: string): string | null {
  const m = h3.match(/^(\S+?)(?:\.md)?(\s*\(.*\))?$/);
  if (!m) return null;
  const name = m[1];
  if (name.startsWith("call-notes-")) return `/calls/${name.replace(/^call-notes-/, "")}`;
  return `/notes/${encodeURIComponent(name)}`;
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
  return (
    <div className="max-w-[760px] font-sans text-[13.5px] leading-relaxed text-[var(--text)]">
      {md.split("\n").map((line, i) => {
        if (line.trim() === "") { inCheckboxBlock = false; return null; }
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
              <button
                onClick={toggle}
                disabled={!canToggle}
                title={canToggle ? "Check off in the source note — no need to leave the digest" : undefined}
                className={`text-[var(--cyan)] ${canToggle ? "cursor-pointer hover:drop-shadow-[0_0_6px_var(--cyan)]" : "cursor-default"}`}
              >
                {checked ? "☑" : "☐"}
              </button>
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
        const li = line.match(/^\s*(?:[-*]|\d+\.)\s+(.*)$/);
        if (li) { inCheckboxBlock = false; return <li key={i} className="ml-5 mb-1">{inline(li[1])}</li>; }
        inCheckboxBlock = false;
        return <p key={i} className="mb-2">{inline(line)}</p>;
      })}
    </div>
  );
}
