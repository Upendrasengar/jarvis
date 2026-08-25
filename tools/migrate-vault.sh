#!/usr/bin/env bash
# Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
# migrate-vault.sh [path] — move to the unified vault layout: one Obsidian
# tree (Calls/ Notes/ Digests/ Topics/ Memory/) holding everything Jarvis
# knows. Default: ~/Jarvis. Point it at an existing Obsidian vault to graft
# Jarvis in (non-destructive: folders are created inside it).
# Runtime state (audio sessions, db, logs, secrets, settings) stays put.
set -euo pipefail
JARVIS_DIR="${JARVIS_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
TARGET="${1:-$HOME/Jarvis}"
TARGET="${TARGET/#\~/$HOME}"

CUR="$(head -1 "$JARVIS_DIR/memory/settings/vault-dir.txt" 2>/dev/null | tr -d '[:space:]' || true)"
if [ -n "$CUR" ]; then
  echo "already on the vault layout at: $CUR"
  echo "(to relocate, move that folder yourself and update memory/settings/vault-dir.txt)"
  exit 1
fi

OLD_BRAIN="$(head -1 "$JARVIS_DIR/memory/settings/brain-dir.txt" 2>/dev/null || true)"
OLD_BRAIN="${OLD_BRAIN:-$JARVIS_DIR/brain}"
OLD_BRAIN="${OLD_BRAIN/#\~/$HOME}"

echo "── migrating to unified vault: $TARGET"
mkdir -p "$TARGET/Calls" "$TARGET/Notes" "$TARGET/Digests" "$TARGET/Topics" "$TARGET/Memory"

moved=0
count() { moved=$((moved + $1)); }

# call notes (canonical copies)
n=0; for f in "$JARVIS_DIR"/reports/call-notes-*.md; do
  [ -e "$f" ] || continue; mv -n "$f" "$TARGET/Calls/"; n=$((n+1))
done; count $n; echo "  calls:   $n"

# digests + raw scans
n=0; for f in "$JARVIS_DIR"/reports/digest-*.md "$JARVIS_DIR"/reports/raw-*.md; do
  [ -e "$f" ] || continue; mv -n "$f" "$TARGET/Digests/"; n=$((n+1))
done; count $n; echo "  digests: $n"

# memory markdown (settings/ stays put — it's machine config, not knowledge)
n=0; for f in "$JARVIS_DIR"/memory/*.md; do
  [ -e "$f" ] || continue; mv -n "$f" "$TARGET/Memory/"; n=$((n+1))
done; count $n; echo "  memory:  $n"

# brain content: Notes + Topics move/copy in; brain Calls only where no
# canonical twin exists (they were duplicates by design)
if [ -d "$OLD_BRAIN" ] && [ "$OLD_BRAIN" != "$TARGET" ]; then
  n=0
  if [ -d "$OLD_BRAIN/Notes" ]; then
    for f in "$OLD_BRAIN/Notes"/*.md; do [ -e "$f" ] || continue; cp -n "$f" "$TARGET/Notes/"; n=$((n+1)); done
  fi
  if [ -d "$OLD_BRAIN/Topics" ]; then
    for f in "$OLD_BRAIN/Topics"/*.md; do [ -e "$f" ] || continue; cp -n "$f" "$TARGET/Topics/"; n=$((n+1)); done
  fi
  if [ -d "$OLD_BRAIN/Calls" ]; then
    for f in "$OLD_BRAIN/Calls"/call-*.md; do
      [ -e "$f" ] || continue
      stamp="$(basename "$f" .md | sed 's/^call-//')"
      [ -f "$TARGET/Calls/call-notes-$stamp.md" ] && continue   # duplicate
      cp -n "$f" "$TARGET/Calls/"; n=$((n+1))
    done
  fi
  count $n; echo "  brain:   $n (copied from $OLD_BRAIN — original left untouched)"
fi

mkdir -p "$JARVIS_DIR/memory/settings"
printf '%s\n' "$TARGET" > "$JARVIS_DIR/memory/settings/vault-dir.txt"

echo "── done: $moved files now live in $TARGET"
echo "   pointer: memory/settings/vault-dir.txt"
echo "   point Obsidian at $TARGET, sync it however you like."
echo "   restart to pick it up:  jarvis restart"
