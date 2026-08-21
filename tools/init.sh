#!/usr/bin/env bash
# Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
# init.sh — first-run interview: Jarvis learns who it works for.
# Writes memory/ from the memory.example templates plus your answers.
# Safe to re-run: existing files are only touched if you say so.
set -uo pipefail
JARVIS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$JARVIS_DIR"

echo "── Jarvis setup — a few questions, all stored locally in memory/ ──"
echo

if [ -f memory/about-me.md ] && grep -qv '^\s*$' memory/about-me.md 2>/dev/null \
   && ! grep -q '^- \*\*Name\*\*:\s*$' memory/about-me.md 2>/dev/null; then
  read -rp "memory/ already looks personalized. Re-run the interview and overwrite? [y/N] " yn
  case "$yn" in [Yy]*) ;; *) echo "Left as is. Edit memory/*.md directly anytime."; exit 0 ;; esac
fi
mkdir -p memory reports brain secrets data
cp -Rn memory.example/. memory/ 2>/dev/null || true

read -rp "Your name: " NAME
read -rp "One line about you (role, what you work on): " ROLE
read -rp "Current focus (projects/goals right now): " FOCUS
read -rp "Git author match (name/email fragment for 'your' commits) [${NAME%% *}]: " GITAUTHOR
GITAUTHOR="${GITAUTHOR:-${NAME%% *}}"
read -rp "Languages your calls mix (space-separated, e.g. 'en hi') [en]: " LANGS
LANGS="${LANGS:-en}"
echo
echo "Repos for the daily digest to scan (absolute paths or paths under"
echo "~/Documents/Projects). One per line; empty line to finish:"
REPOS=""
while IFS= read -rp "  repo> " r; do
  [ -z "$r" ] && break
  REPOS="$REPOS$r"$'\n'
done
read -rp "Obsidian vault to search for recall (absolute path, empty to skip): " VAULT

cat > memory/about-me.md <<EOF
# About me

- **Name**: $NAME
- **Role / what I do**: $ROLE
- **Current focus**: $FOCUS
EOF
{
  echo "# Active projects"
  echo
  echo "<!-- One path per line — the git repos the Daily Digest scans. -->"
  echo
  printf '%s' "$REPOS"
} > memory/active-projects.md
printf '%s\n' "$NAME" > memory/settings/owner.txt
printf '%s\n' "$GITAUTHOR" > memory/settings/git-author.txt
printf '%s\n' "$LANGS" > memory/settings/call-languages.txt
if [ -n "$VAULT" ]; then
  { echo "# Obsidian vaults Jarvis can READ. One absolute path per line."; echo "$VAULT"; } > memory/vaults.txt
fi

echo
echo "✓ memory/ written. Optional extras, whenever you want them:"
echo "  · Telegram surface:  ./jarvis telegram"
echo "  · Calendar adapter:  set CALENDAR_FEED_URL in secrets/.env (ICS or JSON feed)"
echo "  · Settings page (⚙) for voice mode, auto-record, whisper model"
echo
echo "Start Jarvis:  ./jarvis start"
