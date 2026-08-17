// Global header pill: pulsing REC + elapsed time whenever a call is being
// captured. Click → open the call; hover reveals ■ stop.
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useRecordingControls, useRecState } from "./hooks";

function elapsed(started: string): string {
  const t0 = new Date(started.replace(" ", "T")).getTime();
  const s = Math.max(0, Math.floor((Date.now() - t0) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function RecordingPill() {
  const { data } = useRecState();
  const { stop } = useRecordingControls();
  const navigate = useNavigate();
  const [, tick] = useState(0);

  useEffect(() => {
    if (!data?.recording) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [data?.recording]);

  if (!data?.recording) return null;
  return (
    <button
      onClick={() => navigate(`/calls/${data.id}`)}
      title="Recording a call — click to open, ■ to stop & save"
      className="group flex items-center gap-2 rounded-full border border-[rgba(255,92,122,.45)] bg-[rgba(255,92,122,.08)] px-3 py-[5px] text-[10px] font-bold tracking-[1.5px] text-[var(--red)] hover:shadow-[0_0_14px_rgba(255,92,122,.35)]"
    >
      <span className="blip h-[7px] w-[7px] rounded-full bg-current" />
      {stop.isPending ? "SAVING…" : `REC ${elapsed(data.started)}`}
      <span
        role="button"
        title="Stop & save now"
        onClick={(e) => { e.stopPropagation(); stop.mutate(); }}
        className="hidden h-[18px] w-[18px] items-center justify-center rounded-full bg-[var(--red)] text-[9px] text-white group-hover:flex"
      >
        ■
      </span>
    </button>
  );
}
