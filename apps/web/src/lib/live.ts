// Live channel client: one WebSocket; any "fs" message invalidates the
// file-backed queries. Auto-reconnects; polling in the hooks remains only as
// a slow fallback for when the socket is down.
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

export function useLive() {
  const qc = useQueryClient();
  useEffect(() => {
    let ws: WebSocket | null = null;
    let closed = false;
    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${proto}://${location.host}/api/live`);
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === "fs") {
            for (const key of ["calls", "recstate", "actions", "autorecord", "notes", "note"])
              qc.invalidateQueries({ queryKey: [key] });
          } else if (msg.type === "worker-result") {
            window.dispatchEvent(new CustomEvent("jarvis:worker-result", { detail: msg }));
          }
        } catch {}
      };
      ws.onclose = () => { if (!closed) setTimeout(connect, 3000); };
    };
    connect();
    return () => { closed = true; ws?.close(); };
  }, [qc]);
}
