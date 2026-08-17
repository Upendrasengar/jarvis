#!/usr/bin/env bash
# setup-telegram.sh — interactive wizard: connect Jarvis to a Telegram bot.
# Writes TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID into gitignored secrets/.env
# and binds the bot to YOUR chat only (anyone can message any bot — Jarvis
# ignores everyone but the chat id captured here).
set -uo pipefail
JARVIS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$JARVIS_DIR/secrets/.env"
API="https://api.telegram.org/bot"

echo "── Jarvis ⇄ Telegram setup ──"
echo
echo "Step 1: create a bot (one minute):"
echo "  • In Telegram, open @BotFather → send /newbot"
echo "  • Pick a name and a username, copy the HTTP API token it gives you"
echo
read -rp "Paste the bot token: " TOKEN
TOKEN="$(printf '%s' "$TOKEN" | tr -d '[:space:]')"

ME_JSON="$(curl -fsS "$API$TOKEN/getMe" 2>/dev/null || true)"
BOT_USER="$(printf '%s' "$ME_JSON" | python3 -c "import json,sys
try: d=json.load(sys.stdin); print(d['result']['username'] if d.get('ok') else '')
except Exception: print('')")"
if [[ -z "$BOT_USER" ]]; then
  echo "✗ Telegram rejected that token (getMe failed). Double-check and re-run."
  exit 1
fi
echo "✓ token valid — bot is @$BOT_USER"
echo
echo "Step 2: open https://t.me/$BOT_USER , press START, and send any message."
echo "  Waiting for your message (up to 2 minutes)..."

CHAT_ID=""; FROM=""
for _ in $(seq 1 60); do
  UPD="$(curl -fsS "$API$TOKEN/getUpdates?timeout=1" 2>/dev/null || true)"
  read -r CHAT_ID FROM <<< "$(printf '%s' "$UPD" | python3 -c "import json,sys
try:
    d = json.load(sys.stdin)
    for u in reversed(d.get('result', [])):
        m = u.get('message')
        if m and m.get('chat', {}).get('id'):
            print(m['chat']['id'], m.get('from', {}).get('first_name', '?')); break
    else: print('', '')
except Exception: print('', '')")"
  [[ -n "$CHAT_ID" ]] && break
  sleep 2
done
if [[ -z "$CHAT_ID" ]]; then
  echo "✗ No message received. Send the bot a message and re-run this setup."
  exit 1
fi
echo "✓ got a message from $FROM (chat id $CHAT_ID) — binding Jarvis to this chat ONLY"

mkdir -p "$JARVIS_DIR/secrets"
touch "$ENV_FILE"
grep -v '^TELEGRAM_BOT_TOKEN=\|^TELEGRAM_CHAT_ID=' "$ENV_FILE" > "$ENV_FILE.tmp" || true
{ cat "$ENV_FILE.tmp"; echo "TELEGRAM_BOT_TOKEN=$TOKEN"; echo "TELEGRAM_CHAT_ID=$CHAT_ID"; } > "$ENV_FILE"
rm -f "$ENV_FILE.tmp"
chmod 600 "$ENV_FILE"
echo "✓ saved to secrets/.env (gitignored)"

curl -fsS -X POST "$API$TOKEN/sendMessage" \
  -H 'Content-Type: application/json' \
  -d "{\"chat_id\": \"$CHAT_ID\", \"text\": \"✅ Jarvis connected. After a restart (jarvis restart), message me here anytime.\"}" >/dev/null \
  && echo "✓ test message sent — check Telegram"

echo
echo "Done. Restart to activate:  jarvis restart"
