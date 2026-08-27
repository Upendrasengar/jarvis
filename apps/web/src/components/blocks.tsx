// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// Block constructs shared by the two markdown renderers (NotesView for
// notes/calls, Markdown for digests): fenced code, GFM tables, and Obsidian
// image embeds. Kept here so the two renderers cannot drift — they already
// did once over inline code.
import { useState, type ReactNode } from "react";

// ---------------------------------------------------------------- code ----
export function CodeBlock({ lang, body }: { lang: string; body: string[] }) {
  const [copied, setCopied] = useState(false);
  const text = body.join("\n");
  return (
    <div className="group relative my-3">
      <button
        onClick={async () => {
          try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1400); } catch {}
        }}
        title="Copy code"
        // reserved space, opacity swap — a control that appears on hover can
        // reflow the block and flicker the hover away
        className="absolute right-2 top-2 rounded-lg border border-[var(--line-2)] bg-[var(--surf-2)] px-2 py-[2px] font-mono text-[10px] text-[var(--dim)] opacity-0 transition group-hover:opacity-100 hover:text-[var(--cyan)]"
      >
        {copied ? "copied" : "copy"}
      </button>
      {lang && (
        <span className="absolute left-3 top-2 font-mono text-[9px] uppercase tracking-[1.5px] text-[var(--dim)]">
          {lang}
        </span>
      )}
      <pre className={`overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--surf-2)] px-4 pb-3 ${lang ? "pt-7" : "pt-3"}`}>
        <code className="font-mono text-[12px] leading-relaxed text-[var(--text)]">{text}</code>
      </pre>
    </div>
  );
}

// --------------------------------------------------------------- table ----
const cells = (row: string) =>
  row.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

export function Table({ rows, inline }: { rows: string[]; inline: (s: string) => ReactNode }) {
  if (!rows.length) return null;
  const head = cells(rows[0]);
  const body = rows.slice(1).map(cells);
  return (
    // the table scrolls inside its own box; the note must never scroll sideways
    <div className="my-3 overflow-x-auto rounded-xl border border-[var(--line)]">
      <table className="w-full border-collapse text-[12.5px]">
        <thead>
          <tr className="bg-[var(--surf-2)]">
            {head.map((c, i) => (
              <th key={i} className="border-b border-[var(--line)] px-3 py-2 text-left font-semibold text-[var(--bright)]">
                {inline(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((r, i) => (
            <tr key={i} className="border-b border-[var(--line)] last:border-0">
              {r.map((c, j) => (
                <td key={j} className="px-3 py-2 align-top text-[var(--text)]">{inline(c)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// -------------------------------------------------------------- images ----
export const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg)$/i;

// Obsidian resolves an embed by basename wherever the file sits in the vault;
// the server route does the same, so the note text stays portable.
export const attachmentUrl = (name: string) =>
  `/api/attachment/${encodeURIComponent(name.trim())}`;

export function Embed({ name, alt }: { name: string; alt?: string }) {
  return (
    <img
      src={attachmentUrl(name)}
      alt={alt || name}
      loading="lazy"
      className="my-2 block max-w-full rounded-xl border border-[var(--line)]"
    />
  );
}
