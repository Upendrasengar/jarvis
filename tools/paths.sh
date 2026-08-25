# Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
# paths.sh — sourced by every tool that touches knowledge files. One place
# resolves the vault layout so bash and the server can never disagree.
#
#   JARVIS_VAULT env > memory/settings/vault-dir.txt > (unset = legacy)
#
# Vault mode:   Calls/ Notes/ Digests/ Topics/ Memory/ under one tree.
# Legacy mode:  reports/ + brain/ + memory/ exactly as before.
# Runtime state (audio sessions, db, logs, secrets, settings) NEVER moves —
# it stays under $JARVIS_DIR either way.
# Requires: JARVIS_DIR already set by the sourcing script.

VAULT_DIR="${JARVIS_VAULT:-$(head -1 "$JARVIS_DIR/memory/settings/vault-dir.txt" 2>/dev/null | tr -d '[:space:]')}"
VAULT_DIR="${VAULT_DIR/#\~/$HOME}"

if [ -n "$VAULT_DIR" ]; then
  CALL_NOTES_DIR="$VAULT_DIR/Calls"
  DIGESTS_DIR="$VAULT_DIR/Digests"
  MEMORY_MD_DIR="$VAULT_DIR/Memory"
  BRAIN_DIR="$VAULT_DIR"
else
  CALL_NOTES_DIR="$JARVIS_DIR/reports"
  DIGESTS_DIR="$JARVIS_DIR/reports"
  MEMORY_MD_DIR="$JARVIS_DIR/memory"
  BRAIN_DIR="$(head -1 "$JARVIS_DIR/memory/settings/brain-dir.txt" 2>/dev/null || true)"
  BRAIN_DIR="${BRAIN_DIR:-$JARVIS_DIR/brain}"
  BRAIN_DIR="${BRAIN_DIR/#\~/$HOME}"
fi
export VAULT_DIR CALL_NOTES_DIR DIGESTS_DIR MEMORY_MD_DIR BRAIN_DIR
