// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Call } from "@jarvis/shared";
import { api } from "../../lib/api";

export function callTitle(c: Call): string {
  const m = c.notes.match(/^# (.+)$/m);
  if (m) return m[1];
  const fm = c.notes.match(/^---\n[\s\S]*?^title:\s*"?([^"\n]+)"?$[\s\S]*?\n---/m);
  if (fm) return fm[1].trim();
  return c.status === "recording" ? "Recording…" : "Call at " + c.started.slice(11, 16);
}

// Short source label: hostname for browser calls, a friendly tag otherwise.
export function callHost(u: string): string {
  if (!u) return "";
  try { return new URL(u).hostname.replace(/^www\./, "").replace(".com", ""); } catch {}
  if (/teams/i.test(u)) return /browser/i.test(u) ? "teams web" : "teams app";
  if (/manual/i.test(u)) return "manual";
  return u.slice(0, 22);
}

export function useCalls() {
  return useQuery({
    queryKey: ["calls"],
    queryFn: api.calls,
    // live-refresh while something is recording or transcribing
    refetchInterval: (q) =>
      q.state.data?.some((c) => c.status === "recording" || c.status === "processing")
        ? 10_000
        : 30_000,
  });
}

export function useRecState() {
  return useQuery({ queryKey: ["recstate"], queryFn: api.recState, refetchInterval: 10_000 });
}

export function useAutorecord() {
  return useQuery({ queryKey: ["autorecord"], queryFn: api.autorecord });
}

function invalidator(keys: string[][]) {
  const qc = useQueryClient();
  return () => keys.forEach((k) => qc.invalidateQueries({ queryKey: k }));
}

export function useToggleItem() {
  const done = invalidator([["calls"]]);
  return useMutation({
    mutationFn: ({ id, index }: { id: string; index: number }) => api.toggleCallItem(id, index),
    onSettled: done,
  });
}

export function useDeleteCall() {
  const done = invalidator([["calls"]]);
  return useMutation({ mutationFn: api.deleteCall, onSettled: done });
}

export function useUpdateNotes() {
  const done = invalidator([["calls"], ["actions"]]);
  return useMutation({
    mutationFn: async ({ id, notes }: { id: string; notes: string }) => {
      const r = await fetch("/api/calls/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, notes }),
      });
      if (!r.ok) throw new Error(`save → ${r.status}`);
    },
    onSettled: done,
  });
}

export function useSetAutorecord() {
  const done = invalidator([["autorecord"]]);
  return useMutation({ mutationFn: api.setAutorecord, onSettled: done });
}

export function useProcessQueue() {
  return useQuery({ queryKey: ["process-queue"], queryFn: api.processQueue, refetchInterval: 15_000 });
}

export function useSetProcessPolicy() {
  const done = invalidator([["process-queue"], ["calls"]]);
  return useMutation({ mutationFn: api.setProcessPolicy, onSettled: done });
}

export function useProcessPause() {
  const done = invalidator([["process-queue"]]);
  return useMutation({
    mutationFn: ({ on, minutes }: { on: boolean; minutes?: number }) => api.setProcessPause(on, minutes),
    onSettled: done,
  });
}

export function useRecordingControls() {
  const done = invalidator([["calls"], ["recstate"], ["process-queue"]]);
  const stop = useMutation({
    // the server waits for the session to end before answering, so a short
    // settle is enough for the card to flip
    mutationFn: (id?: string) => api.stopRecording(id),
    onSettled: () => setTimeout(done, 1000),
  });
  const start = useMutation({
    mutationFn: api.startRecording,
    onSettled: () => setTimeout(done, 2500),
  });
  return { stop, start };
}

// Live assist: polled fast while the call runs — the list is meant to be
// read mid-sentence, so a 30s refetch would feel dead.
// After the call the same endpoint serves the recap (history), so it is
// fetched once for any call and only polled while recording.
export function useLiveAssist(id: string | null, recording: boolean) {
  return useQuery({
    queryKey: ["live", id],
    queryFn: () => api.liveAssist(id as string),
    enabled: !!id,
    refetchInterval: recording ? 5_000 : false,
  });
}

export function useSetLiveAssist() {
  const done = invalidator([["live"]]);
  return useMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) => api.setLiveAssist(id, on),
    onSettled: done,
  });
}

export function useLiveDone() {
  const done = invalidator([["live"]]);
  return useMutation({
    mutationFn: ({ id, itemId, on }: { id: string; itemId: string; on: boolean }) => api.liveDone(id, itemId, on),
    onSettled: done,
  });
}

export function useLiveDefault() {
  return useQuery({ queryKey: ["live-default"], queryFn: api.liveDefault });
}

export function useSetLiveDefault() {
  const done = invalidator([["live-default"], ["live"]]);
  return useMutation({ mutationFn: api.setLiveDefault, onSettled: done });
}
