#!/usr/bin/env bash
# eod-digest.sh — end-of-day Telegram digest from the Jarvis action ledger.
# Reads today's digest (or latest), summarises open action items and top
# focuses, then POSTs a short plain-text message to Telegram.
#
# Secrets (one value per file, no trailing newline required):
#   $JARVIS_DIR/secrets/telegram-bot-token.txt
#   $JARVIS_DIR/secrets/telegram-chat-id.txt
#
# JARVIS_DIR is set by the launchd plist; when run manually, export it first
# or place this script inside the jarvis engine's tools/ directory.
set -uo pipefail

# --- resolve jarvis directory ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -z "${JARVIS_DIR:-}" ]]; then
  PARENT="$(cd "$SCRIPT_DIR/.." && pwd)"
  if [[ -d "$PARENT/reports" && -d "$PARENT/secrets" ]]; then
    JARVIS_DIR="$PARENT"   # script lives inside the jarvis engine tree
  else
    JARVIS_DIR="$PWD"      # launchd WorkingDirectory
  fi
fi

LOG="$JARVIS_DIR/reports/eod-digest.log"
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG"; }

# --- secrets ---
TOKEN_FILE="$JARVIS_DIR/secrets/telegram-bot-token.txt"
CHAT_FILE="$JARVIS_DIR/secrets/telegram-chat-id.txt"
if [[ ! -f "$TOKEN_FILE" || ! -f "$CHAT_FILE" ]]; then
  log "ERROR: missing secrets — create secrets/telegram-bot-token.txt and secrets/telegram-chat-id.txt"
  exit 1
fi
BOT_TOKEN="$(tr -d '[:space:]' < "$TOKEN_FILE")"
CHAT_ID="$(tr -d '[:space:]' < "$CHAT_FILE")"
if [[ -z "$BOT_TOKEN" || -z "$CHAT_ID" ]]; then
  log "ERROR: secrets files are empty"
  exit 1
fi

# --- find digest source ---
TODAY="$(date +%Y-%m-%d)"
DIGEST="$JARVIS_DIR/reports/digest-$TODAY.md"
[[ -f "$DIGEST" ]] || DIGEST="$JARVIS_DIR/reports/current-action-items.md"
[[ -f "$DIGEST" ]] || DIGEST="$(ls -t "$JARVIS_DIR"/reports/digest-*.md 2>/dev/null | head -1 || true)"
if [[ -z "${DIGEST:-}" || ! -f "$DIGEST" ]]; then
  log "ERROR: no digest file found in $JARVIS_DIR/reports/"
  exit 1
fi

# --- open action items ---
OPEN_COUNT="$(grep -c '^- \[ \]' "$DIGEST" 2>/dev/null || true)"
OPEN_COUNT="${OPEN_COUNT:-0}"
OLDEST_DATE="$(grep '^### ' "$DIGEST" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}' | sort | head -1 || true)"

# --- completed items in today's call notes ---
DONE_LINES=""
for f in "$JARVIS_DIR"/reports/call-notes-"$TODAY"-*.md; do
  [[ -f "$f" ]] || continue
  while IFS= read -r line; do
    item="${line#- \[x\] }"
    DONE_LINES="${DONE_LINES}  * ${item}"$'\n'
  done < <(grep '^- \[x\]' "$f" 2>/dev/null || true)
done

# --- suggested focuses (numbered lines from digest) ---
FOCUS_LINES=""
in_section=0
while IFS= read -r line; do
  if [[ "$line" == "## Suggested Focuses"* ]]; then
    in_section=1; continue
  fi
  if [[ $in_section -eq 1 ]]; then
    [[ "$line" == "##"* ]] && break
    [[ "$line" =~ ^[0-9]+\. ]] && FOCUS_LINES="${FOCUS_LINES}${line}"$'\n'
  fi
done < "$DIGEST"

# --- compose Telegram message (plain text, emojis for status) ---
MSG="📋 Jarvis EOD — $TODAY"$'\n'

if [[ -n "$DONE_LINES" ]]; then
  MSG+=$'\n'"✅ Done today:"$'\n'"$DONE_LINES"
else
  MSG+=$'\n'"✅ Done today: none marked"$'\n'
fi

OPEN_LABEL="⏳ Open: $OPEN_COUNT items"
[[ -n "$OLDEST_DATE" ]] && OPEN_LABEL+=" (oldest: $OLDEST_DATE)"
MSG+=$'\n'"$OPEN_LABEL"$'\n'

if [[ -n "$FOCUS_LINES" ]]; then
  MSG+=$'\n'"🎯 Top focus:"$'\n'"$FOCUS_LINES"
fi

# Telegram limit is 4096 chars
if [[ ${#MSG} -gt 4000 ]]; then
  MSG="${MSG:0:3990}"$'\n''...(truncated)'
fi

# --- send ---
log "sending EOD digest (open: $OPEN_COUNT)..."
RESPONSE="$(python3 -c "
import json, sys
text = sys.stdin.read()
print(json.dumps({'chat_id': sys.argv[1], 'text': text}))
" "$CHAT_ID" <<< "$MSG" \
  | curl -fsS -X POST \
      "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
      -H 'Content-Type: application/json' \
      --data-binary @- 2>&1)" || {
  log "ERROR: Telegram API request failed"
  exit 1
}

if echo "$RESPONSE" | grep -q '"ok":true'; then
  log "sent successfully"
else
  log "ERROR: Telegram returned: $RESPONSE"
  exit 1
fi
