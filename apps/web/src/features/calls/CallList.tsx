// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
import { useState } from "react";
import type { Call } from "@jarvis/shared";
import {
  callHost, callTitle, useAutorecord, useLiveDefault, useProcessPause, useProcessQueue, useRecordingControls,
  useSetAutorecord, useSetLiveDefault, useSetProcessPolicy,
} from "./hooks";

const CHIP: Record<string, { label: string; cls: string }> = {
  recording: { label: "RECORDING", cls: "border-[rgba(255,107,132,.4)] bg-[rgba(255,107,132,.1)] text-[var(--red)] blip" },
  queued: { label: "QUEUED", cls: "border-[var(--line)] bg-[var(--surf-2)] text-[var(--dim)]" },
  processing: { label: "TRANSCRIBING", cls: "border-[rgba(255,201,92,.35)] bg-[rgba(255,201,92,.08)] text-[var(--amber)] blip" },
  done: { label: "NOTES READY", cls: "border-[rgba(53,217,155,.3)] bg-[rgba(53,217,155,.08)] text-[var(--green)]" },
  failed: { label: "NEEDS RERUN", cls: "border-[rgba(255,201,92,.35)] bg-[rgba(255,201,92,.08)] text-[var(--amber)]" },
  empty: { label: "NO AUDIO", cls: "border-[var(--line)] text-[var(--dim)]" },
};


// "2026-08-21" → "AUG 21 · TODAY / YESTERDAY / N DAYS AGO"
function dayLabel(day: string): string {
  const d = new Date(day + "T00:00:00");
  if (isNaN(d.getTime())) return day;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - d.getTime()) / 86_400_000);
  const md = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const rel = diff <= 0 ? "today" : diff === 1 ? "yesterday" : `${diff} days ago`;
  return `${md} · ${rel}`;
}

function minutes(c: Call): number | null {
  if (!c.ended) return null;
  const ms = new Date(c.ended.replace(" ", "T")).getTime() - new Date(c.started.replace(" ", "T")).getTime();
  return ms > 0 ? Math.round(ms / 60_000) : null;
}

export function CallList({
  calls, selected, onSelect,
}: {
  calls: Call[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const [filter, setFilter] = useState("");
  const autorec = useAutorecord();
  const setAutorec = useSetAutorecord();
  const liveDef = useLiveDefault();
  const setLiveDef = useSetLiveDefault();
  const { start } = useRecordingControls();
  const queue = useProcessQueue();
  const setPolicy = useSetProcessPolicy();
  const pause = useProcessPause();
  const q = queue.data;
  const paused = !!q && q.pausedUntil > Date.now();
  const pausedMins = paused ? Math.max(1, Math.ceil((q.pausedUntil - Date.now()) / 60_000)) : 0;
  // one line on what the queue is doing — the reason text comes from the
  // script that makes the decision, so the UI never guesses at it
  const queueLine = !q ? "" :
    q.running ? `transcribing ${q.running.slice(11, 13)}:${q.running.slice(13, 15)}` :
    q.pending.length === 0 ? "nothing waiting" :
    q.waiting ? `${q.pending.length} waiting · ${q.waiting}` : `${q.pending.length} waiting`;
  const anyRecording = calls.some((c) => c.status === "recording");

  const items = calls.filter(
    (c) => !filter || callTitle(c).toLowerCase().includes(filter.toLowerCase()) || c.id.includes(filter),
  );
  let lastDay = "";

  return (
    <aside className="flex w-[300px] min-w-[300px] flex-col gap-2 overflow-auto border-r border-[var(--line)] bg-[var(--surf)] p-3">
      <div className="flex items-center justify-between px-1 pt-1">
        <h2 className="text-[18px] font-medium text-[var(--text)] [font-family:var(--display)]">Calls</h2>
        {!anyRecording && (
          <button
            onClick={() => start.mutate()}
            disabled={start.isPending}
            className="rounded-full border border-[rgba(255,107,132,.35)] bg-[rgba(255,107,132,.08)] px-3 py-[5px] text-[9.5px] tracking-[1.5px] text-[var(--red)] transition hover:bg-[rgba(255,107,132,.16)] disabled:opacity-50"
          >
            {start.isPending ? "STARTING…" : "● RECORD"}
          </button>
        )}
      </div>
      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter calls…"
        className="w-full rounded-xl border border-[var(--line)] bg-[var(--field)] px-3 py-2 font-sans text-[12px] text-[var(--text)] outline-none placeholder:text-[var(--dim)] focus:border-[var(--cyan)]"
      />
      <div
        title="When off, Jarvis never starts recording on its own — the Record button still works"
        className="flex items-center justify-between rounded-xl border border-[var(--line)] bg-[var(--surf-2)] px-3 py-2 text-[9px] tracking-[1.5px] text-[var(--dim)]"
      >
        <span>AUTO-RECORD CALLS</span>
        <button
          onClick={() => setAutorec.mutate(!autorec.data?.on)}
          className={`relative h-[18px] w-[34px] rounded-full border transition ${
            autorec.data?.on
              ? "border-[var(--cyan-3)] bg-[var(--cyan-2)]"
              : "border-[var(--line)] bg-[var(--surf-2)]"
          }`}
        >
          <span
            className={`absolute top-[2px] h-3 w-3 rounded-full transition-all ${
              autorec.data?.on
                ? "left-[18px] bg-[var(--cyan)] shadow-[0_0_8px_var(--cyan)]"
                : "left-[2px] bg-[var(--dim)]"
            }`}
          />
        </button>
      </div>
      {/* Live assist default. Per call it can still be flipped either way
          from the call page while it records. Off by default: it runs
          whisper during the call and streams transcript to the quick model. */}
      <div
        title="Transcribe the call as it happens with a small local model and show questions to ask, things to mention, what was agreed. Costs CPU during the call; the transcript goes to the quick model every minute. Can be switched per call."
        className="flex items-center justify-between rounded-xl border border-[var(--line)] bg-[var(--surf-2)] px-3 py-2 text-[9px] tracking-[1.5px] text-[var(--dim)]"
      >
        <span>LIVE ASSIST ON EVERY CALL</span>
        <button
          onClick={() => setLiveDef.mutate(!liveDef.data?.on)}
          className={`relative h-[18px] w-[34px] rounded-full border transition ${
            liveDef.data?.on
              ? "border-[var(--cyan-3)] bg-[var(--cyan-2)]"
              : "border-[var(--line)] bg-[var(--surf-2)]"
          }`}
        >
          <span
            className={`absolute top-[2px] h-3 w-3 rounded-full transition-all ${
              liveDef.data?.on
                ? "left-[18px] bg-[var(--cyan)] shadow-[0_0_8px_var(--cyan)]"
                : "left-[2px] bg-[var(--dim)]"
            }`}
          />
        </button>
      </div>
      {/* When finished calls get transcribed. Recording is never delayed;
          this is only about whisper taking the machine over the moment a
          meeting ends. Pause is a one-off override on top of the policy. */}
      <div
        title="Transcription runs whisper flat out for minutes. Pick when that is allowed to happen; recording itself is never delayed."
        className="rounded-xl border border-[var(--line)] bg-[var(--surf-2)] px-3 py-2 text-[9px] tracking-[1.5px] text-[var(--dim)]"
      >
        <div className="flex items-center justify-between gap-2">
          <span>WRITE NOTES</span>
          <select
            value={q?.policy.mode ?? "now"}
            onChange={(e) => {
              const mode = e.target.value as "now" | "idle" | "window" | "manual";
              setPolicy.mutate(mode === "window" ? { mode, window: q?.policy.window ?? "21:00-06:00" } : { mode });
            }}
            className="rounded-md border border-[var(--line)] bg-[var(--field)] px-1 py-[2px] text-[9px] tracking-[1px] text-[var(--text)] outline-none focus:border-[var(--cyan)]"
          >
            <option value="now">RIGHT AWAY</option>
            <option value="idle">WHEN MAC IS IDLE</option>
            <option value="window">OVERNIGHT</option>
            <option value="manual">ONLY WHEN I ASK</option>
          </select>
        </div>
        {q?.policy.mode === "window" && (
          <div className="mt-1 flex items-center justify-between gap-2">
            <span>BETWEEN</span>
            <input
              defaultValue={q.policy.window ?? "21:00-06:00"}
              key={q.policy.window}
              onBlur={(e) => {
                const w = e.target.value.trim();
                if (/^\d{2}:\d{2}-\d{2}:\d{2}$/.test(w) && w !== q.policy.window)
                  setPolicy.mutate({ mode: "window", window: w });
              }}
              placeholder="21:00-06:00"
              className="w-[96px] rounded-md border border-[var(--line)] bg-[var(--field)] px-1 py-[2px] text-right text-[9px] tracking-[1px] text-[var(--text)] outline-none focus:border-[var(--cyan)]"
            />
          </div>
        )}
        <div className="mt-[6px] flex items-center justify-between gap-2 normal-case tracking-normal">
          <span className="truncate text-[10px]" title={q?.waiting || undefined}>
            {paused ? `paused · ${pausedMins}m left` : queueLine}
          </span>
          <button
            onClick={() => pause.mutate(paused ? { on: false } : { on: true, minutes: 60 })}
            disabled={pause.isPending}
            title={paused ? "Resume — the queue picks up where it left off" : "Hold all transcription for an hour, whatever the policy says"}
            className={`shrink-0 rounded-full border px-2 py-[2px] text-[8.5px] tracking-[1.2px] transition ${
              paused
                ? "border-[rgba(255,201,92,.5)] text-[var(--amber)] hover:bg-[rgba(255,201,92,.08)]"
                : "border-[var(--line)] text-[var(--dim)] hover:border-[var(--amber)] hover:text-[var(--amber)]"
            }`}
          >
            {paused ? "RESUME" : "PAUSE 1H"}
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {items.length === 0 && (
          <div className="mt-8 text-center text-[11px] text-[var(--dim)]">
            No calls yet.
            <br /><br />
            Join a meeting — Jarvis records it and files notes here automatically.
          </div>
        )}
        {items.map((c) => {
          const day = c.started.slice(0, 10);
          const header = day !== lastDay ? (lastDay = day) : null;
          const chip = CHIP[c.status];
          const mins = minutes(c);
          return (
            <div key={c.id}>
              {header && (
                <div className="mb-2 mt-3 rounded-md bg-[var(--surf-2)] px-3 py-[6px] text-[9.5px] font-medium uppercase tracking-[2px] text-[var(--dim)]">
                  {dayLabel(header)}
                </div>
              )}
              <button
                onClick={() => onSelect(c.id)}
                className={`mb-2 w-full rounded-xl border px-3 py-[10px] text-left transition ${
                  c.id === selected
                    ? "border-[var(--cyan-3)] bg-[var(--cyan-2)]"
                    : "border-[var(--line)] bg-[var(--surf)] hover:bg-[var(--surf-2)]"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  {chip && (
                    <span className={`rounded border px-[6px] py-[2px] text-[8px] tracking-[1.2px] ${chip.cls}`}>
                      {chip.label}
                    </span>
                  )}
                  <span className="shrink-0 text-[9.5px] text-[var(--dim)]">{c.started.slice(11, 16)}</span>
                </div>
                <div className="mt-[6px] font-sans text-[12.5px] font-medium leading-snug text-[var(--text)]">
                  {callTitle(c)}
                </div>
                <div className="mt-[6px] text-[9.5px] text-[var(--dim)]">
                  {callHost(c.url)}
                  {mins ? ` · ${mins}m` : ""}
                </div>
              </button>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
