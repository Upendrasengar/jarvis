// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// Header search — calls, notes, actions. Client-side over the cached lists
// (everything is local anyway); ⌘K focuses, Esc closes, Enter opens the top
// hit. Deliberately no LLM: this is a finder, not an answerer — asking is
// what the chat page is for.
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import * as S from "@jarvis/shared";
import { callTitle, useCalls } from "../features/calls/hooks";

type Hit = { kind: "call" | "note" | "action"; glyph: string; label: string; sub: string; to: string };

export function SearchBar() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const { data: calls = [] } = useCalls();
  const { data: notes = [] } = useQuery({
    queryKey: ["notes"],
    queryFn: async () => S.NoteMeta.array().parse(await (await fetch("/api/notes")).json()),
  });
  const { data: actions = [] } = useQuery({
    queryKey: ["actions"],
    queryFn: async () => S.ActionItem.array().parse(await (await fetch("/api/actions")).json()),
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // capture phase + code-based match: fires even when focus sits in an
      // input/contentEditable, and beats any handler that stops propagation
      if ((e.metaKey || e.ctrlKey) && (e.key.toLowerCase() === "k" || e.code === "KeyK")) {
        e.preventDefault();
        e.stopPropagation();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const hits = useMemo<Hit[]>(() => {
    const needle = q.trim().toLowerCase();
    if (needle.length < 2) return [];
    const out: Hit[] = [];
    for (const c of calls) {
      if (out.filter((h) => h.kind === "call").length >= 4) break;
      const title = callTitle(c);
      if (title.toLowerCase().includes(needle) || c.id.includes(needle))
        out.push({ kind: "call", glyph: "☎", label: title.slice(0, 52), sub: c.started.slice(0, 16), to: `/calls/${c.id}` });
    }
    for (const n of notes) {
      if (out.filter((h) => h.kind === "note").length >= 3) break;
      if (n.title.toLowerCase().includes(needle))
        out.push({ kind: "note", glyph: "◇", label: n.title.slice(0, 52), sub: "note", to: `/notes/${n.id}` });
    }
    for (const a of actions) {
      if (out.filter((h) => h.kind === "action").length >= 3) break;
      if (!a.done && a.text.toLowerCase().includes(needle))
        out.push({
          kind: "action", glyph: "⚡",
          label: `${a.owner ? a.owner + ": " : ""}${a.text.replace(/\*\*/g, "")}`.slice(0, 52),
          sub: "open action", to: "/actions",
        });
    }
    return out.slice(0, 8);
  }, [q, calls, notes, actions]);

  const go = (h: Hit) => {
    setOpen(false);
    setQ("");
    navigate(h.to);
  };

  return (
    <div ref={boxRef} className="relative w-[300px]">
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); setSel(0); }}
        onFocus={() => q.trim().length >= 2 && setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") { setOpen(false); (e.target as HTMLElement).blur(); }
          if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, hits.length - 1)); }
          if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
          if (e.key === "Enter" && hits[sel]) go(hits[sel]);
        }}
        placeholder="Search calls, notes, actions"
        className="w-full rounded-lg border border-[var(--line)] bg-[var(--surf-2)] py-[7px] pl-3 pr-9 font-sans text-[12px] text-[var(--text)] outline-none placeholder:text-[var(--dim)] focus:border-[var(--cyan-3)]"
      />
      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-[var(--line)] px-[5px] py-[1px] text-[8.5px] text-[var(--dim)]">
        ⌘K
      </span>
      {open && hits.length > 0 && (
        <div className="absolute left-0 right-0 top-[38px] z-50 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surf)] py-1 shadow-lg">
          {hits.map((h, i) => (
            <button
              key={i}
              onClick={() => go(h)}
              onMouseEnter={() => setSel(i)}
              className={`flex w-full items-center gap-2 px-3 py-[6px] text-left ${i === sel ? "bg-[var(--surf-2)]" : ""}`}
            >
              <span className={`w-4 text-[11px] ${h.kind === "call" ? "text-[var(--cyan)]" : h.kind === "note" ? "text-[var(--indigo)]" : "text-[var(--amber)]"}`}>
                {h.glyph}
              </span>
              <span className="min-w-0 flex-1 truncate font-sans text-[12px] text-[var(--text)]">{h.label}</span>
              <span className="shrink-0 text-[9px] text-[var(--dim)]">{h.sub}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
