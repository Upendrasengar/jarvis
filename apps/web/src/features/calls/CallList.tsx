// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
import { useState } from "react";
import type { Call } from "@jarvis/shared";
import {
  callHost, callTitle, useAutorecord, useRecordingControls, useSetAutorecord,
} from "./hooks";

const DOT: Record<string, string> = {
  recording: "bg-[var(--red)] shadow-[0_0_8px_var(--red)] blip",
  processing: "bg-[var(--amber)] blip",
  done: "bg-[var(--green)]",
  failed: "bg-[var(--red)] opacity-60",
  empty: "bg-[var(--red)] opacity-60",
};
const STATUS_TXT: Record<string, string> = {
  recording: "recording",
  processing: "transcribing",
  failed: "needs rerun",
  empty: "no audio",
};

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
      {!anyRecording && (
        <button
          onClick={() => start.mutate()}
          disabled={start.isPending}
          className="w-full rounded-xl border border-[rgba(255,107,132,.35)] bg-[rgba(255,107,132,.08)] py-2 text-[10px] tracking-[1.5px] text-[var(--red)] transition hover:bg-[rgba(255,107,132,.16)] disabled:opacity-50"
        >
          {start.isPending ? "STARTING…" : "● RECORD A CALL NOW"}
        </button>
      )}
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
          const st = STATUS_TXT[c.status];
          return (
            <div key={c.id}>
              {header && (
                <div className="mx-1 mb-1 mt-3 text-[9px] uppercase tracking-[2px] text-[var(--dim)]">
                  {header}
                </div>
              )}
              <button
                onClick={() => onSelect(c.id)}
                className={`mb-[3px] w-full rounded-xl border px-3 py-2 text-left transition ${
                  c.id === selected
                    ? "border-[var(--cyan-3)] bg-[var(--cyan-2)]"
                    : "border-transparent hover:bg-[var(--surf-2)]"
                }`}
              >
                <div className="truncate font-sans text-xs font-semibold text-[var(--bright)]">
                  {callTitle(c)}
                </div>
                <div className="mt-[3px] flex items-center gap-2 text-[10px] text-[var(--dim)]">
                  <span className={`h-[7px] w-[7px] shrink-0 rounded-full ${DOT[c.status]}`} />
                  {c.started.slice(11, 16)} · {callHost(c.url)}
                  {st ? ` · ${st}` : ""}
                </div>
              </button>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
