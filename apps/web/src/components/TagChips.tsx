// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// Frontmatter tag chips with add/remove — the tag counterpart of the topic
// picker. Edits happen on the markdown itself (frontmatter tags list), so
// the graph, the brain page, and Obsidian all see the same truth. Chips
// deep-link to the brain filtered to that tag.
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

const FM_RE = /^---\n([\s\S]*?)\n---/;

export function parseTags(md: string): string[] {
  const fm = md.match(FM_RE);
  if (!fm) return [];
  const block = fm[1].match(/^tags:\s*\n((?:[ \t]+-[ \t]+.*\n?)*)/m);
  if (block)
    return [...block[1].matchAll(/-[ \t]+(.+)/g)]
      .map((m) => m[1].trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
  const inline = fm[1].match(/^tags:\s*\[([^\]]*)\]/m);
  if (inline) return inline[1].split(",").map((t) => t.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
  return [];
}

export function addTagMd(md: string, t: string): string {
  const fm = md.match(FM_RE);
  if (!fm) return `---\ntags:\n  - ${t}\n---\n\n${md}`;
  if (/^tags:[ \t]*\n/m.test(md)) return md.replace(/^tags:[ \t]*\n/m, `tags:\n  - ${t}\n`);
  const inline = fm[1].match(/^tags:\s*\[([^\]]*)\]/m);
  if (inline)
    return md.replace(/^tags:\s*\[([^\]]*)\]/m,
      (_, list: string) => `tags: [${list.trim() ? `${list.trim()}, ` : ""}${t}]`);
  return md.replace(FM_RE, (_, body: string) => `---\n${body}\ntags:\n  - ${t}\n---`);
}

export function removeTagMd(md: string, t: string): string {
  const fm = md.match(FM_RE);
  if (!fm) return md;
  const esc = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const body = fm[1]
    .replace(new RegExp(`^[ \\t]+-[ \\t]+["']?${esc}["']?[ \\t]*\\n?`, "m"), "")
    .replace(/^tags:\s*\[([^\]]*)\]/m, (_, list: string) =>
      `tags: [${list.split(",").map((x) => x.trim()).filter((x) => x.replace(/^["']|["']$/g, "") !== t).join(", ")}]`);
  return md.replace(FM_RE, () => `---\n${body}\n---`);
}

export function TagChips({ md, onChange }: { md: string; onChange: (next: string) => void }) {
  const tags = parseTags(md);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [all, setAll] = useState<string[]>([]);
  const navigate = useNavigate();
  useEffect(() => {
    if (open && !all.length)
      fetch("/api/tags").then((r) => r.json()).then((t) => Array.isArray(t) && setAll(t)).catch(() => {});
  }, [open, all.length]);
  const name = q.trim().replace(/^#/, "");
  // tags become graph node ids and frontmatter values — keep them plain
  const valid = name.length > 0 && name.length <= 40 && !/[\s#[\]|\\"']/.test(name);
  const commit = () => {
    if (!valid || tags.includes(name)) return;
    onChange(addTagMd(md, name));
    setQ("");
    setOpen(false);
  };
  return (
    <>
      {tags.map((t) => (
        <span key={t}
          className="group flex items-center rounded-md border border-[var(--line)] bg-[var(--surf-2)] px-[7px] py-[3px] font-mono text-[9.5px] text-[var(--green)]">
          <button onClick={() => navigate(`/brain?focus=${encodeURIComponent(`tag:${t}`)}`)}
            title={`Show #${t} in the brain graph`} className="hover:text-[var(--bright)]">
            <span className="opacity-40">#</span>{t}
          </button>
          <button onClick={() => onChange(removeTagMd(md, t))} title={`Remove #${t}`}
            className="ml-1 hidden text-[var(--dim)] hover:text-[var(--red)] group-hover:inline">
            ×
          </button>
        </span>
      ))}
      {open ? (
        <>
          <input
            autoFocus value={q} list="jarvis-all-tags"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") { setQ(""); setOpen(false); }
            }}
            onBlur={() => { setQ(""); setOpen(false); }}
            placeholder="tag-name"
            className="w-[110px] rounded-md border border-[var(--line)] bg-[var(--surf-2)] px-[7px] py-[3px] font-mono text-[9.5px] text-[var(--text)] outline-none placeholder:text-[var(--dim)] focus:border-[var(--green)]"
          />
          <datalist id="jarvis-all-tags">
            {all.filter((t) => !tags.includes(t)).map((t) => <option key={t} value={t} />)}
          </datalist>
        </>
      ) : (
        <button onClick={() => setOpen(true)}
          className="rounded-md border border-dashed border-[var(--line)] px-[7px] py-[3px] font-mono text-[9.5px] text-[var(--dim)] hover:border-[var(--green)] hover:text-[var(--green)]">
          + tag
        </button>
      )}
    </>
  );
}
