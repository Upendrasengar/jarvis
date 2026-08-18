// Live channel: one WebSocket that tells clients "something changed on disk —
// refetch". Replaces the old per-tab polling loops. Watches the session dirs
// and the notes files; debounced so a burst of writes is one message.
import fs from "node:fs";
import type { WebSocket } from "@fastify/websocket";
import { BRAIN_DIR, CALLS_DIR, REPORTS_DIR } from "../config.js";
import path from "node:path";

const clients = new Set<WebSocket>();
let debounce: ReturnType<typeof setTimeout> | null = null;

function broadcast() {
  send({ type: "fs", at: Date.now() });
}

function send(payload: object) {
  const msg = JSON.stringify(payload);
  for (const ws of clients) {
    try { ws.send(msg); } catch {}
  }
}

// server-side subscribers (e.g. the Telegram surface) hear pushes too
type Listener = (e: object) => void;
const listeners = new Set<Listener>();
export function onEvent(fn: Listener) { listeners.add(fn); }

// immediate push (no debounce) — e.g. "a worker finished for session X"
export function pushEvent(payload: object) {
  send({ ...payload, at: Date.now() });
  for (const fn of listeners) { try { fn(payload); } catch {} }
}

function onFsEvent() {
  if (debounce) clearTimeout(debounce);
  debounce = setTimeout(broadcast, 500);
}

export function startWatching() {
  for (const dir of [CALLS_DIR, REPORTS_DIR, path.join(BRAIN_DIR, "Notes")]) {
    try {
      fs.watch(dir, { recursive: true }, onFsEvent);
    } catch {
      // dir may not exist yet — the interval fallback still covers us
    }
  }
  // belt & braces: heartbeat so a missed fs event heals within 30s
  setInterval(onFsEvent, 30_000).unref();
}

// sockets whose client declared "Jarvis holds the mic" — presence, not
// heartbeat: membership ends the moment the socket closes
const voiceClients = new Set<WebSocket>();
export function voiceActive(): boolean { return voiceClients.size > 0; }

export function addClient(ws: WebSocket) {
  clients.add(ws);
  ws.send(JSON.stringify({ type: "hello", at: Date.now() }));
  ws.on("message", (buf: Buffer) => {
    try {
      const m = JSON.parse(String(buf));
      if (m?.type === "voice") m.on ? voiceClients.add(ws) : voiceClients.delete(ws);
    } catch {}
  });
  ws.on("close", () => { clients.delete(ws); voiceClients.delete(ws); });
  ws.on("error", () => { clients.delete(ws); voiceClients.delete(ws); });
}
