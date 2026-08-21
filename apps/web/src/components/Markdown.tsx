// Minimal markdown renderer for digests and simple notes — headings, bullets,
// checkboxes (read-only), bold. React elements, never innerHTML.
// Digest-aware links: ledger headers (### call-notes-… / ### note-slug) and
// inline call-notes-<stamp> references navigate to the call/note pages.
import { Fragment, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";

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

export function Markdown({ md, onLedgerToggle, ledgerState }: {
  md: string; onLedgerToggle?: LedgerToggle; ledgerState?: LedgerState;
}) {
  // optimistic check-state per line index; reverted if the toggle fails
  const [flips, setFlips] = useState<Record<number, boolean>>({});
  let section: string | null = null;   // current ### ledger source
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
        const h3 = line.match(/^### (.+)$/);
        if (h3) {
          section = h3[1].match(/^(\S+?)(?:\.md)?(?:\s|$)/)?.[1] ?? null;
          const to = ledgerLink(h3[1]);
          return (
            <h3 key={i} className="mb-1 mt-4 text-[12.5px] font-semibold text-[var(--bright)]">
              {to ? (
                <Link to={to} className="no-underline hover:text-[var(--cyan)]">
                  {h3[1]} <span className="text-[10px] text-[var(--cyan)]">↗</span>
                </Link>
              ) : (
                h3[1]
              )}
            </h3>
          );
        }
        const box = line.match(/^\s*(?:\d+\.\s*)?- \[( |x)\] (.*)$/);
        if (box) {
          // precedence: this session's click > live source state > snapshot
          const live = section ? ledgerState?.(section, box[2]) : undefined;
          const checked = flips[i] ?? live ?? box[1] === "x";
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
        const li = line.match(/^\s*(?:[-*]|\d+\.)\s+(.*)$/);
        if (li) return <li key={i} className="ml-5 mb-1">{inline(li[1])}</li>;
        return <p key={i} className="mb-2">{inline(line)}</p>;
      })}
    </div>
  );
}
