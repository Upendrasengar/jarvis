// Activity & Logs — live visibility into the pipelines. Status chips show
// which processes are alive right now; the tail below follows the selected
// log (watcher, server, or any call's processing log) refreshing every 2s.
// "Transcribing…" is never a mystery again: if the log is moving, it's
// working; if it stops moving with the chip dark, it's stuck.
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";

type Source = { id: string; label: string; updated: number | null };

function useLogs() {
  return useQuery({
    queryKey: ["logs"],
    queryFn: async () => (await fetch("/api/logs")).json() as Promise<Source[]>,
    refetchInterval: 5000,
  });
}
function useActivity() {
  return useQuery({
    queryKey: ["activity"],
    queryFn: async () =>
      (await fetch("/api/activity")).json() as Promise<{
        whisper: boolean; processor: boolean; recorder: boolean; claude: boolean;
      }>,
    refetchInterval: 3000,
  });
}
function useTail(id: string | null) {
  return useQuery({
    queryKey: ["logtail", id],
    enabled: !!id,
    queryFn: async () =>
      (await fetch(`/api/logs/${id}?lines=300`)).json() as Promise<{ text: string; updated: number | null }>,
    refetchInterval: 2000,
  });
}

function ago(ms: number | null): string {
  if (!ms) return "never";
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

function ActivityChip({ on, label }: { on: boolean; label: string }) {
  return (
    <span
      className={`flex items-center gap-2 rounded-full border px-3 py-1 text-[10px] tracking-wider ${
        on
          ? "border-[rgba(62,224,138,.4)] text-[var(--green)]"
          : "border-[var(--line)] text-[var(--dim)] opacity-60"
      }`}
    >
      <span className={`h-[7px] w-[7px] rounded-full ${on ? "blip bg-[var(--green)]" : "bg-[var(--dim)]"}`} />
      {label}
    </span>
  );
}

export function LogsPage() {
  const { data: sources = [] } = useLogs();
  const { data: act } = useActivity();
  const [params, setParams] = useSearchParams();
  const selected = params.get("src") ?? sources[0]?.id ?? null;
  const { data: tail } = useTail(selected);
  const [follow, setFollow] = useState(true);
  const preRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (follow && preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight;
  }, [tail?.text, follow]);

  const selectedSource = sources.find((s) => s.id === selected);
  const moving = tail?.updated && Date.now() - tail.updated < 60_000;

  return (
    <div className="mx-auto flex h-full max-w-[900px] flex-col px-6 py-6 font-sans">
      <div className="mb-1 flex items-baseline justify-between">
        <h1 className="text-2xl text-[var(--bright)]">Activity</h1>
        <span className="text-[10px] uppercase tracking-[2px] text-[var(--dim)]">
          live · refreshes every 2s
        </span>
      </div>
      <p className="mb-4 text-xs text-[var(--dim)]">
        What Jarvis is doing right now. A green chip means the process is alive; a moving log
        means it's making progress.
      </p>

      <div className="mb-4 flex flex-wrap gap-2">
        <ActivityChip on={!!act?.recorder} label="RECORDING" />
        <ActivityChip on={!!act?.whisper} label="TRANSCRIBING (WHISPER)" />
        <ActivityChip on={!!act?.processor} label="CALL PROCESSOR" />
        <ActivityChip on={!!act?.claude} label="CLAUDE WORKER" />
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        {sources.map((s) => (
          <button
            key={s.id}
            onClick={() => setParams({ src: s.id })}
            className={`rounded-full border px-3 py-1 text-[10px] ${
              s.id === selected
                ? "border-[rgba(57,215,255,.4)] bg-[rgba(57,215,255,.08)] text-[var(--cyan)]"
                : "border-[var(--line)] text-[var(--dim)] hover:text-[var(--bright)]"
            }`}
          >
            {s.label}
            <span className="ml-2 opacity-60">{ago(s.updated)}</span>
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1 flex-col rounded-xl border border-[var(--line)] bg-[var(--field)]">
        <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-2">
          <span className="text-[10px] uppercase tracking-[1.5px] text-[var(--dim)]">
            {selectedSource?.label ?? "log"}
            {tail?.updated && (
              <span className={moving ? "ml-2 text-[var(--green)]" : "ml-2 text-[var(--amber)]"}>
                · updated {ago(tail.updated)}
              </span>
            )}
          </span>
          <label className="flex cursor-pointer items-center gap-2 text-[10px] text-[var(--dim)]">
            <input
              type="checkbox"
              checked={follow}
              onChange={(e) => setFollow(e.target.checked)}
              className="accent-[var(--cyan)]"
            />
            follow
          </label>
        </div>
        <pre
          ref={preRef}
          className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap p-4 font-mono text-[11px] leading-relaxed text-[var(--dim)]"
        >
          {tail?.text ?? "select a log"}
        </pre>
      </div>
    </div>
  );
}
