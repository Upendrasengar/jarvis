// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// The Actions ledger — every open action item, grouped under the call where
// it was incurred. Same transmission-node language as the chat log: each call
// group is a log entry; its outstanding items hang off the rail beneath it.
// Owners sit in a fixed lane so a vertical scan answers "who owes what";
// items older than a day carry an amber age tag.
import { Fragment, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { ActionItem } from "@jarvis/shared";
import { useActions, useToggleAction } from "./hooks";
import { PromptDialog } from "../../components/PromptDialog";
import { ago, parseStamp } from "../../lib/time";
import { buildClusters, idKey } from "../../lib/actionClusters";
import { attentionBucket, rankAttention, type Chip, type Ranked, type Triage } from "../../lib/attention";
import { useQuery } from "@tanstack/react-query";

import { useQueryClient } from "@tanstack/react-query";

type Who = "all" | "me" | "others";

// **bold** → <b>, XSS-safe (no innerHTML) — same treatment as NotesView
function inline(text: string) {
  return text.split(/\*\*([^*]+)\*\*/g).map((part, i) =>
    i % 2 ? <b key={i} className="text-[var(--bright)]">{part}</b> : <Fragment key={i}>{part}</Fragment>,
  );
}

function ageDays(callStarted: string): number {
  const d = new Date(callStarted.slice(0, 10) + "T12:00:00").getTime();
  return Math.max(0, Math.floor((Date.now() - d) / 86_400_000));
}


function ItemRow({ item, onToggle, onComment, recurringIn, chips }: { item: ActionItem; onToggle: () => void; onComment: () => void; recurringIn?: number; chips?: Chip[] }) {
  const age = ageDays(item.callStarted);
  return (
    <label className="group flex cursor-pointer items-start gap-3 rounded-lg py-[9px] pl-9 pr-3 font-sans text-[13px] leading-snug hover:bg-[var(--surf-2)]">
      <input type="checkbox" checked={item.done} onChange={onToggle} className="chk mt-[1px]" />
      <span className="min-w-0 flex-1">
        <span className={item.done ? "text-[var(--dim)] line-through" : "text-[var(--text)]"}>
          {item.owner ? `${item.owner}: ` : ""}
          {inline(item.text)}
          {chips?.slice(0, 1).map((c, k) => (
            <span key={k} className={`ml-2 text-[10px] font-medium ${c.kind === "overdue" ? "text-[var(--red)]" : "text-[var(--amber)]"}`}>
              {c.label}
            </span>
          ))}
        </span>
        {item.comments.map((c, i) => {
          const { when, text } = parseStamp(c);
          return (
            <span key={i} className="mt-[2px] block text-[11.5px] leading-snug text-[var(--dim)]">
              <span className="text-[var(--cyan-dim,#5b9ec4)]">↳</span> {inline(text)}
              {when && (
                <span className="ml-2 text-[9.5px] opacity-70" title={new Date(when).toLocaleString()}>
                  · {ago(when)}
                </span>
              )}
            </span>
          );
        })}
      </span>
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onComment(); }}
        title="Add a comment (context, resolution, reference)"
        className="invisible shrink-0 rounded-full border border-[var(--line)] px-2 py-[1px] text-[10px] text-[var(--dim)] hover:border-[var(--cyan)] hover:text-[var(--cyan)] group-hover:visible"
      >
        ＋
      </button>
      {recurringIn && recurringIn > 1 ? (
        <span title="This item was raised in multiple calls" className="mt-[2px] shrink-0 rounded-md border border-[var(--line)] px-[7px] py-[2px] text-[8.5px] tracking-[1px] text-[var(--dim)]">
          {recurringIn} CALLS
        </span>
      ) : null}
      {!item.done && age >= 1 && (
        <span className="mt-[2px] shrink-0 rounded-md border border-[var(--line)] px-[7px] py-[2px] text-[8.5px] tracking-[1px] text-[var(--dim)]">
          OPEN {age}D
        </span>
      )}
    </label>
  );
}

function CallGroup({ items, onToggle, onComment, clusterOf, chipsOf }: { items: ActionItem[]; onToggle: (i: ActionItem) => void; onComment: (i: ActionItem) => void; clusterOf?: (i: ActionItem) => number | undefined; chipsOf?: (i: ActionItem) => Chip[] | undefined }) {
  const head = items[0];
  const isNote = head.callId.startsWith("note:");
  return (
    <div className="mb-5">
      <div className="mb-1 flex items-center gap-2.5 border-b border-[var(--line)] pb-2">
        <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md bg-[var(--indigo-2)] text-[var(--indigo)]">
          <svg viewBox="0 0 24 24" className="h-[12px] w-[12px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
            {isNote
              ? <path d="M5 4h11l3 3v13H5z M8 10h8 M8 14h8" />
              : <path d="M6 4c0 8 6 14 14 14l1-4-4-1.5-1.5 1.5c-3-1.2-5.3-3.5-6.5-6.5L10.5 6 9 2z" />}
          </svg>
        </span>
        <Link
          to={isNote ? `/notes/${head.callId.slice(5)}` : `/calls/${head.callId}`}
          className="truncate font-sans text-[13px] font-semibold text-[var(--bright)] hover:text-[var(--cyan)]"
        >
          {head.callTitle || head.callId}
        </Link>
        <span className="ml-auto shrink-0 text-[10px] text-[var(--dim)]">
          {head.callStarted.slice(0, 10)} · {items.length} open
        </span>
      </div>
      {items.map((i) => (
        <ItemRow recurringIn={clusterOf?.(i)} chips={chipsOf?.(i)} key={`${i.callId}:${i.index}`} item={i} onToggle={() => onToggle(i)} onComment={() => onComment(i)} />
      ))}
    </div>
  );
}


// One flagged item as a full card — the design's "Needs attention" ledger.
// Title is the item text; the LLM triage reason (when present) is the
// description; the source line links back to the call/note it came from.
function AttentionCard({ r, onToggle }: { r: Ranked; onToggle: () => void }) {
  const it = r.item as ActionItem;
  const urgent = r.chips.find((c) => c.kind === "overdue" || c.kind === "due" || c.kind === "blocked");
  const hot = urgent && urgent.kind !== "blocked";
  const rest = r.chips.filter((c) => c !== urgent && c.kind !== "me").map((c) => c.label);
  const desc = r.reason || [it.owner && it.owner !== "Me" ? it.owner : "", ...rest].filter(Boolean).join(" · ");
  const chipLabel = urgent
    ? urgent.kind === "blocked" ? "BLOCKED" : urgent.label.split(" (")[0].toUpperCase()
    : "NO DATE";
  const isNote = it.callId.startsWith("note:");
  return (
    <div className={`mb-3 rounded-2xl border bg-[var(--surf)] p-4 [box-shadow:var(--shadow)] ${
      hot ? "border-[rgba(255,107,132,.45)] !bg-[rgba(255,107,132,.05)]" : "border-[var(--line)]"}`}>
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={false}
          onChange={onToggle}
          title={r.cluster.length > 1 ? `Check off in all ${r.cluster.length} sources` : "Check off"}
          className="chk mt-[2px]"
        />
        <div className="min-w-0 flex-1">
          <div className="font-sans text-[13.5px] font-semibold leading-snug text-[var(--bright)]">
            {it.text.replace(/\*\*/g, "")}
          </div>
          {desc && <div className="mt-1 font-sans text-[12px] leading-snug text-[var(--dim)]">{desc}</div>}
          <Link
            to={isNote ? `/notes/${it.callId.slice(5)}` : `/calls/${it.callId}`}
            className="mt-2 block truncate text-[10.5px] text-[var(--cyan)] hover:underline"
          >
            ↳ {isNote ? "note" : "call"} {it.callStarted.slice(0, 10)}{it.callTitle ? ` · ${it.callTitle}` : ""}
          </Link>
        </div>
        <span className={`shrink-0 rounded px-2 py-[2px] text-[9px] tracking-[1.5px] ${
          hot
            ? "border border-[rgba(255,107,132,.5)] bg-[rgba(255,107,132,.12)] text-[var(--red)]"
            : urgent
              ? "border border-[var(--line)] text-[var(--amber)]"
              : "border border-[var(--line)] text-[var(--dim)]"}`}>
          {chipLabel}
        </span>
      </div>
    </div>
  );
}

export function ActionsPage() {
  const { data: items = [], isLoading } = useActions();
  const clusterById = useMemo(() => buildClusters(items).byId, [items]);
  const { data: triage } = useQuery<Triage>({
    queryKey: ["triage"],
    queryFn: async () => (await fetch("/api/triage")).json(),
    staleTime: 60_000,
  });
  const attention = useMemo(() => rankAttention(items, triage), [items, triage]);
  const bucket = useMemo(() => attentionBucket(attention.ranked, 5), [attention]);
  const chipsById = useMemo(() => {
    const m = new Map<string, Chip[]>();
    for (const r of attention.ranked) {
      const urgent = r.chips.filter((c) => c.kind === "overdue" || c.kind === "due" || c.kind === "blocked");
      if (urgent.length) for (const a of r.cluster) m.set(idKey(a), urgent);
    }
    return m;
  }, [attention]);
  const toggle = useToggleAction();
  const [who, setWho] = useState<Who>("all");
  const [showDone, setShowDone] = useState(false);
  const [commentFor, setCommentFor] = useState<ActionItem | null>(null);
  const qc = useQueryClient();
  const addComment = (item: ActionItem, text: string) =>
    fetch("/api/actions/comment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callId: item.callId, index: item.index, text }),
    }).then(() => {
      qc.invalidateQueries({ queryKey: ["actions"] });
      qc.invalidateQueries({ queryKey: ["calls"] });
      qc.invalidateQueries({ queryKey: ["notes"] });
    });

  const open = useMemo(() => items.filter((i) => !i.done), [items]);
  const done = useMemo(() => items.filter((i) => i.done), [items]);
  const mineCount = open.filter((i) => i.owner === "Me").length;

  const visible = useMemo(
    () => open.filter((i) =>
      who === "all" ? true : who === "me" ? i.owner === "Me" : i.owner !== "Me"),
    [open, who],
  );

  // day → call → items, newest first (API is already sorted)
  const days = useMemo(() => {
    const byDay = new Map<string, Map<string, ActionItem[]>>();
    for (const i of visible) {
      const day = i.callStarted.slice(0, 10) || "unknown";
      if (!byDay.has(day)) byDay.set(day, new Map());
      const calls = byDay.get(day)!;
      if (!calls.has(i.callId)) calls.set(i.callId, []);
      calls.get(i.callId)!.push(i);
    }
    return byDay;
  }, [visible]);

  const doToggle = (i: ActionItem) => toggle.mutate({ callId: i.callId, index: i.index });

  if (isLoading)
    return <div className="mt-20 text-center text-xs text-[var(--dim)]">loading…</div>;

  const filters: Array<{ key: Who; name: string; count: number }> = [
    { key: "all", name: "All", count: open.length },
    { key: "me", name: "You owe", count: mineCount },
    { key: "others", name: "Others owe", count: open.length - mineCount },
  ];

  const srcCalls = new Set(open.filter((i) => !i.callId.startsWith("note:")).map((i) => i.callId)).size;
  const srcNotes = new Set(open.filter((i) => i.callId.startsWith("note:")).map((i) => i.callId)).size;
  const critical = bucket.filter((r) =>
    r.chips.some((c) => c.kind === "overdue" || c.kind === "due" || c.kind === "blocked")).length;

  return (
    <div className="flex h-full overflow-hidden">
      {/* ledger rail — filters live here now, one accent for the active one */}
      <aside className="w-[200px] shrink-0 space-y-7 overflow-auto border-r border-[var(--line)] bg-[var(--surf)] px-4 py-8">
        <div>
          <div className="mb-2 text-[9px] tracking-[2px] text-[var(--dim)]">LEDGER</div>
          {filters.map((f) => (
            <button
              key={f.key}
              onClick={() => setWho(f.key)}
              className={`mb-1 flex w-full items-center justify-between rounded-lg border px-3 py-[7px] font-sans text-[12px] ${
                who === f.key
                  ? "border-[var(--cyan-3)] bg-[var(--cyan-2)] text-[var(--cyan)]"
                  : "border-transparent text-[var(--dim)] hover:bg-[var(--surf-2)] hover:text-[var(--bright)]"}`}
            >
              <span>{f.name}</span>
              <span className="text-[10.5px] opacity-80">{f.count}</span>
            </button>
          ))}
        </div>
        <div>
          <div className="mb-2 text-[9px] tracking-[2px] text-[var(--dim)]">SOURCE</div>
          <div className="space-y-[5px] font-sans text-[11.5px] text-[var(--dim)]">
            <div>Calls · {srcCalls}</div>
            <div>Notes · {srcNotes}</div>
            <div>Digest triage · {bucket.length}</div>
          </div>
        </div>
      </aside>

      {/* the ledger itself */}
      <div className="min-w-0 flex-1 overflow-auto px-8 py-8">
        <div className="mx-auto max-w-[760px]">
          <h1 className="text-2xl font-semibold text-[var(--bright)] [font-family:var(--display)]">Actions</h1>
          <p className="mb-6 mt-1 font-sans text-xs text-[var(--dim)]">
            Every open item from your recorded calls. Checking one updates the call's notes and your vault.
          </p>

          {visible.length === 0 && (
            <div className="mt-16 text-center font-sans text-sm text-[var(--dim)]">
              {who === "me" ? "You owe nothing. Enjoy it while it lasts." : "Ledger clear — nothing outstanding."}
            </div>
          )}

          {who === "all" && bucket.length > 0 && (
            <>
              <div className="mb-3 flex items-center gap-3">
                <h2 className="font-sans text-[15px] font-semibold text-[var(--bright)]">Needs attention</h2>
                {critical > 0 && (
                  <span className="rounded border border-[rgba(255,107,132,.5)] px-2 py-[2px] text-[9px] tracking-[2px] text-[var(--red)]">
                    {critical} CRITICAL
                  </span>
                )}
              </div>
              <div className="mb-8">
                {bucket.map((r) => (
                  <AttentionCard key={idKey(r.item)} r={r} onToggle={() => r.cluster.forEach((a) => doToggle(a as ActionItem))} />
                ))}
              </div>
            </>
          )}

          {[...days.entries()].map(([day, calls]) => (
            <section key={day} className="mb-2">
              {[...calls.values()].map((group) => (
                <CallGroup chipsOf={(a) => chipsById.get(idKey(a))} clusterOf={(a) => clusterById.get(idKey(a))?.items.length} key={group[0].callId} items={group} onToggle={doToggle} onComment={setCommentFor} />
              ))}
            </section>
          ))}

          {done.length > 0 && (
            <details
              className="mt-10 border-t border-[var(--line)] pt-3"
              open={showDone}
              onToggle={(e) => setShowDone((e.target as HTMLDetailsElement).open)}
            >
              <summary className="cursor-pointer text-[10px] uppercase tracking-[1.5px] text-[var(--dim)]">
                settled · {done.length}
              </summary>
              <div className="mt-2 opacity-60">
                {done.map((i) => (
                  <ItemRow key={`${i.callId}:${i.index}`} item={i} onToggle={() => doToggle(i)} onComment={() => setCommentFor(i)} />
                ))}
              </div>
            </details>
          )}
        </div>
      </div>

      <PromptDialog
        open={!!commentFor}
        title="Add comment"
        placeholder="Context, resolution, reference\u2026"
        submitLabel="ADD"
        onSubmit={(text) => commentFor && addComment(commentFor, text)}
        onClose={() => setCommentFor(null)}
      />
    </div>
  );
}
