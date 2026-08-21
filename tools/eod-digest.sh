#!/usr/bin/env bash
# eod-digest.sh — daily 7 PM end-of-day digest to Telegram
# Reads today's digest file, summarizes open items and completed work, posts to Telegram
set -uo pipefail

JARVIS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SECRETS_FILE="$JARVIS_DIR/secrets/.env"
REPORTS_DIR="$JARVIS_DIR/reports"
LOG_FILE="$REPORTS_DIR/eod-digest.log"
TODAY=$(date +%Y-%m-%d)
DIGEST_FILE="$REPORTS_DIR/digest-$TODAY.md"
TELEGRAM_API="https://api.telegram.org/bot"

# Log helper
log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG_FILE"
}

# Load secrets
if [[ ! -f "$SECRETS_FILE" ]]; then
  log "ERROR: secrets/.env not found. Run tools/setup-telegram.sh first."
  exit 1
fi

source "$SECRETS_FILE"

if [[ -z "${TELEGRAM_BOT_TOKEN:-}" ]] || [[ -z "${TELEGRAM_CHAT_ID:-}" ]]; then
  log "ERROR: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set in secrets/.env"
  exit 1
fi

# Find digest file (today's, or latest if today doesn't exist)
if [[ ! -f "$DIGEST_FILE" ]]; then
  # Try to find the latest digest
  DIGEST_FILE=$(find "$REPORTS_DIR" -name "digest-*.md" -type f | sort -r | head -1)
  if [[ -z "$DIGEST_FILE" ]] || [[ ! -f "$DIGEST_FILE" ]]; then
    log "ERROR: No digest file found in $REPORTS_DIR"
    exit 1
  fi
  log "digest-$TODAY.md not found, using latest: $(basename "$DIGEST_FILE")"
fi

# Count open action items (- [ ])
OPEN_COUNT=$(grep -c '^\- \[ \]' "$DIGEST_FILE" 2>/dev/null || echo 0)

# Extract "Suggested Focuses" section if it exists
FOCUSES=$(sed -n '/^## Suggested Focuses/,/^##[^#]/p' "$DIGEST_FILE" 2>/dev/null | head -n -1 | sed '1d')

# Check today's call notes for completed items (- [x])
COMPLETED_COUNT=0
COMPLETED_NOTES=""
for call_file in "$REPORTS_DIR"/call-notes-$TODAY-*.md; do
  if [[ -f "$call_file" ]]; then
    completed=$(grep -c '^\- \[x\]' "$call_file" 2>/dev/null || echo 0)
    if (( completed > 0 )); then
      COMPLETED_COUNT=$((COMPLETED_COUNT + completed))
      COMPLETED_NOTES="$COMPLETED_NOTES\n  • $(basename "$call_file" .md): $completed completed"
    fi
  fi
done

# Format Telegram message (plain text, emojis only for status)
MESSAGE="📋 EOD Digest — $TODAY

✅ Completed Today: $COMPLETED_COUNT items$COMPLETED_NOTES

⏳ Still Open: $OPEN_COUNT items"

if [[ -n "$FOCUSES" ]]; then
  MESSAGE="$MESSAGE

🎯 Suggested Focuses:
$FOCUSES"
fi

MESSAGE="$MESSAGE

📁 Digest: $(basename "$DIGEST_FILE")"

# Send to Telegram
PAYLOAD=$(cat <<EOF
{
  "chat_id": "$TELEGRAM_CHAT_ID",
  "text": "$(printf '%b' "$MESSAGE" | sed 's/"/\\"/g' | tr '\n' ' ')"
}
EOF
)

RESPONSE=$(curl -fsS -X POST "$TELEGRAM_API$TELEGRAM_BOT_TOKEN/sendMessage" \
  -H 'Content-Type: application/json' \
  -d "$PAYLOAD" 2>&1 || true)

if echo "$RESPONSE" | grep -q '"ok":true'; then
  log "✓ Telegram message sent (open: $OPEN_COUNT, completed: $COMPLETED_COUNT)"
else
  log "⚠ Telegram send failed: $RESPONSE"
  exit 1
fi
