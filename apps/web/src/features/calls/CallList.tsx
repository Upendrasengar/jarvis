// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
import { useState } from "react";
import type { Call } from "@jarvis/shared";
import {
  callHost, callTitle, useAutorecord, useRecordingControls, useSetAutorecord,
} from "./hooks";

const CHIP: Record<string, { label: string; cls: string }> = {
  recording: { label: "RECORDING", cls: "border-[rgba(255,107,132,.4)] bg-[rgba(255,107,132,.1)] text-[var(--red)] blip" },
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
  const { start } = useRecordingControls();
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
