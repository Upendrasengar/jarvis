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

# Continuity anchor: the most recent previous digest. Each digest chains on
# the last one (which distills everything before it) + all material since —
# constant cost, week-long narrative, and self-healing across gaps.
PREV="$(ls "$JARVIS_DIR"/reports/digest-*.md 2>/dev/null | grep -v "digest-$DATE.md" | sort | tail -1)"
PREV_DATE=""
[ -n "$PREV" ] && PREV_DATE="$(basename "$PREV" .md | sed 's/^digest-//')"
[ -z "$PREV_DATE" ] && PREV_DATE="$YDATE"

# call notes on/after the previous digest's date (it ran at ~8am, so its own
# day's later calls are new material; cheap overlap beats a gap)
RECENT_CALLS=""
for f in "$JARVIS_DIR"/reports/call-notes-*.md; do
  [ -f "$f" ] || continue
  st="$(basename "$f" .md | sed 's/^call-notes-//')"
  [[ "${st:0:10}" < "$PREV_DATE" ]] || RECENT_CALLS="$RECENT_CALLS reports/$(basename "$f")"
done

# 1. plain scan (no LLM) — always works, no deps beyond git.
# Git activity also since the previous digest, so gaps (weekends, days off)
# are covered without special-casing Mondays.
bash "$JARVIS_DIR/tools/scan-projects.sh" "${1:-$PREV_DATE}" >/dev/null

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

# 1.55 optional calendar adapter: if data/calendar.json exists and is fresh
# (<24h), append today's meetings to the raw file. Absent adapter = no-op.
CAL="$JARVIS_DIR/data/calendar.json"
if [ -f "$CAL" ] && [ -n "$(find "$CAL" -mmin -1440 2>/dev/null)" ]; then
  python3 - "$CAL" "$DATE" >> "$JARVIS_DIR/reports/raw-$DATE.md" <<'CPY'
import json, sys
from datetime import datetime
def local(iso):
    try: return datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone()
    except Exception: return None
try:
    st = json.load(open(sys.argv[1]))
    todays = [e for e in st.get("events", [])
              if (d := local(e.get("start", ""))) and d.strftime("%Y-%m-%d") == sys.argv[2]]
    if todays:
        print("\n## TODAY'S MEETINGS (from calendar adapter, local time)")
        for e in todays:
            t = local(e["start"]).strftime("%H:%M")
            att = ", ".join(e.get("attendees", [])[:8])
            print(f"- {t} — {e['subject']}" + (f" (with: {att})" if att else ""))
except Exception:
    pass
CPY
fi

# 1.6 attention triage (one Sonnet call) — annotates open items with
# clusters/deadlines/blocked flags into data/triage.json; the digest and the
# dashboard's attention bucket both read it.
bash "$JARVIS_DIR/tools/triage-actions.sh" || true

# 2. LLM step: write the digest from the raw data (Sonnet is plenty)
cd "$JARVIS_DIR"
"$CLAUDE" -p "Read CLAUDE.md, then reports/raw-$DATE.md. \
CONTINUITY: read the previous digest reports/digest-$PREV_DATE.md — it \
distills everything before it; treat it as narrative context, NOT as truth \
for open items (the OPEN ACTION ITEMS ledger in the raw file is the \
deterministic truth — always trust it over the previous digest). Then read \
the call notes since that digest:$RECENT_CALLS (skip ones titled 'No speech \
detected' or similar phantom/silent calls). Write reports/digest-$DATE.md \
following the Daily Project Digest format: a 2-4 sentence momentum summary \
written AGAINST the previous digest — what moved since it, what is STILL \
stalled and for how long, what's new (flag uncommitted work as at-risk), \
a per-project bullet line, then — only if there \
were real calls since the previous digest — a 'Calls' section with one line per call (title + outcome), \
then — ONLY if the raw file has a TODAY'S MEETINGS section — a 'Today' \
section listing those meetings, cross-referencing open action items that \
involve the same people or topics, \
then an 'Open action items' section built from the OPEN ACTION ITEMS ledger \
in the raw file: EVERY unchecked item, grouped by source with its date, \
oldest debts first. Never drop an unchecked item because its call is old — \
it stays in every digest until someone checks it off. If the ledger is \
empty, say 'All clear.' Then a calendar line (say 'not checked in headless \
mode'), and 1-3 suggested focuses — read data/triage.json (attention annotations: \
deadlines, blocked flags, duplicate clusters) and lead with overdue items, \
then items I own that block others, then the oldest or most blocking \
open items. Keep it scannable. Then print the digest file path." \
  --model sonnet --allowedTools "Read,Write" 2>&1 | tail -3

echo "[run-digest] done: $JARVIS_DIR/reports/digest-$DATE.md"
