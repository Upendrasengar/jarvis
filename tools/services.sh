#!/usr/bin/env bash
# Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
# services.sh — one switch for Jarvis's long-running services:
#   server      apps/server (Fastify API + built web app) on :${JARVIS_UI_PORT:-4321}
#   call-watch  tools/call-watch.sh (Call Notes recorder)
#
# Usage: jarvis start|stop|restart|status   (routed here by the launcher)
set -uo pipefail

JARVIS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Port precedence: JARVIS_UI_PORT env > memory/settings/port.txt > 4321
PORT="${JARVIS_UI_PORT:-$(head -1 "$JARVIS_DIR/memory/settings/port.txt" 2>/dev/null | tr -cd '0-9')}"
PORT="${PORT:-4321}"

# Node precedence: JARVIS_NODE env > memory/settings/node-bin.txt > PATH.
# The Homebrew wrapper sets JARVIS_NODE; running from a clone there is no
# wrapper, so without the setting a Homebrew node ahead of nvm on PATH boots
# an ABI the native modules were not built for and better-sqlite3 refuses to
# load. The failure is a stack trace at startup, not a hint, so name it.
NODE_BIN="${JARVIS_NODE:-}"
if [ -z "$NODE_BIN" ]; then
  NODE_BIN="$(head -1 "$JARVIS_DIR/memory/settings/node-bin.txt" 2>/dev/null | tr -d '[:space:]')"
  if [ -n "$NODE_BIN" ] && [ ! -x "$NODE_BIN" ]; then
    echo "warning: memory/settings/node-bin.txt points at a missing binary ($NODE_BIN) — falling back to PATH" >&2
    NODE_BIN=""
  fi
fi
NODE_BIN="${NODE_BIN:-node}"

# A prebuilt artifact records the Node ABI its native modules were compiled
# against. Checking it here turns the failure that actually happened — a
# dlopen crash in api.log saying NODE_MODULE_VERSION, with the server simply
# not there — into one sentence naming the mismatch before anything starts.
if [ -f "$JARVIS_DIR/artifact.json" ]; then
  want="$(python3 -c "import json;print(json.load(open('$JARVIS_DIR/artifact.json')).get('nodeAbi',''))" 2>/dev/null || true)"
  have="$("$NODE_BIN" -p 'process.versions.modules' 2>/dev/null || true)"
  if [ -n "$want" ] && [ -n "$have" ] && [ "$want" != "$have" ]; then
    echo "server:     REFUSING to start — this build needs Node ABI $want, but $NODE_BIN is ABI $have" >&2
    echo "            point Jarvis at the right runtime:" >&2
    echo "              echo /path/to/node > memory/settings/node-bin.txt" >&2
    exit 1
  fi
fi

watch_pid()  { pgrep -f "bash.*call-watch\.sh" | head -1; }
server_pid() { lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | head -1; }
ui_up()      { curl -s "http://localhost:$PORT/api/health" >/dev/null 2>&1; }

start() {
  local p
  p="$(watch_pid)"
  if [ -n "$p" ]; then
    echo "call-watch: already running (pid $p)"
  else
    nohup bash "$JARVIS_DIR/tools/call-watch.sh" \
      >> "$JARVIS_DIR/reports/callwatch.log" 2>&1 &
    disown
    sleep 1
    p="$(watch_pid)"
    if [ -n "$p" ]; then
      echo "call-watch: started (pid $p)"
    else
      echo "call-watch: FAILED — check reports/callwatch.log"
    fi
  fi

  if ui_up; then
    echo "server:     already running → http://localhost:$PORT"
  else
    # JARVIS_NODE (set by the Homebrew wrapper) pins the exact node the
    # native modules were built against — PATH order must never decide this
    # tsx lives in two different places depending on how Jarvis was installed.
    # A pnpm workspace checkout has apps/server/node_modules/tsx; the published
    # artifact installs production deps flat with npm, so it is only at the
    # root. This resolved it RELATIVE to apps/server, which meant every
    # Homebrew install started and immediately died with MODULE_NOT_FOUND —
    # the server never came up and `jarvis start` just said FAILED.
    TSX="$JARVIS_DIR/apps/server/node_modules/tsx/dist/cli.mjs"
    [ -f "$TSX" ] || TSX="$JARVIS_DIR/node_modules/tsx/dist/cli.mjs"
    if [ ! -f "$TSX" ]; then
      echo "server:     FAILED — tsx not found (looked in apps/server/node_modules"
      echo "            and node_modules). The install is incomplete."
      return 1 2>/dev/null || exit 1
    fi
    (cd "$JARVIS_DIR/apps/server" && \
      JARVIS_API_PORT="$PORT" nohup "$NODE_BIN" "$TSX" src/index.ts \
        >> "$JARVIS_DIR/reports/api.log" 2>&1 &)
    for _ in $(seq 1 15); do ui_up && break; sleep 1; done
    if ui_up; then
      echo "server:     started → http://localhost:$PORT"
    else
      echo "server:     FAILED — check reports/api.log"
      if grep -q "NODE_MODULE_VERSION" "$JARVIS_DIR/reports/api.log" 2>/dev/null; then
        echo "            cause: this node ($("$NODE_BIN" -v 2>/dev/null)) is not the one the native"
        echo "            modules were built against. Point Jarvis at the right one:"
        echo "              echo /path/to/node > memory/settings/node-bin.txt"
      fi
    fi
  fi
  open "http://localhost:$PORT" 2>/dev/null || true
}

stop() {
  local p
  p="$(watch_pid)"
  if [ -n "$p" ]; then
    # TERM triggers call-watch's trap: an in-progress recording is stopped
    # cleanly and still gets transcribed.
    kill "$p" 2>/dev/null
    for _ in $(seq 1 20); do
      kill -0 "$p" 2>/dev/null || break
      sleep 1
    done
    if kill -0 "$p" 2>/dev/null; then
      echo "call-watch: still shutting down (pid $p) — finishing a recording?"
    else
      echo "call-watch: stopped"
    fi
  else
    echo "call-watch: not running"
  fi

  p="$(server_pid)"
  if [ -n "$p" ]; then
    kill "$p" 2>/dev/null
    echo "server:     stopped"
  else
    echo "server:     not running"
  fi
}

status() {
  local p
  p="$(watch_pid)"
  [ -n "$p" ] && echo "call-watch: running (pid $p)" || echo "call-watch: stopped"
  ui_up && echo "server:     running → http://localhost:$PORT" || echo "server:     stopped"
  if pgrep -qf "call-capture/bin/audiocap"; then
    echo "recording:  🔴 a call is being recorded right now"
  fi
}

case "${1:-status}" in
  start)   start ;;
  stop)    stop ;;
  restart) stop; sleep 1; start ;;
  status)  status ;;
  *) echo "usage: jarvis start|stop|restart|status"; exit 2 ;;
esac
