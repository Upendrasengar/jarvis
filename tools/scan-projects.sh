#!/usr/bin/env bash
# Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
# scan-projects.sh — plain git-activity scanner for the Daily Project Digest.
# No network, no LLM. Reads memory/active-projects.md, writes reports/raw-<date>.md.
# Usage: bash tools/scan-projects.sh [SINCE]   (SINCE defaults to "yesterday")
set -uo pipefail

JARVIS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LIST="$JARVIS_DIR/memory/active-projects.md"
SINCE="${1:-yesterday}"
DATE="$(date +%Y-%m-%d)"
OUT="$JARVIS_DIR/reports/raw-$DATE.md"

# Match commits from your git identity as "mine". memory/settings/git-author.txt
# may hold a regex covering all your identities; falls back to git user.name,
# then to matching everything.
ME_REGEX="$(head -1 "$JARVIS_DIR/memory/settings/git-author.txt" 2>/dev/null || true)"
[ -z "$ME_REGEX" ] && ME_REGEX="$(git config user.name 2>/dev/null || true)"
[ -z "$ME_REGEX" ] && ME_REGEX="."

mkdir -p "$JARVIS_DIR/reports"
{
  echo "# Raw project activity — $DATE"
  echo "_since: ${SINCE}_"
  echo
} > "$OUT"

found_any=0
while IFS= read -r repo; do
  # skip comments / blanks
  [[ -z "$repo" || "$repo" =~ ^[[:space:]]*# ]] && continue
  [[ "$repo" =~ [[:space:]] ]] && continue  # skip prose lines
  # allow paths relative to ~/Documents/Projects
  [[ "$repo" != /* ]] && repo="$HOME/Documents/Projects/$repo"
  [[ -d "$repo/.git" ]] || { echo "## $(basename "$repo")"; echo "_not a git repo — skipped_"; echo; continue; } >> "$OUT"

  # paused from the Projects page? skip silently until reactivated
  if [ -n "$INACTIVE_PATHS" ] && printf '%s\n' "$INACTIVE_PATHS" | grep -qxF "$(cd "$repo" && pwd -P)"; then
    continue
  fi

  name="$(basename "$repo")"
  branch="$(git -C "$repo" rev-parse --abbrev-ref HEAD 2>/dev/null)"
  # my commits across ALL branches since SINCE
  commits="$(git -C "$repo" log --all --since="$SINCE" \
              --author="$ME_REGEX" --regexp-ignore-case \
              --pretty=format:'- %s (%cr, %an on %D)' 2>/dev/null | head -40)"
  # uncommitted work = risk signal
  dirty="$(git -C "$repo" status --porcelain 2>/dev/null | wc -l | tr -d ' ')"

  {
    echo "## $name"
    echo "- branch: \`$branch\` · uncommitted files: $dirty"
    if [[ -n "$commits" ]]; then
      echo "- commits since $SINCE:"
      echo "$commits" | sed 's/^/  /'
    else
      echo "- no commits by me since $SINCE"
    fi
    echo
  } >> "$OUT"
  [[ -n "$commits" || "$dirty" != "0" ]] && found_any=1
done < "$LIST"

echo "_scan complete — activity found: ${found_any}_" >> "$OUT"
echo "$OUT"
