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
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["actions"] });
      qc.invalidateQueries({ queryKey: ["calls"] });
    },
  });
}
