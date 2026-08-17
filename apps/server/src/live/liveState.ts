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

// immediate push (no debounce) — e.g. "a worker finished for session X"
export function pushEvent(payload: object) {
  send({ ...payload, at: Date.now() });
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

export function addClient(ws: WebSocket) {
  clients.add(ws);
  ws.send(JSON.stringify({ type: "hello", at: Date.now() }));
  ws.on("close", () => clients.delete(ws));
  ws.on("error", () => clients.delete(ws));
}
