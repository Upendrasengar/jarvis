#!/usr/bin/env bash
# Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
# service.sh — run Jarvis as a login service (auto-start after reboot).
#   jarvis service install | uninstall | status
# One LaunchAgent runs the server; the server's watchdog starts the call
# watcher and the in-server scheduler handles digests — so one agent is the
# whole system.
set -uo pipefail
JARVIS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/com.jarvis.plist"
LABEL="com.jarvis"

case "${1:-status}" in
  install)
    # launchd cannot execute from TCC-protected folders (silent EX_CONFIG)
    case "$JARVIS_DIR" in
      "$HOME/Documents/"*|"$HOME/Desktop/"*|"$HOME/Downloads/"*)
        echo "✗ This Jarvis lives under a macOS-protected folder ($JARVIS_DIR)."
        echo "  launchd services can't run from Documents/Desktop/Downloads."
        echo "  Use the Homebrew install (data in ~/.jarvis) for service mode,"
        echo "  or keep starting manually with: jarvis start"
        exit 1 ;;
    esac
    NODE_BIN="${JARVIS_NODE:-$(command -v node)}"
    TSX="$JARVIS_DIR/apps/server/node_modules/tsx/dist/cli.mjs"
    [ -x "$NODE_BIN" ] || { echo "✗ node not found"; exit 1; }
    [ -f "$TSX" ] || { echo "✗ tsx not found — run: jarvis setup"; exit 1; }
    PORT="$(head -1 "$JARVIS_DIR/memory/settings/port.txt" 2>/dev/null | tr -cd '0-9')"
    mkdir -p "$HOME/Library/LaunchAgents" "$JARVIS_DIR/reports"
    cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>$TSX</string>
    <string>src/index.ts</string>
  </array>
  <key>WorkingDirectory</key><string>$JARVIS_DIR/apps/server</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>JARVIS_DIR</key><string>$JARVIS_DIR</string>
    <key>JARVIS_API_PORT</key><string>${PORT:-4321}</string>
    <key>PATH</key><string>$(dirname "$NODE_BIN"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$HOME/.local/bin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$JARVIS_DIR/reports/api.log</string>
  <key>StandardErrorPath</key><string>$JARVIS_DIR/reports/api.log</string>
</dict>
</plist>
PL
    launchctl unload "$PLIST" 2>/dev/null
    # hand over from any manually-started server
    lsof -tiTCP:"${PORT:-4321}" -sTCP:LISTEN 2>/dev/null | xargs kill 2>/dev/null
    sleep 1
    launchctl load "$PLIST" && echo "✓ installed — Jarvis now starts at login and restarts if it crashes"
    echo "  status: jarvis service status · remove: jarvis service uninstall"
    ;;
  uninstall)
    launchctl unload "$PLIST" 2>/dev/null
    rm -f "$PLIST"
    echo "✓ service removed (jarvis start works manually as before)"
    ;;
  status)
    if launchctl list "$LABEL" >/dev/null 2>&1; then
      echo "✓ service loaded: $(launchctl list "$LABEL" 2>/dev/null | grep '"PID"' | tr -dc '0-9' | sed 's/^$/not running/' )"
      launchctl list "$LABEL" | grep -E '"PID"|LastExitStatus' | sed 's/^/  /'
    else
      echo "service not installed — jarvis service install"
    fi
    ;;
  *) echo "usage: jarvis service install|uninstall|status"; exit 2 ;;
esac
