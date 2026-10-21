// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// Live assist panel for a call that is recording: the grouped list the quick
// model keeps up to date (ask / mention / agreed / watch), a status line that
// says plainly what the pipeline is doing, and the live transcript folded
// away underneath. Items tick off and stay gone — the script reads the
// ticked ids so the model cannot bring them back.
import { useEffect, useRef, useState } from "react";
import type { LiveAssistInfo, LiveGroup, LiveHistoryItem, LiveItem } from "@jarvis/shared";
import { useLiveDone, useSetLiveAssist } from "./hooks";

const GROUPS: { key: LiveGroup; label: string; hint: string; cls: string; dot: string }[] = [
  { key: "ask", label: "ASK", hint: "questions worth asking before the call ends", cls: "text-[var(--cyan)]", dot: "bg-[var(--cyan)]" },
  { key: "mention", label: "MENTION", hint: "things you owe them, or they are missing", cls: "text-[var(--amber)]", dot: "bg-[var(--amber)]" },
  { key: "agreed", label: "AGREED", hint: "decisions and commitments made on this call", cls: "text-[var(--green)]", dot: "bg-[var(--green)]" },
  { key: "watch", label: "WATCH", hint: "dates, numbers and names said once", cls: "text-[var(--text)]", dot: "bg-[var(--dim)]" },
];

function ago(ms: number): string {
  if (!ms) return "";
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  return s < 60 ? `${s}s ago` : `${Math.round(s / 60)}m ago`;
}
function mins(secs: number): string {
  const m = Math.floor(secs / 60);
  return m < 1 ? `${Math.round(secs)}s` : `${m} min`;
}

/** Header switch: on/off for THIS call. */
export function LiveToggle({ id, info }: { id: string; info: LiveAssistInfo | undefined }) {
  const set = useSetLiveAssist();
  const on = info?.enabled ?? false;
  return (
    <button
      onClick={() => set.mutate({ id, on: !on })}
      disabled={set.isPending || !info}
      title={on
        ? "Live assist is on for this call — click to stop transcribing live"
        : "Transcribe this call as it happens and get questions to ask / things to mention"}
      className={`rounded-lg border px-3 py-1 text-[10px] tracking-wider transition disabled:opacity-50 ${
        on
          ? "border-[var(--cyan-3)] bg-[var(--cyan-2)] text-[var(--cyan)]"
          : "border-[var(--line)] text-[var(--dim)] hover:border-[var(--cyan)] hover:text-[var(--cyan)]"
      }`}
    >
      {set.isPending ? "…" : on ? "◉ LIVE ASSIST ON" : "○ LIVE ASSIST"}
    </button>
  );
}

function statusLine(info: LiveAssistInfo): { text: string; tone: "ok" | "warn" | "dim" } {
  const st = info.status;
  const state = info.state;
  if (!info.running) {
    if (state?.error) return { text: state.error, tone: "warn" };
    return { text: "starting…", tone: "dim" };
  }
  if (st?.paused && st.paused !== "starting") return { text: st.paused, tone: "warn" };
  if (!st || st.paused === "starting") return { text: "loading the speech model…", tone: "dim" };
  const parts = [`${mins(st.transcriptSecs)} transcribed`];
  if (state?.updatedAt) parts.push(`suggestions ${ago(state.updatedAt)}`);
  else parts.push("first suggestions after about a minute of talk");
  if (state?.error) return { text: `${parts.join(" · ")} · ${state.error}`, tone: "warn" };
  return { text: parts.join(" · "), tone: "ok" };
}

const NEW_MS = 75_000;   // one model round — long enough to notice, short enough to fade

function Item({ id, item, isNew }: { id: string; item: LiveItem; isNew: boolean }) {
  const done = useLiveDone();
  return (
    <li className="group flex items-start gap-2 py-[5px]">
      <button
        onClick={() => done.mutate({ id, itemId: item.id, on: true })}
        title="Done — asked / said / noted. It will not come back."
        className="mt-[2px] h-[14px] w-[14px] shrink-0 rounded-[4px] border border-[var(--line-2)] text-[9px] leading-[12px] text-transparent transition hover:border-[var(--cyan)] hover:text-[var(--cyan)]"
      >
        ✓
      </button>
      <div className="min-w-0">
        <div className="text-[12.5px] leading-snug text-[var(--bright)]">
          {isNew && <span className="mr-1.5 rounded-[4px] bg-[var(--cyan-2)] px-1 text-[8.5px] tracking-[1px] text-[var(--cyan)] align-middle">NEW</span>}
          {item.text}
        </div>
        {item.why && <div className="mt-[1px] text-[11px] leading-snug text-[var(--dim)]">{item.why}</div>}
      </div>
    </li>
  );
}

const GROUP_OF = Object.fromEntries(GROUPS.map((g) => [g.key, g])) as Record<LiveGroup, (typeof GROUPS)[number]>;

// A past item: ticked (✓) or dropped by the model (–). Un-ticking brings a
// ticked item back if the model still lists it.
function PastItem({ id, item, live }: { id: string; item: LiveHistoryItem; live: boolean }) {
  const done = useLiveDone();
  const g = GROUP_OF[item.group];
  return (
    <li className="flex items-start gap-2 py-[4px] text-[12px] leading-snug">
      <button
        onClick={() => live && item.status === "done" && done.mutate({ id, itemId: item.id, on: false })}
        disabled={!live || item.status !== "done"}
        title={item.status === "done" ? (live ? "Ticked — click to bring it back" : "Ticked during the call")
          : item.status === "current" ? "Still open when the call ended"
          : "Dropped by the model — addressed or superseded"}
        className={`mt-[2px] h-[14px] w-[14px] shrink-0 rounded-[4px] border text-[9px] leading-[12px] ${
          item.status === "done"
            ? "border-[var(--green)] text-[var(--green)]"
            : "border-[var(--line)] text-[var(--dim)]"
        } disabled:cursor-default`}
      >
        {item.status === "done" ? "✓" : item.status === "current" ? "○" : "–"}
      </button>
      <span className={`shrink-0 text-[8.5px] tracking-[1.5px] ${g.cls}`} style={{ marginTop: 3 }}>{g.label}</span>
      <span className={item.status === "done" ? "text-[var(--dim)] line-through decoration-[var(--line-2)]" : "text-[var(--text)]"}>
        {item.text}
      </span>
    </li>
  );
}

/** After the call: everything live assist showed, folded away under the
 *  notes. Renders nothing for a call that never had live assist. */
export function LiveRecap({ info }: { info: LiveAssistInfo | undefined }) {
  const [open, setOpen] = useState(false);
  if (!info || info.history.length === 0) return null;
  const ticked = info.history.filter((i) => i.status === "done").length;
  return (
    <div className="mt-8 rounded-2xl border border-[var(--line)] bg-[var(--surf)] px-5 py-3">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between text-left">
        <span className="text-[10px] tracking-[1.5px] text-[var(--dim)]">
          {open ? "▾" : "▸"} LIVE ASSIST DURING THIS CALL
        </span>
        <span className="text-[10.5px] text-[var(--dim)]">
          {info.history.length} suggestions · {ticked} ticked
        </span>
      </button>
      {open && (
        <div className="mt-3">
          {info.summaries.length > 0 && (
            <div className="mb-3 border-l-2 border-[var(--line)] pl-3">
              {info.summaries.map((s, i) => (
                <div key={i} className="py-[2px] text-[11.5px] leading-snug text-[var(--dim)]">
                  <span className="mr-2 font-mono text-[10px]">{new Date(s.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                  {s.text}
                </div>
              ))}
            </div>
          )}
          <ul className="divide-y divide-[var(--line)]">
            {info.history.map((it) => <PastItem key={it.id} id={info.id} item={it} live={false} />)}
          </ul>
          <div className="mt-2 text-[10px] text-[var(--dim)]">
            What the quick model suggested while the call ran, in the order it appeared. The notes above come from the full pass; ticked items were passed to it as hints.
          </div>
        </div>
      )}
    </div>
  );
}

export function LiveAssist({ id, info }: { id: string; info: LiveAssistInfo | undefined }) {
  const set = useSetLiveAssist();
  const [showTranscript, setShowTranscript] = useState(false);
  const [showPast, setShowPast] = useState(false);
  const scrollRef = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (showTranscript && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [showTranscript, info?.transcript]);

  if (!info) return null;

  if (!info.enabled) {
    return (
      <div className="mx-auto mt-8 max-w-[560px] rounded-2xl border border-dashed border-[var(--line)] px-5 py-4 text-center">
        <div className="text-[12.5px] text-[var(--text)]">
          Live assist is off for this call.
        </div>
        <div className="mt-1 text-[11.5px] leading-relaxed text-[var(--dim)]">
          Turn it on and Jarvis transcribes as you talk, then keeps a short list of questions to ask,
          things to mention from your notes, and what has been agreed. Suggestions trail the
          conversation by about a minute.
        </div>
        <button
          onClick={() => set.mutate({ id, on: true })}
          disabled={set.isPending}
          className="mt-3 rounded-full border border-[var(--cyan-3)] px-4 py-1.5 text-[12px] text-[var(--cyan)] hover:bg-[var(--cyan-2)] disabled:opacity-50"
        >
          {set.isPending ? "starting…" : "Turn on for this call"}
        </button>
      </div>
    );
  }

  const line = statusLine(info);
  const items = info.state?.items ?? [];
  const byGroup = (g: LiveGroup) => items.filter((i) => i.group === g);
  const empty = items.length === 0;
  const now = Date.now();
  const firstAt = new Map(info.history.map((h) => [h.id, h.firstAt]));
  const isNew = (it: LiveItem) => now - (firstAt.get(it.id) ?? 0) < NEW_MS;
  const past = info.history.filter((h) => h.status !== "current");

  return (
    <div className="mt-8">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[10px] tracking-[1.5px] text-[var(--dim)]">
          <span className={`inline-block h-[7px] w-[7px] rounded-full ${info.running && line.tone === "ok" ? "blip bg-[var(--cyan)]" : line.tone === "warn" ? "bg-[var(--amber)]" : "bg-[var(--dim)]"}`} />
          LIVE ASSIST
          <span className={`normal-case tracking-normal ${line.tone === "warn" ? "text-[var(--amber)]" : ""}`}>· {line.text}</span>
        </div>
        {info.state?.summary && (
          <div className="min-w-0 flex-1 truncate text-right text-[11.5px] text-[var(--text)]" title={info.state.summary}>
            {info.state.summary}
          </div>
        )}
      </div>

      {empty ? (
        <div className="rounded-2xl border border-[var(--line)] bg-[var(--surf)] px-5 py-6 text-center text-[12px] text-[var(--dim)]">
          {info.state?.rounds
            ? "Nothing worth raising yet — keep talking."
            : "Listening. The first suggestions arrive after about a minute of conversation."}
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {GROUPS.map((g) => {
            const list = byGroup(g.key);
            if (!list.length) return null;
            return (
              <div key={g.key} className="rounded-2xl border border-[var(--line)] bg-[var(--surf)] px-4 py-3">
                <div className={`mb-1 flex items-center gap-2 text-[9px] tracking-[2px] ${g.cls}`} title={g.hint}>
                  <span className={`inline-block h-[6px] w-[6px] rounded-full ${g.dot}`} />
                  {g.label}
                </div>
                <ul className="divide-y divide-[var(--line)]">
                  {list.map((it) => <Item key={it.id} id={id} item={it} isNew={isNew(it)} />)}
                </ul>
              </div>
            );
          })}
        </div>
      )}

      {/* Nothing vanishes: what the model dropped and what you ticked stay
          here, folded, so a suggestion that disappeared can be found again. */}
      {past.length > 0 && (
        <div className="mt-3">
          <button
            onClick={() => setShowPast((v) => !v)}
            className="text-[10.5px] text-[var(--dim)] hover:text-[var(--text)]"
          >
            {showPast ? "▾" : "▸"} {past.length} earlier {past.length === 1 ? "suggestion" : "suggestions"}
          </button>
          {showPast && (
            <ul className="mt-1 divide-y divide-[var(--line)] rounded-xl border border-[var(--line)] bg-[var(--surf)] px-4 py-1">
              {[...past].reverse().map((it) => <PastItem key={it.id} id={id} item={it} live />)}
            </ul>
          )}
        </div>
      )}

      <div className="mt-3 flex items-center justify-between text-[10.5px] text-[var(--dim)]">
        <button
          onClick={() => setShowTranscript((v) => !v)}
          className="hover:text-[var(--text)]"
        >
          {showTranscript ? "▾ live transcript" : "▸ live transcript"}
        </button>
        <span title="The transcript is produced by a small local model and sent to the quick model every minute. The notes after the call still come from the full pass.">
          rough transcript · small local model · quick model every minute
        </span>
      </div>
      {showTranscript && (
        <pre
          ref={scrollRef}
          className="mt-2 max-h-[260px] overflow-auto whitespace-pre-wrap rounded-xl border border-[var(--line)] bg-[var(--surf-2)] px-4 py-3 font-mono text-[11px] leading-relaxed text-[var(--text)]"
        >
          {info.transcript || "(nothing transcribed yet)"}
        </pre>
      )}
    </div>
  );
}
