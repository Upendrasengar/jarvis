#!/usr/bin/env bash
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
    (cd "$JARVIS_DIR/apps/server" && \
      JARVIS_API_PORT="$PORT" nohup node_modules/.bin/tsx src/index.ts \
        >> "$JARVIS_DIR/reports/api.log" 2>&1 &)
    for _ in $(seq 1 15); do ui_up && break; sleep 1; done
    if ui_up; then
      echo "server:     started → http://localhost:$PORT"
    else
      echo "server:     FAILED — check reports/api.log"
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
