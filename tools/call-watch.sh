#!/usr/bin/env bash
# call-watch.sh — Call Notes capability, stage 1: detect + record.
# Polls browser tabs for an active meeting (Meet/Teams/Zoom/Webex/Whereby URL
# + microphone in use), records BOTH sides (mic = you, system audio = them),
# notifies you that recording is on, and hands the finished session to
# process-call.sh for transcription + notes.
#
# Plain bash, no LLM. Run it in the background or via the launchd example:
#   tools/com.jarvis.callwatch.plist.example
#
# Consent note: this does NOT announce recording to other participants the
# way native Meet/Teams recording does. The macOS notification tells YOU it
# is on; informing others is on you.
set -uo pipefail

JARVIS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="$JARVIS_DIR/tools/call-capture/bin"
CALLS_DIR="$JARVIS_DIR/reports/calls"
POLL=15          # seconds between checks
END_MISSES=2     # consecutive polls with no meeting tab before we stop

# URL patterns that mean "in (or entering) a call". Mic-in-use gates false
# positives like a Meet tab parked on the landing page. Teams matches only
# meeting-join URLs — a Teams web tab (/v2/) can stay open all day, so the
# bare domain would phantom-trigger on ANY mic use (calls happen in the
# desktop app anyway, which this v1 doesn't capture).
MEETING_RE='meet\.google\.com/[a-z0-9]+-[a-z0-9]+|teams\.(microsoft|live)\.com/.*(meetup-join|/meet/|/call/)|zoom\.us/(j|s|wc)/|whereby\.com/.|webex\.com/(meet|join|wbxmjs)'

BROWSERS=("Google Chrome" "Microsoft Edge" "Brave Browser" "Arc" "Chromium")

# Auto-record preference — memory/settings/autorecord.txt says "off" to disable
# auto-detection (UI toggle writes it; checked every poll, no restart needed).
# Manual recording (USR2 / the UI Record button) works regardless.
autorec_on() {
  [ "$(tr -d '[:space:]' < "$JARVIS_DIR/memory/settings/autorecord.txt" 2>/dev/null)" != "off" ]
}

notify() {
  osascript -e "display notification \"$1\" with title \"Jarvis\" sound name \"Glass\"" >/dev/null 2>&1 || true
}

# Only query browsers that are actually running — AppleScript would LAUNCH
# a closed browser otherwise.
tab_urls() {
  local app
  for app in "${BROWSERS[@]}"; do
    pgrep -xq "$app" || continue
    osascript -e "tell application \"$app\" to get URL of tabs of windows" 2>/dev/null \
      | tr ',' '\n' | sed 's/^ *//'
  done
}

recording=0
misses=0
session=""
audiocap_pid=""
ffmpeg_pid=""
mode=""        # browser | teams-app | manual
rec_started=0

# PID of a Teams desktop process currently capturing the mic (empty if none).
# Precise: dictation, Jarvis voice, etc. won't match — only Teams holding it.
teams_mic_pid() {
  local p
  for p in $("$BIN/miccheck" --pids 2>/dev/null); do
    [ "$p" = "${ffmpeg_pid:-x}" ] && continue
    ps -o command= -p "$p" 2>/dev/null | grep -qi 'teams' && { echo "$p"; return; }
  done
}

# PID of a BROWSER process capturing the mic — the signal for Teams-in-browser
# calls, whose SPA URL never changes from /v2/ during a call.
browser_mic_pid() {
  local p
  for p in $("$BIN/miccheck" --pids 2>/dev/null); do
    [ "$p" = "${ffmpeg_pid:-x}" ] && continue
    ps -o command= -p "$p" 2>/dev/null | \
      grep -qiE 'Google Chrome|Chromium|Microsoft Edge|Brave Browser|Arc\.app' && { echo "$p"; return; }
  done
}

# any Teams tab at all (the SPA URL carries no meeting info once in-call)
TEAMS_TAB_RE='teams\.(microsoft|live)\.com'

# Jarvis continuous voice listening intentionally holds the browser mic —
# while its heartbeat file is fresh, the teams-web trigger must stand down
# or every listening session with a Teams tab open becomes a phantom call.
voice_listening() {
  # primary: live presence — the dashboard declares "Jarvis holds the mic"
  # over its WebSocket, so this is exact and dies with the tab (heartbeat
  # timers get throttled in background tabs; sockets don't)
  local port
  port="$(head -1 "$JARVIS_DIR/memory/settings/port.txt" 2>/dev/null | tr -cd '0-9')"
  if curl -s --max-time 2 "http://localhost:${port:-4321}/api/voicestate" 2>/dev/null       | grep -q '"listening":true'; then
    return 0
  fi
  # fallback: heartbeat file (covers a server-down window)
  local f="$JARVIS_DIR/data/voice-listening"
  [ -f "$f" ] || return 1
  [ $(( $(date +%s) - $(stat -f %m "$f" 2>/dev/null || echo 0) )) -lt 90 ]
}

start_recording() {
  local url="$1"
  mode="${2:-browser}"
  rec_started=$(date +%s)
  session="$CALLS_DIR/$(date +%Y-%m-%d-%H%M)"
  mkdir -p "$session"
  {
    echo "url: $url"
    echo "mode: $mode"
    echo "started: $(date '+%Y-%m-%d %H:%M:%S')"
  } > "$session/meta.txt"

  # Calendar HINT (optional adapter): stamp events overlapping this moment.
  # A hint, never truth — the recording may be an ad-hoc call sitting on top
  # of a scheduled block; the summarizer verifies against the transcript.
  if [ -f "$JARVIS_DIR/data/calendar.json" ]; then
    python3 - "$JARVIS_DIR/data/calendar.json" >> "$session/meta.txt" 2>/dev/null <<'CALPY' || true
import json, sys
from datetime import datetime, timedelta, timezone
now = datetime.now(timezone.utc)
try:
    for e in json.load(open(sys.argv[1])).get("events", []):
        try:
            st = datetime.fromisoformat(e["start"].replace("Z", "+00:00"))
            en = datetime.fromisoformat((e.get("end") or e["start"]).replace("Z", "+00:00"))
        except Exception:
            continue
        if st - timedelta(minutes=10) <= now <= en + timedelta(minutes=10):
            att = ", ".join(e.get("attendees", [])[:12])
            line = f"calendar-hint: {e['subject']}"
            if e.get("organizer"): line += f" | organizer: {e['organizer']}"
            if att: line += f" | attendees: {att}"
            print(line)
            d = (e.get("description") or "").replace("\n", " ")[:300]
            if d: print(f"calendar-hint-agenda: {d}")
except Exception:
    pass
CALPY
  fi

  "$BIN/audiocap" "$session/system.wav" 2>> "$session/capture.log" &
  audiocap_pid=$!

  # Mic straight to whisper's preferred format (16 kHz mono).
  ffmpeg -hide_banner -loglevel error -f avfoundation -i ":default" \
    -ac 1 -ar 16000 "$session/mic.wav" 2>> "$session/capture.log" &
  ffmpeg_pid=$!
  sleep 2
  if ! kill -0 "$ffmpeg_pid" 2>/dev/null; then
    # ":default" not accepted on some setups — fall back to device 0
    ffmpeg -hide_banner -loglevel error -f avfoundation -i ":0" \
      -ac 1 -ar 16000 "$session/mic.wav" 2>> "$session/capture.log" &
    ffmpeg_pid=$!
  fi

  recording=1
  misses=0
  notify "🔴 Recording call — remember to tell participants"
  echo "$(date '+%H:%M:%S') recording started: $url -> $session"
}

stop_recording() {
  echo "ended: $(date '+%Y-%m-%d %H:%M:%S')" >> "$session/meta.txt"
  [ -n "$ffmpeg_pid" ]   && kill -INT  "$ffmpeg_pid"   2>/dev/null
  [ -n "$audiocap_pid" ] && kill -TERM "$audiocap_pid" 2>/dev/null
  # a recorder can wedge and ignore polite signals (seen: ffmpeg after a mic
  # device stall) — escalate rather than blocking the whole watcher on wait
  for _ in 1 2 3 4 5 6; do
    kill -0 "$ffmpeg_pid" 2>/dev/null || kill -0 "$audiocap_pid" 2>/dev/null || break
    sleep 1
  done
  kill -9 "$ffmpeg_pid" "$audiocap_pid" 2>/dev/null
  wait "$ffmpeg_pid" "$audiocap_pid" 2>/dev/null
  recording=0
  notify "Call ended — transcribing & writing notes"
  echo "$(date '+%H:%M:%S') recording stopped: $session"
  nohup bash "$JARVIS_DIR/tools/process-call.sh" "$session" \
    >> "$session/process.log" 2>&1 &
  session=""; audiocap_pid=""; ffmpeg_pid=""; mode=""
}

cleanup() {
  [ "$recording" = 1 ] && stop_recording
  exit 0
}
trap cleanup INT TERM

# Manual controls, signalled by the UI (or `pkill -USR1/-USR2 -f call-watch`):
# USR1 = stop the current recording immediately; USR2 = start one right now
# (for meetings Jarvis can't detect, e.g. in apps it doesn't know about).
on_usr1() { [ "$recording" = 1 ] && { echo "$(date '+%H:%M:%S') manual stop"; stop_recording; }; }
on_usr2() { [ "$recording" = 0 ] && { echo "$(date '+%H:%M:%S') manual start"; start_recording "manual recording" manual; }; }
trap on_usr1 USR1
trap on_usr2 USR2

# Retention: call audio is kept N days (memory/settings/retention-days.txt, default 7)
# for re-transcription, then purged.
RETENTION_DAYS="$(tr -cd '0-9' < "$JARVIS_DIR/memory/settings/retention-days.txt" 2>/dev/null)"
[ -n "$RETENTION_DAYS" ] || RETENTION_DAYS=7
find "$CALLS_DIR" -name '*.wav' -mtime +"$RETENTION_DAYS" -delete 2>/dev/null

# Heal sessions orphaned by a crash or restart: meta has no "ended:" and no
# recorder is writing into them → finalize and send to processing.
for m in "$CALLS_DIR"/*/meta.txt; do
  [ -f "$m" ] || continue
  grep -q '^ended:' "$m" && continue
  d="$(dirname "$m")"
  pgrep -f "audiocap $d/system.wav" >/dev/null && continue
  echo "ended: $(date '+%Y-%m-%d %H:%M:%S')" >> "$m"
  echo "$(date '+%H:%M:%S') healing stale session: $d"
  nohup bash "$JARVIS_DIR/tools/process-call.sh" "$d" >> "$d/process.log" 2>&1 &
done

echo "$(date '+%H:%M:%S') call-watch running (poll ${POLL}s)"
mkdir -p "$JARVIS_DIR/data"
webteams_hits=0
while true; do
  # liveness heartbeat — the server's watchdog kills+restarts us if this
  # goes stale (a wedged watcher looks alive but stops beating)
  touch "$JARVIS_DIR/data/watcher-heartbeat" 2>/dev/null
  urls="$(tab_urls)"
  match="$(grep -Ei "$MEETING_RE" <<<"$urls" | head -1 || true)"
  if [ "$recording" = 0 ]; then
    if ! autorec_on; then
      :   # auto-record disabled — only manual USR2 starts a recording
    elif [ -n "$match" ] && [ "$("$BIN/miccheck")" = "1" ]; then
      start_recording "$match" browser
    elif [ -n "$(teams_mic_pid)" ]; then
      # Teams DESKTOP app holds the mic → in a Teams call
      start_recording "Microsoft Teams (desktop app)" teams-app
    elif ! voice_listening && grep -qiE "$TEAMS_TAB_RE" <<<"$urls" && [ -n "$(browser_mic_pid)" ]; then
      # Teams WEB: a Teams tab + the browser holding the mic. Needs two
      # consecutive polls (30s) so a quick Jarvis voice query can't phantom-
      # trigger — unless a meetup-join URL is visible, which is definitive.
      webteams_hits=$((webteams_hits + 1))
      if grep -qi "meetup-join" <<<"$urls" || [ "$webteams_hits" -ge 2 ]; then
        webteams_hits=0
        start_recording "Microsoft Teams (browser)" teams-web
      fi
    else
      webteams_hits=0
    fi
  else
    # End-of-call signal depends on how the recording started:
    #  browser   — meeting tab gone OR mic released (Meet's "you left" page
    #              keeps the same URL, so the tab alone is not enough)
    #  teams-app — Teams no longer capturing the mic
    #  manual    — mic released, after a 60s grace so you can start the
    #              recording before actually joining the meeting
    # Our own ffmpeg holds the mic, so its pid is excluded everywhere.
    over=0
    if [ "$mode" = "teams-app" ]; then
      [ -z "$(teams_mic_pid)" ] && over=1
    elif [ "$mode" = "teams-web" ]; then
      # call over when the browser lets go of the mic (60s grace covers the
      # pre-join → in-call mic re-grab)
      [ $(( $(date +%s) - rec_started )) -gt 60 ] && [ -z "$(browser_mic_pid)" ] && over=1
    elif [ "$mode" = "manual" ]; then
      [ $(( $(date +%s) - rec_started )) -gt 60 ] && \
        [ "$("$BIN/miccheck" "$ffmpeg_pid")" = "0" ] && over=1
    else
      { [ -z "$match" ] || [ "$("$BIN/miccheck" "$ffmpeg_pid")" = "0" ]; } && over=1
    fi
    if [ "$over" = 1 ]; then
      misses=$((misses + 1))
      [ "$misses" -ge "$END_MISSES" ] && stop_recording
    else
      misses=0
    fi
  fi
  # backgrounded sleep + wait: a TERM fires the cleanup trap immediately
  # instead of after up to $POLL seconds
  sleep "$POLL" & wait $!
done
