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
import { useEffect, useMemo, useState } from "react";
import { Call } from "@jarvis/shared";
import { callTitle } from "../calls/hooks";

type Run = {
  id: string; kind: string; task: string; status: string;
  started: number; finished: number | null; lastLine: string;
  summary: string; sessionId: string; silent: boolean;
};

// A FAILED row lingers, because it is the only explanation for an answer that
// never came. A successful one does not: the answer is the outcome, and a
// completed "ASK …" sitting under the reply for another 45 seconds reads as
// work still in progress. It was lingering long after it had anything to say.
const FAILED_LINGER_MS = 45_000;

// A worker's log carries the reply protocol too — ANSWER:, SPOKEN:, SOURCES:,
// FOLLOWUPS:. Those are machine lines meant for the dispatcher, and showing
// "SOURCES: /calls/2026-09-18-1100 …" as a progress note tells the owner
// nothing about what the worker is doing.
const PROTOCOL = /^\s*(ANSWER|SPOKEN|SOURCES|FOLLOWUPS|ACTION:[A-Z]+)\b/i;
const progressLine = (line: string) =>
  !line || PROTOCOL.test(line) ? "" : line.slice(0, 120);

// A task is written for a worker, not for a person: it carries absolute paths
// because that is what makes a worker read the right file. Rendering it raw put
// "/Users/upesenga/Documents/ObsidianVaults/jarvisVault/Calls/call-notes-…md"
// in the transcript — noise, and someone's home directory on screen.
//
// The paths are the useful part though, so they become a tag: the call they
// point at, named. What is left is the sentence a person would have written.
const CALL_IN_PATH = /\bcall-(?:notes-)?(\d{4}-\d{2}-\d{2}-\d{4})\b/g;
const ANY_PATH = /(?:\/[^\s"']+){2,}/g;

function readTask(task: string): { calls: string[]; text: string } {
  const calls = [...new Set([...task.matchAll(CALL_IN_PATH)].map((m) => m[1]))];
  const text = task
    .replace(ANY_PATH, "")                 // drop absolute paths entirely
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,)])/g, "$1")
    .replace(/\(\s*\)/g, "")
    .trim();
  return { calls, text };
}

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

  // titles for the call tags — the same cached list the chat already loads
  const { data: calls = [] } = useQuery({
    queryKey: ["calls"],
    queryFn: async () => Call.array().parse(await (await fetch("/api/calls")).json()),
    staleTime: 30_000,
  });
  const titleOf = useMemo(() => {
    const m = new Map(calls.map((c) => [c.id, callTitle(c)]));
    return (id: string) => m.get(id) ?? id;
  }, [calls]);

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
      (r.status === "working" ||
        (r.status === "failed" && (r.finished ?? 0) > Date.now() - FAILED_LINGER_MS)),
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
                <span className="min-w-0 flex-1 truncate text-[var(--text)]">
                  {readTask(r.task).calls.map((id) => (
                    <span
                      key={id}
                      title={id}
                      className="mr-1.5 inline-flex items-baseline gap-1 rounded border border-[var(--indigo-3)] bg-[var(--indigo-2)] px-1.5 py-[1px] text-[10px] text-[var(--indigo)]"
                    >
                      <span className="font-mono text-[8px] uppercase tracking-[1px] opacity-70">call</span>
                      <span className="max-w-[200px] truncate">{titleOf(id)}</span>
                    </span>
                  ))}
                  {readTask(r.task).text}
                </span>
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
