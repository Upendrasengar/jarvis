#!/usr/bin/env bash
# Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
# uninstall.sh — remove Jarvis completely and honestly.
# Stops everything, removes the login service, asks (never assumes) about
# your data, and finishes with the package itself.
set -uo pipefail
JARVIS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BREW_MANAGED=0
[ -L "$JARVIS_DIR/node_modules" ] && BREW_MANAGED=1

echo "── Uninstalling Jarvis ──"
echo
echo "1/4 stopping services…"
bash "$JARVIS_DIR/tools/services.sh" stop 2>/dev/null | sed 's/^/  /'
bash "$JARVIS_DIR/tools/service.sh" uninstall 2>/dev/null | sed 's/^/  /'
pkill -f "MacOS/audiocap" 2>/dev/null
pkill -f "MacOS/jarvisbar" 2>/dev/null   # menu-bar icon
echo
echo "2/4 your data (memory, call notes, recordings, brain, secrets):"
echo "  $JARVIS_DIR — memory/ reports/ brain/ data/ secrets/ models/"
read -rp "  Delete ALL of it permanently? [y/N] " yn
case "$yn" in
  [Yy]*)
    for d in memory reports brain data secrets models; do rm -rf "${JARVIS_DIR:?}/$d"; done
    echo "  ✓ data deleted"
    ;;
  *) echo "  ✓ data kept — remove later with: rm -rf $JARVIS_DIR" ;;
esac
echo
echo "3/4 permission residue: System Settings → Privacy & Security lists"
echo "  'Jarvis Audio' under Screen Recording / Microphone — harmless once"
echo "  the app is gone; remove the entries manually if you want zero trace."
echo
if [ "$BREW_MANAGED" = 1 ]; then
  echo "4/4 removing the Homebrew package…"
  read -rp "  Run 'brew uninstall jarvis && brew untap upendrasengar/jarvis' now? [Y/n] " yn2
  case "$yn2" in
    [Nn]*) echo "  skipped — run it yourself when ready" ;;
    *) brew uninstall jarvis 2>/dev/null | tail -1; brew untap upendrasengar/jarvis 2>/dev/null | tail -1; echo "  ✓ package removed" ;;
  esac
else
  echo "4/4 this is a git install — finish with:  rm -rf $JARVIS_DIR"
fi
echo
echo "Goodbye. (memory/about-me.md was nice to know you.)"
