// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// Telegram surface — talk to Jarvis from your phone.
// Long-polling (getUpdates), so it works from a laptop behind NAT with no
// public URL, no webhook, no tunnel. Bound to exactly ONE owner chat id:
// anyone can find any bot, so every update from another chat is ignored.
// Setup: `jarvis telegram` (writes TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID
// into gitignored secrets/.env), then restart.
import { readSecrets } from "../services/env.js";
import { sendTurn } from "../services/chatSessions.js";
import { dispatchDelegate } from "../services/agents.js";
import { onEvent } from "../live/liveState.js";

const SESSION = "telegram";
const DELIVER_PROMPT =
  "A background worker just finished and its result was recorded in your pending context. " +
  "Relay the outcome to me now, concisely. Do not delegate again.";

let token = "";
let ownerChat = "";
let offset = 0;

async function api(method: string, payload: Record<string, unknown> = {}): Promise<any> {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json();
}

// Telegram caps messages at 4096 chars — chunk on line boundaries
async function say(text: string) {
  const t = text.trim();
  if (!t) return;
  for (let i = 0; i < t.length; i += 4000) {
    await api("sendMessage", { chat_id: ownerChat, text: t.slice(i, i + 4000) }).catch(() => {});
  }
}

// One full assistant turn: stream to completion, handle ACTION:DELEGATE the
// same way the dashboard does (strip the line, dispatch the worker).
function runTurn(message: string): Promise<string> {
  return new Promise((resolve) => {
    let acc = "";
    const r = sendTurn(SESSION, message, {
      onText: (t) => { acc += t; },
      onDone: (finalText) => {
        let out = finalText ?? acc;
        const m = out.match(/^ACTION:DELEGATE\s+(\{.*\})\s*$/m);
        if (m) {
          try { dispatchDelegate(JSON.parse(m[1]), SESSION); } catch {}
          out = out.replace(m[0], "").trim() || "On it — I'll message you when it's done.";
        }
        resolve(out);
      },
    });
    if (r.busy) resolve("Still working on your previous message — one moment.");
  });
}

async function handleUpdate(u: any) {
  const msg = u.message;
  if (!msg) return;
  const chat = String(msg.chat?.id ?? "");
  if (chat !== ownerChat) {
    console.log(`[telegram] ignored message from non-owner chat ${chat}`);
    return;
  }
  const text: string | undefined = msg.text;
  if (!text) {
    await say("I can only read text here so far — voice notes are on the roadmap.");
    return;
  }
  api("sendChatAction", { chat_id: ownerChat, action: "typing" }).catch(() => {});
  await say(await runTurn(text));
}

async function pollLoop() {
  for (;;) {
    try {
      const r = await api("getUpdates", { timeout: 50, offset });
      for (const u of r.result ?? []) {
        offset = u.update_id + 1;
        await handleUpdate(u);
      }
    } catch {
      await new Promise((res) => setTimeout(res, 5000));   // net blip — back off
    }
  }
}

export function startTelegram() {
  const s = readSecrets();
  token = s.TELEGRAM_BOT_TOKEN ?? "";
  ownerChat = s.TELEGRAM_CHAT_ID ?? "";
  if (!token || !ownerChat) {
    console.log("[telegram] not configured — run `jarvis telegram` to set up");
    return;
  }
  // when a worker spawned from the telegram session finishes, deliver the
  // result to the phone instead of leaving dead air after "On it"
  onEvent((e: any) => {
    if (e?.type === "worker-result" && e?.sessionId === SESSION)
      runTurn(DELIVER_PROMPT).then(say).catch(() => {});
  });
  void pollLoop();
  console.log("[telegram] listening (long-poll)");
}
