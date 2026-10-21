#!/usr/bin/env bash
# Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
# process-queue.sh — decides WHEN a recorded call gets transcribed.
#
# Recording is immediate and always was; this only governs the expensive
# part. Transcribing a 20-minute call runs whisper flat out for several
# minutes, and doing that the moment a meeting ends — which is exactly when
# the owner is back at the keyboard, or already on the next call — is what
# made the machine crawl. So a finished session is a queue entry, and this
# script is the one place that decides whether now is a good time.
#
# Policy lives in memory/settings/process-policy.txt (first line):
#   now                 transcribe as soon as a call ends (the old behaviour)
#   idle                wait until the Mac has been untouched for a few minutes
#   window HH:MM-HH:MM  only inside that daily window (may cross midnight)
#   manual              only when asked (UI "Process now", or `now` below)
# Missing or unreadable → now, so an install that never sets it is unchanged.
#
# A pause (data/process-pause, epoch second it expires) overrides every mode:
# "I'm busy, hold everything for an hour." Every mode also refuses to start
# while a call is being recorded — back-to-back meetings are the worst
# moment for whisper to grab every core.
#
# One processor at a time, oldest session first. Plain bash, no LLM.
#
# Usage:
#   process-queue.sh tick            evaluate; start one session if allowed
#   process-queue.sh status          evaluate; write state only, start nothing
#   process-queue.sh pending         print pending session ids, oldest first
#   process-queue.sh now <session>   process a session right away, policy aside
#   process-queue.sh kill <session>  stop a processor that is running on it
set -uo pipefail

JARVIS_DIR="${JARVIS_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
# shellcheck source=tools/paths.sh
source "$JARVIS_DIR/tools/paths.sh"
CALLS_DIR="$JARVIS_DIR/reports/calls"
BIN="$JARVIS_DIR/tools/call-capture/bin"
POLICY_FILE="$JARVIS_DIR/memory/settings/process-policy.txt"
PAUSE_FILE="$JARVIS_DIR/data/process-pause"
STATE_FILE="$JARVIS_DIR/data/process-queue.json"
IDLE_SECS=300      # "untouched" = no keyboard/mouse/trackpad input this long
MIN_BATTERY=50     # on battery below this, wait for power

mkdir -p "$JARVIS_DIR/data" 2>/dev/null || true

# ── policy ───────────────────────────────────────────────────────────────
MODE="now"; WINDOW=""
read_policy() {
  local line
  line="$(head -1 "$POLICY_FILE" 2>/dev/null | tr -d '\r' | tr 'A-Z' 'a-z' | sed 's/^ *//;s/ *$//')"
  case "$line" in
    now|idle|manual) MODE="$line" ;;
    window\ [0-9][0-9]:[0-9][0-9]-[0-9][0-9]:[0-9][0-9])
      MODE="window"; WINDOW="${line#window }" ;;
    "") MODE="now" ;;
    *)  MODE="now"; echo "process-queue: unreadable policy '$line' — treating as 'now'" >&2 ;;
  esac
}

paused_until() {   # epoch second, or 0
  local u
  u="$(head -1 "$PAUSE_FILE" 2>/dev/null | tr -cd '0-9')"
  [ -n "$u" ] && [ "$(date +%s)" -lt "$u" ] && { echo "$u"; return; }
  echo 0
}

in_window() {      # $1 = HH:MM-HH:MM; 0 when now is inside it
  local a b now
  a=$(( 10#${1:0:2} * 60 + 10#${1:3:2} ))
  b=$(( 10#${1:6:2} * 60 + 10#${1:9:2} ))
  now=$(( 10#$(date +%H) * 60 + 10#$(date +%M) ))
  if [ "$a" -le "$b" ]; then [ "$now" -ge "$a" ] && [ "$now" -lt "$b" ]
  else [ "$now" -ge "$a" ] || [ "$now" -lt "$b" ]; fi
}

# Seconds since the last keyboard/mouse/trackpad event. Unreadable (no window
# server, ssh session) → a huge number: a machine nobody can touch is idle.
# Never let a failed probe block the queue forever.
idle_secs() {
  local ns
  ns="$(ioreg -c IOHIDSystem 2>/dev/null | awk '/HIDIdleTime/ {print $NF; exit}' | tr -cd '0-9')"
  [ -n "$ns" ] && echo $(( ns / 1000000000 )) || echo 999999
}

# "ac" | "battery NN" | "unknown". Unknown never blocks.
power_state() {
  local out pct
  out="$(pmset -g batt 2>/dev/null)" || { echo unknown; return; }
  if grep -q "AC Power" <<<"$out"; then echo ac; return; fi
  pct="$(grep -o '[0-9]\+%' <<<"$out" | head -1 | tr -cd '0-9')"
  [ -n "$pct" ] && echo "battery $pct" || echo unknown
}

# ── queue ────────────────────────────────────────────────────────────────
has_notes() {      # $1 = session id
  [ -s "$CALL_NOTES_DIR/call-notes-$1.md" ] || [ -s "$CALL_NOTES_DIR/call-$1.md" ]
}

# Pending = ended, has audio, no notes yet, not failed, no processor on it.
# Oldest first, because the oldest debt is the one the digest has been
# missing longest. A FAILED session is not retried on its own — the UI's
# Rerun button is the documented recovery and it clears the marker.
pending() {
  local m d s
  for m in "$CALLS_DIR"/*/meta.txt; do
    [ -f "$m" ] || continue
    grep -q '^ended:' "$m" || continue
    d="$(dirname "$m")"; s="$(basename "$d")"
    { [ -s "$d/mic.wav" ] || [ -s "$d/system.wav" ] || [ -s "$d/system16.wav" ]; } || continue
    has_notes "$s" && continue
    [ -f "$d/FAILED.txt" ] && continue
    [ -d "$d/.processing" ] && continue
    echo "$s"
  done | sort
}

# The session a live processor is working on (empty when none). Covers both
# queue-started runs and UI reruns — one at a time means one, whoever asked.
running() {
  ps -axo command= 2>/dev/null \
    | grep -E '[p]rocess-call\.sh' | grep -F -- "$CALLS_DIR/" \
    | grep -oE 'calls/[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{4}' | head -1 | sed 's|calls/||'
}

# A call is being captured: any session without an "ended:" line.
recording_now() {
  local m
  for m in "$CALLS_DIR"/*/meta.txt; do
    [ -f "$m" ] || continue
    grep -q '^ended:' "$m" || { echo "$(basename "$(dirname "$m")")"; return 0; }
  done
  return 1
}

mic_in_use() { [ -x "$BIN/miccheck" ] && [ "$("$BIN/miccheck" 2>/dev/null)" = "1" ]; }

# Why the queue is not starting anything right now — empty means "go".
# Order matters: the reasons a human would want to see first come first.
IDLE=0; POWER="unknown"; PAUSED=0
why_waiting() {
  local rec
  PAUSED="$(paused_until)"
  if [ "$PAUSED" != 0 ]; then
    echo "paused until $(date -r "$PAUSED" '+%H:%M' 2>/dev/null || echo later)"; return
  fi
  if rec="$(recording_now)"; then echo "a call is recording ($rec)"; return; fi
  case "$MODE" in
    manual) echo "waiting for you — use Process now" ;;
    window) in_window "$WINDOW" || echo "waiting for the ${WINDOW%-*} window" ;;
    idle)
      IDLE="$(idle_secs)"; POWER="$(power_state)"
      if mic_in_use; then echo "microphone in use"
      elif [ "$IDLE" -lt "$IDLE_SECS" ]; then echo "you're using the Mac (idle $((IDLE / 60))m $((IDLE % 60))s, need $((IDLE_SECS / 60))m)"
      elif [ "${POWER%% *}" = battery ] && [ "${POWER#* }" -lt "$MIN_BATTERY" ]; then echo "on battery (${POWER#* }%)"
      fi ;;
    now) ;;
  esac
}

# Machine-readable state for the server/UI. python3 does the quoting: a
# reason string with a quote in it must not corrupt the file.
write_state() {   # $1 = waiting reason, $2 = running id, $3 = newline list of pending
  python3 - "$STATE_FILE" "$MODE" "$WINDOW" "$PAUSED" "$1" "$2" "$IDLE" "$POWER" "$3" <<'PY' 2>/dev/null || true
import json, sys, time, os
f, mode, window, paused, waiting, running, idle, power, pending = sys.argv[1:10]
state = {
  "updatedAt": int(time.time() * 1000),
  "policy": {"mode": mode, **({"window": window} if window else {})},
  "pausedUntil": int(paused) * 1000 if paused.isdigit() and int(paused) else 0,
  "running": running or None,
  "pending": [p for p in pending.split("\n") if p],
  "waiting": waiting,
  "idleSecs": int(idle) if idle.isdigit() else 0,
  "power": power,
}
tmp = f + ".tmp"
with open(tmp, "w") as fh: json.dump(state, fh)
os.replace(tmp, f)
PY
}

# Start the pipeline on one session, detached, log appended to the session.
# JARVIS_PROCESS_FG=1 asks process-call.sh to skip the background CPU tier —
# the owner pressed the button and is waiting; queue-started runs stay quiet.
launch() {        # $1 = session id, $2 = fg|bg
  local d="$CALLS_DIR/$1"
  [ -d "$d" ] || { echo "no such session: $1" >&2; return 1; }
  rm -f "$d/FAILED.txt"
  if [ "$2" = fg ]; then
    JARVIS_PROCESS_FG=1 nohup bash "$JARVIS_DIR/tools/process-call.sh" "$d" >> "$d/process.log" 2>&1 &
  else
    nohup bash "$JARVIS_DIR/tools/process-call.sh" "$d" >> "$d/process.log" 2>&1 &
  fi
  disown 2>/dev/null || true
  echo "$(date '+%H:%M:%S') process-queue: started $1 ($2)"
}

# Kill a processor and everything under it. whisper-cli is a child of the
# bash script, and killing only the script leaves whisper running to the end
# on a session that may already be deleted.
kill_tree() {
  local p
  for p in $(pgrep -P "$1" 2>/dev/null); do kill_tree "$p"; done
  kill -9 "$1" 2>/dev/null
}

cmd="${1:-tick}"
case "$cmd" in
  pending)
    read_policy; pending ;;
  tick|status)
    read_policy
    PAUSED="$(paused_until)"   # always reported, even while a run is in flight
    RUN="$(running)"
    PEND="$(pending)"
    WHY=""
    if [ -n "$RUN" ]; then WHY="transcribing $RUN"
    else WHY="$(why_waiting)"; fi
    write_state "$WHY" "$RUN" "$PEND"
    [ "$cmd" = status ] && exit 0
    [ -n "$RUN" ] && exit 0
    [ -z "$PEND" ] && exit 0
    [ -n "$WHY" ] && exit 0
    first="$(head -1 <<<"$PEND")"
    launch "$first" bg
    # reflect the start immediately — the UI reads this file
    write_state "transcribing $first" "$first" "$(tail -n +2 <<<"$PEND")"
    ;;
  now)
    read_policy
    id="$(basename "${2:?session required}")"
    if r="$(running)" && [ "$r" = "$id" ]; then echo "already processing $id"; exit 0; fi
    launch "$id" fg
    ;;
  kill)
    id="$(basename "${2:?session required}")"
    d="$CALLS_DIR/$id"
    for p in $(ps -axo pid=,command= 2>/dev/null | grep -E "[p]rocess-call\.sh.*calls/$id" | awk '{print $1}'); do
      echo "$(date '+%H:%M:%S') process-queue: killing processor $p for $id"
      kill_tree "$p"
    done
    rmdir "$d/.processing" 2>/dev/null || true
    ;;
  *)
    echo "usage: process-queue.sh tick|status|pending|now <session>|kill <session>" >&2; exit 2 ;;
esac
