// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// Worker activity, shown inside the conversation.
//
// Delegation used to be invisible: a question was asked, nothing happened on
// screen, and some time later an answer appeared — which is why "I don't see,
// worker running to get answer" was a reasonable thing to think. The Activity
// page had all of this, but it is a different page, and the moment you want it
// is the moment you are staring at the chat.
//
// It matters more now that a turn can delegate twice. A loop you can watch is
// one you can interrupt; a silent one is indistinguishable from a hang.
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

type Run = {
  id: string; kind: string; task: string; status: string;
  started: number; finished: number | null; lastLine: string;
  summary: string; sessionId: string; silent: boolean;
};

// A finished row lingers briefly so the work that produced the answer is still
// visible when the answer arrives, then gets out of the way.
const LINGER_MS = 45_000;

// A worker's log carries the reply protocol too — ANSWER:, SPOKEN:, SOURCES:,
// FOLLOWUPS:. Those are machine lines meant for the dispatcher, and showing
// "SOURCES: /calls/2026-09-18-1100 …" as a progress note tells the owner
// nothing about what the worker is doing.
const PROTOCOL = /^\s*(ANSWER|SPOKEN|SOURCES|FOLLOWUPS|ACTION:[A-Z]+)\b/i;
const progressLine = (line: string) =>
  !line || PROTOCOL.test(line) ? "" : line.slice(0, 120);

function elapsed(from: number, to: number | null): string {
  const s = Math.max(0, Math.round(((to ?? Date.now()) - from) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function ActivityRows({ sessionId }: { sessionId: string }) {
  // Polling only while a run is already visible cannot start itself: a brand
  // new worker is not in the data yet, so nothing asks for it, and the row
  // appeared only if the page happened to be reloaded. `expecting` covers the
  // gap between dispatching a worker and first seeing it.
  const [expecting, setExpecting] = useState(false);

  const { data: runs = [], refetch } = useQuery<Run[]>({
    queryKey: ["agents"],
    queryFn: async () => (await fetch("/api/agents")).json(),
    refetchInterval: (q) =>
      expecting || (q.state.data ?? []).some((r) => r.status === "working") ? 2000 : false,
  });

  useEffect(() => {
    // start: dispatched by the client the moment it posts a delegation
    const onStart = () => { setExpecting(true); void refetch(); };
    // finish: pushed by the server over the live channel — take it rather than
    // waiting out the interval
    const onDone = () => void refetch();
    window.addEventListener("jarvis:worker-started", onStart);
    window.addEventListener("jarvis:worker-result", onDone);
    return () => {
      window.removeEventListener("jarvis:worker-started", onStart);
      window.removeEventListener("jarvis:worker-result", onDone);
    };
  }, [refetch]);

  // stop expecting once the run is visible, so polling can wind down again
  useEffect(() => {
    if (expecting && runs.some((r) => r.sessionId === sessionId && r.status === "working"))
      setExpecting(false);
  }, [expecting, runs, sessionId]);

  const mine = runs.filter(
    (r) =>
      r.sessionId === sessionId &&
      !r.silent &&
      (r.status === "working" || (r.finished ?? 0) > Date.now() - LINGER_MS),
  );
  if (!mine.length) return null;

  return (
    <div className="mt-3 flex flex-col gap-1.5">
      {mine.map((r) => {
        const working = r.status === "working";
        const failed = r.status === "failed";
        return (
          <div
            key={r.id}
            className={`flex items-start gap-2.5 rounded-xl border px-3 py-2 font-sans text-[11.5px] ${
              failed
                ? "border-[var(--red)]/40 bg-[var(--red)]/[0.06]"
                : working
                  ? "border-[var(--cyan-3)] bg-[var(--cyan-2)]"
                  : "border-[var(--line)] bg-[var(--surf-2)]"
            }`}
          >
            <span
              className={`mt-[3px] h-[7px] w-[7px] shrink-0 rounded-full ${
                failed ? "bg-[var(--red)]" : working ? "blip bg-[var(--cyan)]" : "bg-[var(--green)]"
              }`}
            />
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-2">
                <span className="font-mono text-[9px] uppercase tracking-[1.5px] text-[var(--dim)]">
                  {r.kind}
                </span>
                <span className="min-w-0 flex-1 truncate text-[var(--text)]">{r.task}</span>
                <span className="shrink-0 font-mono text-[9.5px] text-[var(--dim)]">
                  {elapsed(r.started, r.finished)}
                </span>
              </span>
              {/* Progress while it runs and the reason when it fails; nothing
                  when it succeeds, because the answer itself is the outcome
                  and repeating a fragment of it above is noise. */}
              {(working || failed) && progressLine(r.lastLine) && (
                <span className="mt-[2px] block truncate text-[10.5px] text-[var(--dim)]">
                  {progressLine(r.lastLine)}
                </span>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
