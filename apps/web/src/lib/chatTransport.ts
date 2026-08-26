// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// Shared chat transport — used by the chat page (visible conversation) and
// the header voice bar (background conversation from any tab). Handles the
// SSE stream and the ACTION:DELEGATE protocol in one place.
export type Msg = { c: "me" | "jarvis"; t: string; imgs?: string[]; ts?: number; id?: string };

const TX_KEY = (sid: string) => "jarvis_tx_" + sid;
const DELEGATE_RE = /ACTION:DELEGATE\s*(\{[\s\S]*?\})\s*/;
const REMIND_RE = /ACTION:REMIND\s*(\{[\s\S]*?\})\s*/;

export function loadTranscript(sid: string): Msg[] {
  try { return JSON.parse(localStorage.getItem(TX_KEY(sid)) ?? "[]"); } catch { return []; }
}

export function saveTranscript(sid: string, msgs: Msg[]) {
  try { localStorage.setItem(TX_KEY(sid), JSON.stringify(msgs.slice(-60))); } catch {}
}

export function appendTranscript(sid: string, msgs: Msg[]) {
  saveTranscript(sid, [...loadTranscript(sid), ...msgs]);
}

export function currentSessionId(): string {
  let sid = localStorage.getItem("jarvis_session");
  if (!sid) {
    sid = crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
    localStorage.setItem("jarvis_session", sid);
  }
  return sid;
}

// Streams one turn; forwards any delegation directive; resolves with the
// final visible text (directive stripped). onText receives progressive text.
export async function streamChatTurn(
  sessionId: string,
  message: string,
  onText?: (visible: string) => void,
  images?: string[],
): Promise<string> {
  let full = "";
  let delegated = false;
  const visible = () => full.replace(DELEGATE_RE, "").replace(REMIND_RE, "").trimEnd();

  const maybeDelegate = () => {
    if (delegated) return;
    const dm = full.match(DELEGATE_RE);
    if (!dm) return;
    delegated = true;
    try {
      const d = JSON.parse(dm[1]);
      d.sessionId = sessionId;
      fetch("/api/delegate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(d),
      }).catch(() => {});
    } catch {}
  };

  let reminded = false;
  const maybeRemind = () => {
    if (reminded) return;
    const rm = full.match(REMIND_RE);
    if (!rm) return;
    reminded = true;
    try {
      const r = JSON.parse(rm[1]);
      fetch("/api/reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: r.name, schedule: r.schedule, message: r.message }),
      }).catch(() => {});
    } catch {}
  };

  // The turn flag gates worker-result delivery. It used to be cleared only on
  // the happy path, so ONE failed fetch or aborted stream left it stuck true
  // for the life of the page and every later answer was silently dropped.
  (window as any)._jarvisTurnActive = true;
  try {
    const r = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, sessionId, images }),
    });
    if (!r.ok || !r.body) throw new Error(`chat → ${r.status}`);

    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const chunk = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const ev = chunk.match(/^event: (\w+)$/m)?.[1] ?? "message";
        const data = chunk.match(/^data: (.*)$/m)?.[1];
        if (data === undefined) continue;
        if (ev === "err") { onText?.(JSON.parse(data)); continue; }
        if (ev === "done") continue;
        full += JSON.parse(data);
        maybeDelegate();
        maybeRemind();
        onText?.(visible() || "…");
      }
    }
  } finally {
    (window as any)._jarvisTurnActive = false;
  }
  return visible() || (delegated ? "On it." : "");
}
