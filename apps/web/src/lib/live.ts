// Live channel client: one WebSocket; any "fs" message invalidates the
// file-backed queries. Auto-reconnects; polling in the hooks remains only as
// a slow fallback for when the socket is down.
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

// Voice presence rides the live socket: the server treats "a connected
// socket that declared voice=on" as proof Jarvis holds the mic, so the call
// watcher won't mistake it for a Teams call. A socket dies the instant the
// tab does — unlike heartbeat timers, which browsers throttle.
let liveWs: WebSocket | null = null;
let voiceOn = false;
function pushVoice() {
  try { liveWs?.send(JSON.stringify({ type: "voice", on: voiceOn })); } catch {}
}
export function setVoicePresence(on: boolean) {
  voiceOn = on;
  pushVoice();
}

export function useLive() {
  const qc = useQueryClient();
  useEffect(() => {
    let ws: WebSocket | null = null;
    let closed = false;
    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${proto}://${location.host}/api/live`);
      liveWs = ws;
      ws.onopen = () => pushVoice();   // re-declare after every reconnect
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
