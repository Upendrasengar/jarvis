// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// The chat page's right rail: CONTEXT IN PLAY (what the last answer actually
// drew on — enriched from the SOURCES line via APIs we already serve) and
// TRY NEXT (deterministic follow-ups derived from live state: next meeting,
// top attention item, last call with open items). No extra LLM calls —
// everything here is grounded in data the server already has.
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import * as S from "@jarvis/shared";
import { callTitle, useCalls } from "../calls/hooks";
import { attentionBucket, rankAttention, type Triage } from "../../lib/attention";

function agoMs(ms: number): string {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

type Src = { to: string; kind: "call" | "note" };

export function ContextRail({ sources, onAsk }: { sources: Src[]; onAsk: (t: string) => void }) {
  const { data: calls = [] } = useCalls();
  const { data: notes = [] } = useQuery({
    queryKey: ["notes"],
    queryFn: async () => S.NoteMeta.array().parse(await (await fetch("/api/notes")).json()),
  });
  const { data: cal } = useQuery<{ enabled: boolean; events: any[] }>({
    queryKey: ["calendar"],
    queryFn: async () => (await fetch("/api/calendar")).json(),
    staleTime: 60_000,
  });
  const { data: actions = [] } = useQuery({
    queryKey: ["actions"],
    queryFn: async () => S.ActionItem.array().parse(await (await fetch("/api/actions")).json()),
  });
  const { data: triage } = useQuery<Triage>({
    queryKey: ["triage"],
    queryFn: async () => (await fetch("/api/triage")).json(),
    staleTime: 60_000,
  });

  const ctx = sources.slice(0, 5).map((s) => {
    const id = decodeURIComponent(s.to.split("/").pop() ?? "");
    if (s.kind === "call") {
      const c = calls.find((x) => x.id === id);
      const open = c ? (c.notes.match(/^- \[ \] /gm) ?? []).length : 0;
      return {
        kind: "CALL", kcls: "text-[var(--cyan)]", to: s.to, title: id,
        sub: c ? `${callTitle(c).slice(0, 34)}${open ? ` · ${open} open` : ""}` : "",
      };
    }
    const n = notes.find((x) => x.id === id);
    return {
      kind: "NOTE", kcls: "text-[var(--indigo)]", to: s.to,
      title: (n?.title ?? id).slice(0, 30),
      sub: n ? `${agoMs(n.updated)}${n.openItems ? ` · ${n.openItems} open` : ""}` : "",
    };
  });

  const suggestions = useMemo(() => {
    const out: string[] = [];
    const next = (cal?.events ?? []).find((e) => Date.parse(e.start) > Date.now());
    if (next?.subject) out.push(`Prep me for "${String(next.subject).slice(0, 44)}"`);
    const top = attentionBucket(rankAttention(actions, triage).ranked, 1)[0];
    if (top) out.push(`What's the latest on "${top.item.text.replace(/\*\*/g, "").slice(0, 48)}"?`);
    const openCall = calls.find((c) => (c.notes.match(/^- \[ \] /gm) ?? []).length > 0);
    if (openCall) out.push(`Summarize the open items from "${callTitle(openCall).slice(0, 40)}"`);
    return out.slice(0, 3);
  }, [cal, actions, triage, calls]);

  return (
    <>
      <div className="mb-2 text-[9px] tracking-[2px] text-[var(--dim)]">CONTEXT IN PLAY</div>
      {ctx.length ? (
        ctx.map((c, i) => (
          <Link
            key={i}
            to={c.to}
            className="mb-2 block rounded-xl border border-[var(--line)] bg-[var(--surf)] px-3 py-[9px] no-underline transition [box-shadow:var(--shadow)] hover:border-[var(--cyan-3)]"
          >
            <span className={`block text-[8.5px] tracking-[1.8px] ${c.kcls}`}>{c.kind}</span>
            <span className="mt-[2px] block truncate font-sans text-[12px] font-semibold text-[var(--bright)]">
              {c.title}
            </span>
            {c.sub && <span className="mt-[1px] block truncate text-[9.5px] text-[var(--dim)]">{c.sub}</span>}
          </Link>
        ))
      ) : (
        <p className="mb-2 font-sans text-[11px] leading-relaxed text-[var(--dim)]">
          When an answer draws on your calls or notes, its sources appear here.
        </p>
      )}

      {suggestions.length > 0 && (
        <>
          <div className="mb-2 mt-6 text-[9px] tracking-[2px] text-[var(--dim)]">TRY NEXT</div>
          {suggestions.map((t, i) => (
            <button
              key={i}
              onClick={() => onAsk(t)}
              className="mb-2 block w-full rounded-xl border border-[var(--line)] bg-[var(--surf)] px-3 py-[9px] text-left font-sans text-[11.5px] leading-snug text-[var(--text)] transition [box-shadow:var(--shadow)] hover:border-[var(--cyan-3)] hover:text-[var(--cyan)]"
            >
              {t}
            </button>
          ))}
        </>
      )}
    </>
  );
}
