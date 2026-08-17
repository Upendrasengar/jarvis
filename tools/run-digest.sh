#!/usr/bin/env bash
# run-digest.sh — one command to produce the daily digest headlessly.
# Runs the plain scanner, then hands the raw data to Claude Code to write the
# brief. Written to survive launchd's minimal environment (no nvm, sparse PATH).
set -uo pipefail

JARVIS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATE="$(date +%Y-%m-%d)"
BRAIN_DIR="$(head -1 "$JARVIS_DIR/memory/settings/brain-dir.txt" 2>/dev/null || true)"
BRAIN_DIR="${BRAIN_DIR:-$JARVIS_DIR/brain}"
BRAIN_DIR="${BRAIN_DIR/#\~/$HOME}"
YDATE="$(date -v-1d +%Y-%m-%d)"

# launchd gives a bare PATH. Add the usual bins + resolve the claude binary
# (it lives under nvm, which launchd does not know about).
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$HOME/.local/bin:$PATH"
CLAUDE=""
for c in "$HOME/.local/bin/claude" \
         "$HOME/.nvm/versions/node/v22.12.0/bin/claude" \
         "$(command -v claude 2>/dev/null || true)"; do
  [[ -x "$c" ]] && { CLAUDE="$c"; break; }
done
# fallback: newest nvm-installed claude
[[ -z "$CLAUDE" ]] && CLAUDE="$(ls -t "$HOME"/.nvm/versions/node/*/bin/claude 2>/dev/null | head -1)"
[[ -x "$CLAUDE" ]] || { echo "[run-digest] claude binary not found" >&2; exit 3; }

# 1. plain scan (no LLM) — always works, no deps beyond git.
# Monday's scan reaches back to Friday so weekend digests don't hide the week.
DEFAULT_SINCE="yesterday"
[[ "$(date +%u)" == "1" ]] && DEFAULT_SINCE="3 days ago"
bash "$JARVIS_DIR/tools/scan-projects.sh" "${1:-$DEFAULT_SINCE}" >/dev/null

# 1.5 open-actions ledger (no LLM) — EVERY unchecked action item across all
# call notes and vault notes, however old. This is what makes the digest a
# ledger instead of a snapshot: an item survives every digest until it's
# checked off, so Friday's debts still stare at you on Monday.
{
  echo
  echo "## OPEN ACTION ITEMS (all unchecked, any date — carry forward until done)"
  for f in "$JARVIS_DIR"/reports/call-notes-*.md "$BRAIN_DIR"/Notes/*.md; do
    [[ -f "$f" ]] || continue
    grep -q '^- \[ \]' "$f" || continue
    echo
    echo "### $(basename "$f")"
    # unchecked items + their indented comment lines (context stays attached)
    awk '/^- \[ \]/{print; keep=1; next} /^  [-*] /{if(keep)print; next} {keep=0}' "$f"
  done
} >> "$JARVIS_DIR/reports/raw-$DATE.md"

# 2. LLM step: write the digest from the raw data (Sonnet is plenty)
cd "$JARVIS_DIR"
"$CLAUDE" -p "Read CLAUDE.md, then reports/raw-$DATE.md. Also read any call \
notes from the last day: files matching reports/call-notes-$YDATE-*.md and \
reports/call-notes-$DATE-*.md (skip ones titled 'No speech detected' or \
similar phantom/silent calls). Write reports/digest-$DATE.md following the \
Daily Project Digest format: a 2-4 sentence momentum summary (flag \
uncommitted work as at-risk), a per-project bullet line, then — only if there \
were real calls — a 'Calls' section with one line per call (title + outcome), \
then an 'Open action items' section built from the OPEN ACTION ITEMS ledger \
in the raw file: EVERY unchecked item, grouped by source with its date, \
oldest debts first. Never drop an unchecked item because its call is old — \
it stays in every digest until someone checks it off. If the ledger is \
empty, say 'All clear.' Then a calendar line (say 'not checked in headless \
mode'), and 1-3 suggested focuses that lead with the oldest or most blocking \
open items. Keep it scannable. Then print the digest file path." \
  --model sonnet --allowedTools "Read,Write" 2>&1 | tail -3

echo "[run-digest] done: $JARVIS_DIR/reports/digest-$DATE.md"
