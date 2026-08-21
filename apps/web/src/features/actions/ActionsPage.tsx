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
import { attentionBucket, rankAttention, type Chip, type Triage } from "../../lib/attention";
import { useQuery } from "@tanstack/react-query";

const CHIP_STYLE: Record<string, string> = {
  overdue: "border-[rgba(255,92,122,.5)] text-[var(--red)]",
  due: "border-[rgba(255,207,92,.5)] text-[var(--amber)]",
  blocked: "border-[rgba(255,207,92,.5)] text-[var(--amber)]",
};
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

function OwnerLane({ owner }: { owner: string }) {
  const mine = owner === "Me";
  return (
    <span
      className={`w-[86px] shrink-0 truncate rounded-full border px-2 py-[2px] text-center text-[9px] tracking-wider ${
        mine
          ? "border-[rgba(57,215,255,.4)] bg-[rgba(57,215,255,.07)] text-[var(--cyan)]"
          : owner
            ? "border-[var(--line)] text-[var(--dim)]"
            : "border-transparent text-[var(--dim)]"
      }`}
      title={owner || "no owner recorded"}
    >
      {owner || "—"}
    </span>
  );
}

function ItemRow({ item, onToggle, onComment, recurringIn, chips }: { item: ActionItem; onToggle: () => void; onComment: () => void; recurringIn?: number; chips?: Chip[] }) {
  const age = ageDays(item.callStarted);
  return (
    <label className="group flex cursor-pointer items-start gap-3 rounded-lg py-[7px] pl-6 pr-3 font-sans text-[13px] leading-snug hover:bg-[rgba(57,215,255,.05)]">
      <input
        type="checkbox"
        checked={item.done}
        onChange={onToggle}
        className="mt-[2px] cursor-pointer accent-[var(--cyan)]"
      />
      <OwnerLane owner={item.owner} />
      <span className="min-w-0 flex-1">
        <span className={item.done ? "text-[var(--dim)] line-through" : "text-[var(--text)]"}>
          {inline(item.text)}
          {chips?.slice(0, 1).map((c, k) => (
            <span key={k} className={`ml-2 text-[10px] font-medium ${c.kind === "overdue" ? "text-[var(--red)]" : "text-[var(--amber)]"}`}>
              {c.label}
            </span>
          ))}
          {recurringIn && recurringIn > 1 ? (
            <span
              title="This item was raised in multiple calls"
              className="ml-2 rounded-full border border-[rgba(255,207,92,.4)] px-[7px] py-[1px] text-[9.5px] text-[var(--amber)]"
            >
              ⟳ {recurringIn} calls
            </span>
          ) : null}
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
      {!item.done && age >= 1 && (
        <span className="shrink-0 rounded-full border border-[rgba(255,207,92,.35)] px-[7px] py-[1px] text-[9px] text-[var(--amber)]">
          {age}d
        </span>
      )}
    </label>
  );
}

function CallGroup({ items, onToggle, onComment, clusterOf, chipsOf }: { items: ActionItem[]; onToggle: (i: ActionItem) => void; onComment: (i: ActionItem) => void; clusterOf?: (i: ActionItem) => number | undefined; chipsOf?: (i: ActionItem) => Chip[] | undefined }) {
  const head = items[0];
  return (
    <div className="relative mb-4 pl-6">
      {/* transmission node + rail — this group came in over the channel */}
      <span className="absolute left-[7px] top-[6px] h-[7px] w-[7px] rounded-full bg-[var(--cyan)] shadow-[0_0_10px_var(--cyan)]" />
      <span className="absolute bottom-1 left-[10px] top-[18px] w-px bg-[rgba(57,215,255,.12)]" />
      <div className="mb-1 flex items-baseline gap-3">
        <Link
          to={head.callId.startsWith("note:") ? `/notes/${head.callId.slice(5)}` : `/calls/${head.callId}`}
          className="truncate font-sans text-[13px] font-semibold text-[var(--bright)] hover:text-[var(--cyan)]"
        >
          {head.callTitle || head.callId}
        </Link>
        <span className="shrink-0 text-[10px] text-[var(--dim)]">
          {head.callStarted.slice(11, 16)} · {items.length} open
        </span>
      </div>
      {items.map((i) => (
        <ItemRow recurringIn={clusterOf?.(i)} chips={chipsOf?.(i)} key={`${i.callId}:${i.index}`} item={i} onToggle={() => onToggle(i)} onComment={() => onComment(i)} />
      ))}
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

  const filters: Array<{ key: Who; label: string }> = [
    { key: "all", label: `All ${open.length}` },
    { key: "me", label: `You owe ${mineCount}` },
    { key: "others", label: `Others owe ${open.length - mineCount}` },
  ];

  return (
    <div className="mx-auto h-full max-w-[860px] overflow-auto px-6 py-8">
      <div className="mb-1 flex items-baseline justify-between">
        <h1 className="font-sans text-2xl text-[var(--bright)]">Actions</h1>
        <span className="text-[10px] uppercase tracking-[2px] text-[var(--dim)]">
          from {new Set(open.map((i) => i.callId)).size} calls
        </span>
      </div>
      <p className="mb-5 font-sans text-xs text-[var(--dim)]">
        Every open item from your recorded calls. Checking one updates the call's notes and your vault.
      </p>

      <div className="mb-7 flex gap-2">
        {filters.map((f) => (
          <button
            key={f.key}
            onClick={() => setWho(f.key)}
            className={`rounded-full border px-3 py-1 font-sans text-[11px] ${
              who === f.key
                ? "border-[rgba(57,215,255,.4)] bg-[rgba(57,215,255,.08)] text-[var(--cyan)]"
                : "border-[var(--line)] text-[var(--dim)] hover:text-[var(--bright)]"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {visible.length === 0 && (
        <div className="mt-16 text-center font-sans text-sm text-[var(--dim)]">
          {who === "me" ? "You owe nothing. Enjoy it while it lasts." : "Ledger clear — nothing outstanding."}
        </div>
      )}

      {who === "all" && bucket.length > 0 && (
        <div className="mb-6 rounded-xl border border-[var(--line)] bg-[var(--chipbg)] p-3">
          <div className="mb-2 text-[10px] tracking-[2px] text-[var(--amber)]">NEEDS ATTENTION</div>
          {bucket.map((r) => {
            const urgent = r.chips.find((c) => c.kind === "overdue" || c.kind === "due" || c.kind === "blocked");
            const rest = r.chips.filter((c) => c !== urgent && c.kind !== "me").map((c) => c.label);
            return (
              <div key={idKey(r.item)} className="mb-1.5 flex items-start gap-2 font-sans text-[12.5px]">
                <button
                  onClick={() => r.cluster.forEach((a) => doToggle(a as ActionItem))}
                  title={r.cluster.length > 1 ? `Check off in all ${r.cluster.length} sources` : "Check off"}
                  className="cursor-pointer text-[var(--cyan)]"
                >☐</button>
                <span className="min-w-0 flex-1">
                  <b className="text-[var(--bright)]">{r.item.owner}:</b> {r.item.text.replace(/\*\*/g, "")}
                  <span className="ml-2 text-[10.5px] text-[var(--dim)]">
                    {urgent && (
                      <span className={`font-medium ${urgent.kind === "overdue" ? "text-[var(--red)]" : "text-[var(--amber)]"}`}>
                        {urgent.label}
                      </span>
                    )}
                    {urgent && rest.length > 0 && " · "}
                    {rest.join(" · ")}
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      )}
      {[...days.entries()].map(([day, calls]) => (
        <section key={day} className="mb-6">
          <div className="mb-2 text-[9px] uppercase tracking-[2px] text-[var(--dim)]">{day}</div>
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
      <PromptDialog
        open={!!commentFor}
        title="Add comment"
        placeholder="Context, resolution, reference…"
        submitLabel="ADD"
        onSubmit={(text) => commentFor && addComment(commentFor, text)}
        onClose={() => setCommentFor(null)}
      />
    </div>
  );
}
