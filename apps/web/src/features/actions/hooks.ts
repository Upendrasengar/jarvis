// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as S from "@jarvis/shared";

async function fetchActions() {
  const r = await fetch("/api/actions");
  if (!r.ok) throw new Error(`actions → ${r.status}`);
  return S.ActionItem.array().parse(await r.json());
}

export function useActions() {
  return useQuery({ queryKey: ["actions"], queryFn: fetchActions, refetchInterval: 60_000 });
}

// Checking a box used to wait for the server, then invalidate — so every
// click round-tripped, re-split open/done, and reflowed the whole ledger
// under the cursor. The flip is applied to the cache first; the refetch that
// follows confirms it silently (react-query keeps the old data while it
// fetches, so nothing blanks out).
export function useToggleAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ callId, index }: { callId: string; index: number }) => {
      const r = await fetch("/api/actions/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callId, index }),
      });
      if (!r.ok) throw new Error(`toggle → ${r.status}`);
    },
    onMutate: async ({ callId, index }) => {
      await qc.cancelQueries({ queryKey: ["actions"] });
      const prev = qc.getQueryData<S.ActionItem[]>(["actions"]);
      qc.setQueryData<S.ActionItem[]>(["actions"], (old) =>
        old?.map((i) => (i.callId === callId && i.index === index ? { ...i, done: !i.done } : i)));
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(["actions"], ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["actions"] });
      qc.invalidateQueries({ queryKey: ["calls"] });
    },
  });
}
