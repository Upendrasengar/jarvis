// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// The Actions ledger — every open action item, grouped under the call where
// it was incurred. Same transmission-node language as the chat log: each call
// group is a log entry; its outstanding items hang off the rail beneath it.
// Urgency reads in one language everywhere on the page: a coloured dot from
// TONE, matching the rail on the "needs attention" cards above.
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { ActionItem } from "@jarvis/shared";
import { useActions, useToggleAction } from "./hooks";
import { CommentPopover } from "../../components/CommentPopover";
import { ago, clock, dayLabel, daysAgo, fullStamp, parseStamp } from "../../lib/time";
import { buildClusters, idKey } from "../../lib/actionClusters";
import { attentionBucket, rankAttention, type Chip, type Ranked, type Triage } from "../../lib/attention";
import { useQuery } from "@tanstack/react-query";

import { useQueryClient } from "@tanstack/react-query";

type Who = "all" | "me" | "others";

const SETTLED_PAGE = 7;   // days of settled history per page

// Criticality reads as a left rail + a matching dot on the date, not as a
// red card. Tinting the whole card made four of five items red at once,
// which flattened the ranking and looked like an error state; a 3px rail
// keeps the tiers distinguishable while the ledger stays calm.
const TONE: Record<string, { rail: string; ink: string }> = {
  overdue: { rail: "var(--red)", ink: "var(--red)" },
  due: { rail: "var(--amber)", ink: "var(--amber)" },
  blocked: { rail: "var(--indigo)", ink: "var(--indigo)" },
  none: { rail: "var(--line-2)", ink: "var(--dim)" },
};


// **bold** → <b>, XSS-safe (no innerHTML) — same treatment as NotesView
function inline(text: string) {
  return text.split(/\*\*([^*]+)\*\*/g).map((part, i) =>
    i % 2 ? <b key={i} className="text-[var(--bright)]">{part}</b> : <Fragment key={i}>{part}</Fragment>,
  );
}

// day → call → items. `dayOf` picks the axis: the open ledger groups by when
// the call happened, the settled one by when the item was checked off (falling
// back to the call for everything settled before stamping existed).
function groupByDay(items: ActionItem[], dayOf: (i: ActionItem) => string) {
  const byDay = new Map<string, Map<string, ActionItem[]>>();
  for (const i of items) {
    const day = dayOf(i).slice(0, 10) || "unknown";
    if (!byDay.has(day)) byDay.set(day, new Map());
    const calls = byDay.get(day)!;
    if (!calls.has(i.callId)) calls.set(i.callId, []);
    calls.get(i.callId)!.push(i);
  }
  return new Map([...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0])));
}

// A day heading for either ledger. Not sticky in the settled drawer — that
// list is collapsed by default and read in bursts, not scrolled through.
function DayHeading({ day, count, sources, noun, tone = "text-[var(--bright)]" }: { day: string; count: number; sources: number; noun: string; tone?: string }) {
  return (
    <>
      <h3 className={`shrink-0 font-sans text-[12.5px] font-semibold ${tone}`} title={fullStamp(day)}>
        {dayLabel(day)}
      </h3>
      <span className="shrink-0 text-[9.5px] tracking-[1.5px] text-[var(--dim)]">
        {count} {noun} · {sources} {sources === 1 ? "SOURCE" : "SOURCES"}
      </span>
      <span className="h-px flex-1 bg-[var(--line)]" />
      {daysAgo(day) && (
        <span className="shrink-0 text-[9.5px] tracking-[1px] text-[var(--dim)]">{daysAgo(day)}</span>
      )}
    </>
  );
}

function ItemRow({ item, onToggle, onComment, recurringIn, chips, held, commenting }: { item: ActionItem; onToggle: () => void; onComment: (rect: DOMRect) => void; recurringIn?: number; chips?: Chip[]; held?: boolean; commenting?: boolean }) {
  return (
    <div className={`group flex items-start gap-3 rounded-lg py-[9px] pl-9 pr-3 font-sans text-[13px] leading-snug ${
      commenting
        ? "bg-[var(--cyan-2)] [box-shadow:inset_0_0_0_1px_var(--cyan-3)]"
        : "hover:bg-[var(--surf-2)]"}`}>
      <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3">
      <input type="checkbox" checked={item.done} onChange={onToggle} className="chk mt-[1px]" />
      <span className="min-w-0 flex-1">
        <span className={item.done ? "text-[var(--dim)] line-through" : "text-[var(--text)]"}>
          {item.owner ? `${item.owner}: ` : ""}
          {inline(item.text)}
          {chips?.slice(0, 1).map((c, k) => {
            const t = TONE[c.kind] ?? TONE.none;
            return (
              <span key={k} className="ml-2 whitespace-nowrap text-[10px] font-medium" style={{ color: t.ink }}>
                <span aria-hidden className="mr-1 inline-block h-[5px] w-[5px] rounded-full align-middle" style={{ background: t.rail }} />
                {c.label}
              </span>
            );
          })}
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
      </label>
      <button
        onClick={(e) => onComment(e.currentTarget.getBoundingClientRect())}
        title="Add a comment (context, resolution, reference)"
        className={`shrink-0 rounded-full border px-2 py-[1px] text-[10px] ${
          commenting
            ? "border-[var(--cyan)] text-[var(--cyan)]"
            : "invisible border-[var(--line)] text-[var(--dim)] hover:border-[var(--cyan)] hover:text-[var(--cyan)] group-hover:visible group-focus-within:visible"}`}
      >
        ＋
      </button>
      {recurringIn && recurringIn > 1 ? (
        <span title="This item was raised in multiple calls" className="mt-[3px] shrink-0 text-[9px] tracking-[1px] text-[var(--dim)]">
          ×{recurringIn}
        </span>
      ) : null}
      {item.done && item.doneAt && !held && (
        <span
          title={`Settled ${fullStamp(item.doneAt)}`}
          className="mt-[3px] shrink-0 text-[9px] tracking-[1px] text-[var(--dim)]"
        >
          {clock(item.doneAt) || "SETTLED"}
        </span>
      )}
      {held && (
        <button
          onClick={onToggle}
          title="Put this back on the ledger"
          className="mt-[1px] shrink-0 rounded-md border border-[var(--cyan-3)] px-[7px] py-[2px] text-[8.5px] tracking-[1px] text-[var(--cyan)] hover:bg-[var(--cyan-2)]"
        >
          UNDO
        </button>
      )}
    </div>
  );
}

function CallGroup({ items, onToggle, onComment, clusterOf, chipsOf, heldKeys, settled, commentingKey }: { items: ActionItem[]; onToggle: (i: ActionItem) => void; onComment: (i: ActionItem, rect: DOMRect) => void; clusterOf?: (i: ActionItem) => number | undefined; chipsOf?: (i: ActionItem) => Chip[] | undefined; heldKeys?: Set<string>; settled?: boolean; commentingKey?: string }) {
  const head = items[0];
  const stillOpen = items.filter((i) => !i.done).length;
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
        <span className="ml-auto shrink-0 font-sans text-[10.5px] text-[var(--dim)]" title={fullStamp(head.callStarted)}>
          {clock(head.callStarted) || dayLabel(head.callStarted)} ·{" "}
          {settled ? `${items.length} settled` : `${stillOpen} open`}
        </span>
      </div>
      {items.map((i) => (
        <ItemRow recurringIn={clusterOf?.(i)} chips={chipsOf?.(i)} held={heldKeys?.has(idKey(i))} commenting={commentingKey === idKey(i)} key={`${i.callId}:${i.index}`} item={i} onToggle={() => onToggle(i)} onComment={(rect) => onComment(i, rect)} />
      ))}
    </div>
  );
}


// One flagged item as a full card — the design's "Needs attention" ledger.
// Title is the item text; the LLM triage reason (when present) is the
// description; the source line links back to the call/note it came from.
function AttentionCard({ r, onToggle, held }: { r: Ranked; onToggle: () => void; held?: boolean }) {
  const it = r.item as ActionItem;
  const urgent = r.chips.find((c) => c.kind === "overdue" || c.kind === "due" || c.kind === "blocked");
  const rest = r.chips.filter((c) => c !== urgent && c.kind !== "me").map((c) => c.label);
  const desc = r.reason || [it.owner && it.owner !== "Me" ? it.owner : "", ...rest].filter(Boolean).join(" · ");
  const chipLabel = urgent
    ? urgent.kind === "blocked" ? "BLOCKED" : urgent.label.split(" (")[0].toUpperCase()
    : "NO DATE";
  const tone = held ? null : TONE[urgent?.kind ?? "none"];
  const isNote = it.callId.startsWith("note:");
  return (
    <div className={`relative mb-3 overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surf)] p-4 pl-5 transition-opacity [box-shadow:var(--shadow)] ${
      held ? "opacity-50" : ""}`}>
      {tone && <span aria-hidden className="absolute inset-y-0 left-0 w-[3px]" style={{ background: tone.rail }} />}
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={!!held}
          onChange={onToggle}
          title={held ? "Put this back on the ledger" : r.cluster.length > 1 ? `Check off in all ${r.cluster.length} sources` : "Check off"}
          className="chk mt-[2px]"
        />
        <div className="min-w-0 flex-1">
          <div className={`font-sans text-[13.5px] font-semibold leading-snug ${held ? "text-[var(--dim)] line-through" : "text-[var(--bright)]"}`}>
            {it.text.replace(/\*\*/g, "")}
          </div>
          {desc && <div className="mt-1 font-sans text-[12px] leading-snug text-[var(--dim)]">{desc}</div>}
          <Link
            to={isNote ? `/notes/${it.callId.slice(5)}` : `/calls/${it.callId}`}
            className="mt-2 block truncate text-[10.5px] text-[var(--cyan)] hover:underline"
            title={fullStamp(it.callStarted)}
          >
            ↳ {isNote ? "note" : "call"} · {dayLabel(it.callStarted)}
            {clock(it.callStarted) ? ` ${clock(it.callStarted)}` : ""}
            {it.callTitle ? ` · ${it.callTitle}` : ""}
          </Link>
        </div>
        <span
          className="mt-[2px] flex shrink-0 items-center gap-1.5 text-[9px] font-medium tracking-[1.5px]"
          style={{ color: tone ? tone.ink : "var(--dim)" }}
        >
          {tone && <span aria-hidden className="h-[5px] w-[5px] rounded-full" style={{ background: tone.rail }} />}
          {chipLabel}
        </span>
      </div>
    </div>
  );
}

export function ActionsPage() {
  const { data: items = [], isLoading } = useActions();
  // Items checked off in this sitting. They stay exactly where they were —
  // struck through, with an undo — instead of vanishing and yanking every
  // row below them upward. Cleared on navigate away or reload, at which
  // point they settle into the Settled drawer like anything else.
  const [heldKeys, setHeldKeys] = useState<Set<string>>(() => new Set<string>());
  const clusterById = useMemo(() => buildClusters(items).byId, [items]);
  const { data: triage } = useQuery<Triage>({
    queryKey: ["triage"],
    queryFn: async () => (await fetch("/api/triage")).json(),
    staleTime: 60_000,
  });
  const attnInput = useMemo(
    () => (heldKeys.size ? items.map((i) => (heldKeys.has(idKey(i)) ? { ...i, done: false } : i)) : items),
    [items, heldKeys],
  );
  const attention = useMemo(() => rankAttention(attnInput, triage), [attnInput, triage]);
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
  const [commentFor, setCommentFor] = useState<{ item: ActionItem; rect: DOMRect } | null>(null);
  const openComment = (item: ActionItem, rect: DOMRect) => setCommentFor({ item, rect });
  const commentingKey = commentFor ? idKey(commentFor.item) : undefined;
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

  // `open` drives the rail counts and so must tell the truth; `shown` is what
  // the ledger renders, which additionally keeps just-checked rows in place.
  const open = useMemo(() => items.filter((i) => !i.done), [items]);
  const shown = useMemo(() => items.filter((i) => !i.done || heldKeys.has(idKey(i))), [items, heldKeys]);
  const done = useMemo(() => items.filter((i) => i.done && !heldKeys.has(idKey(i))), [items, heldKeys]);
  const mineCount = open.filter((i) => i.owner === "Me").length;

  const visible = useMemo(
    () => shown.filter((i) =>
      who === "all" ? true : who === "me" ? i.owner === "Me" : i.owner !== "Me"),
    [shown, who],
  );

  const days = useMemo(() => groupByDay(visible, (i) => i.callStarted), [visible]);
  const settledDays = useMemo(
    () => groupByDay(done, (i) => i.doneAt || i.callStarted), [done]);
  // 733 settled rows would all mount the moment the drawer opens
  const [settledShown, setSettledShown] = useState(SETTLED_PAGE);

  // A sticky header can't be styled on its stuck state in CSS, so the ledger
  // tracks it. Without this every day header looks identical and the pinned
  // one is indistinguishable from the three inert ones further down the
  // viewport — which is what made it read as "rarely visible".
  const scrollRef = useRef<HTMLDivElement>(null);
  const [stuckDay, setStuckDay] = useState("");
  useEffect(() => {
    const sc = scrollRef.current;
    if (!sc) return;
    let raf = 0;
    const measure = () => {
      raf = 0;
      const top = Math.round(sc.getBoundingClientRect().top) + 1;
      let cur = "";
      for (const el of sc.querySelectorAll<HTMLElement>("[data-day]"))
        if (Math.round(el.getBoundingClientRect().top) <= top) cur = el.dataset.day ?? "";
      setStuckDay(cur);
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(measure); };
    measure();
    sc.addEventListener("scroll", onScroll, { passive: true });
    return () => { sc.removeEventListener("scroll", onScroll); if (raf) cancelAnimationFrame(raf); };
  }, [days]);

  const doToggle = (i: ActionItem) => {
    const k = idKey(i);
    setHeldKeys((prev) => {
      const next = new Set(prev);
      if (i.done) next.delete(k);
      else next.add(k);
      return next;
    });
    toggle.mutate({ callId: i.callId, index: i.index });
  };

  const toggleCluster = (r: Ranked) => {
    const isHeld = heldKeys.has(idKey(r.item));
    for (const a of r.cluster) doToggle({ ...(a as ActionItem), done: isHeld });
  };

  if (isLoading)
    return <div className="mt-20 text-center text-xs text-[var(--dim)]">loading…</div>;

  const filters: Array<{ key: Who; name: string; count: number }> = [
    { key: "all", name: "All", count: open.length },
    { key: "me", name: "You owe", count: mineCount },
    { key: "others", name: "Others owe", count: open.length - mineCount },
  ];

  const srcCalls = new Set(open.filter((i) => !i.callId.startsWith("note:")).map((i) => i.callId)).size;
  const srcNotes = new Set(open.filter((i) => i.callId.startsWith("note:")).map((i) => i.callId)).size;
  // Counted per tier, not lumped into one "critical" number — an overdue
  // item and a blocker aren't the same kind of problem.
  const tiers = (["overdue", "due", "blocked"] as const)
    .map((kind) => ({ kind, n: bucket.filter((r) => r.chips.some((c) => c.kind === kind)).length }))
    .filter((t) => t.n > 0);

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
      <div ref={scrollRef} className="min-w-0 flex-1 overflow-auto px-8 pb-8">
        <div className="mx-auto max-w-[760px] pt-8">
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
                {tiers.map((t) => (
                  <span key={t.kind} className="flex items-center gap-1.5 text-[10px] tracking-[1px] text-[var(--dim)]">
                    <span aria-hidden className="h-[5px] w-[5px] rounded-full" style={{ background: TONE[t.kind].rail }} />
                    {t.n} {t.kind}
                  </span>
                ))}
              </div>
              <div className="mb-8">
                {bucket.map((r) => (
                  <AttentionCard
                    key={idKey(r.item)}
                    r={r}
                    held={heldKeys.has(idKey(r.item))}
                    onToggle={() => toggleCluster(r)}
                  />
                ))}
              </div>
            </>
          )}

          {[...days.entries()].map(([day, calls]) => {
            const dayOpen = [...calls.values()].reduce(
              (t, g) => t + g.filter((i) => !i.done).length, 0);
            return (
              <section key={day} className="mb-2">
                <div
                  data-day={day}
                  className={`sticky top-0 z-20 -mx-4 mb-3 flex items-center gap-2.5 border-b bg-[var(--bg)] px-4 py-2.5 ${
                    stuckDay === day
                      ? "border-[var(--line-2)] [box-shadow:0_12px_20px_-18px_rgba(0,0,0,.95)]"
                      : "border-transparent"}`}
                >
                  <DayHeading
                    day={day}
                    count={dayOpen}
                    sources={calls.size}
                    noun="OPEN"
                    tone={stuckDay === day ? "text-[var(--cyan)]" : "text-[var(--bright)]"}
                  />
                </div>
                {[...calls.values()].map((group) => (
                  <CallGroup heldKeys={heldKeys} chipsOf={(a) => chipsById.get(idKey(a))} clusterOf={(a) => clusterById.get(idKey(a))?.items.length} key={group[0].callId} items={group} onToggle={doToggle} onComment={openComment}
                            commentingKey={commentingKey} />
                ))}
              </section>
            );
          })}

          {done.length > 0 && (
            <details
              className="mt-10 border-t border-[var(--line)] pt-3"
              open={showDone}
              onToggle={(e) => setShowDone((e.target as HTMLDetailsElement).open)}
            >
              <summary className="cursor-pointer text-[10px] uppercase tracking-[1.5px] text-[var(--dim)]">
                settled · {done.length}
              </summary>
              <div className="mt-3">
                {[...settledDays.entries()].slice(0, settledShown).map(([day, calls]) => {
                  const dayCount = [...calls.values()].reduce((t, g) => t + g.length, 0);
                  return (
                    <section key={day} className="mb-2">
                      <div className="mb-2 flex items-center gap-2.5 py-1.5">
                        <DayHeading day={day} count={dayCount} sources={calls.size} noun="SETTLED" />
                      </div>
                      <div className="opacity-60">
                        {[...calls.values()].map((group) => (
                          <CallGroup
                            settled
                            key={group[0].callId}
                            items={group}
                            onToggle={doToggle}
                            onComment={openComment}
                            commentingKey={commentingKey}
                          />
                        ))}
                      </div>
                    </section>
                  );
                })}
                {settledDays.size > settledShown && (
                  <button
                    onClick={() => setSettledShown((c) => c + SETTLED_PAGE)}
                    className="mt-2 w-full rounded-lg border border-[var(--line)] py-2 font-sans text-[11.5px] text-[var(--dim)] hover:border-[var(--cyan-3)] hover:text-[var(--cyan)]"
                  >
                    Load {Math.min(SETTLED_PAGE, settledDays.size - settledShown)} more days
                    <span className="ml-2 opacity-70">
                      ({settledDays.size - settledShown} of {settledDays.size} still hidden)
                    </span>
                  </button>
                )}
              </div>
            </details>
          )}
        </div>
      </div>

      {commentFor && (
        <CommentPopover
          anchor={commentFor.rect}
          onSubmit={(text) => addComment(commentFor.item, text)}
          onClose={() => setCommentFor(null)}
        />
      )}
    </div>
  );
}
