#!/usr/bin/env bash
# Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
# notify.sh "<body>" ["<title>"] — one way to reach the owner's screen.
#
# Prefers JarvisBar.app, which is a real signed bundle: macOS attributes the
# notification to "Jarvis" (so there is something recognisable to grant
# permission to) and it is delivered from a GUI app rather than from a
# launchd daemon, where osascript notifications routinely go nowhere.
#
# Falls back to osascript when the menu-bar app is not running, so a notice is
# never silently dropped just because the icon is closed.
set -uo pipefail

JARVIS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BODY="${1:-}"
TITLE="${2:-Jarvis}"
[ -n "$BODY" ] || exit 0

if pgrep -x jarvisbar >/dev/null 2>&1; then
  mkdir -p "$JARVIS_DIR/data"
  # python does the escaping: a call title with a quote or a newline in it
  # would otherwise produce a broken line that the drainer skips
  python3 - "$BODY" "$TITLE" >> "$JARVIS_DIR/data/notify-queue.jsonl" <<'PY'
import json, sys
print(json.dumps({"body": sys.argv[1], "title": sys.argv[2]}))
PY
  exit 0
fi

osascript -e "display notification $(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$BODY") with title $(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$TITLE") sound name \"Glass\"" >/dev/null 2>&1 || true
