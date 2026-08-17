#!/usr/bin/env bash
# vault-search.sh — plain grep search across your Obsidian vaults.
# No LLM, no external deps (grep is always present). Finds the most relevant
# vault pages for a query and prints them with match counts + snippets, so
# Claude can then read the top hits and synthesize an answer.
# Usage: bash tools/vault-search.sh "your question or keywords"
set -uo pipefail

# Vaults come from the shared config (memory/vaults.txt); ~ expands to $HOME.
# The Jarvis brain vault is always included so remembered notes are searchable.
CONF="$(cd "$(dirname "$0")/.." && pwd)/memory/vaults.txt"
VAULTS=()
if [[ -f "$CONF" ]]; then
  while IFS= read -r line; do
    line="${line%%#*}"; line="${line//[[:space:]]/}"
    [[ -z "$line" ]] && continue
    VAULTS+=("${line/#\~/$HOME}")
  done < "$CONF"
fi
JARVIS_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BRAIN_DIR="$(head -1 "$JARVIS_DIR/memory/settings/brain-dir.txt" 2>/dev/null || true)"
BRAIN_DIR="${BRAIN_DIR:-$JARVIS_DIR/brain}"
BRAIN_DIR="${BRAIN_DIR/#\~/$HOME}"
VAULTS+=("$BRAIN_DIR")
QUERY="${*:-}"
[[ -z "$QUERY" ]] && { echo "usage: vault-search.sh <query>"; exit 1; }

# Reduce the query to meaningful keywords, OR-joined for grep -E.
# "what do I know about adobe target" -> "adobe|target"
CLEAN="$(printf '%s' "$QUERY" | tr 'A-Z' 'a-z' \
  | tr -cs 'a-z0-9' ' ' \
  | tr ' ' '\n' \
  | grep -vwE 'what|do|i|know|about|the|a|an|is|are|of|for|to|my|have|any|which|how|show|me|tell|on|in|and|or|built|build|with|using|use' \
  | grep -v '^$' | paste -sd'|' -)"
[[ -z "$CLEAN" ]] && CLEAN="$(printf '%s' "$QUERY" | tr 'A-Z' 'a-z' | tr ' ' '|')"

echo "# Vault search: \"$QUERY\""
echo "_pattern: ${CLEAN}_"
echo

# Rank .md files by match count across both vaults, show top 8 with snippets.
for v in "${VAULTS[@]}"; do
  [[ -d "$v" ]] && grep -rilE --include='*.md' "$CLEAN" "$v" 2>/dev/null
done | sort -u \
  | while IFS= read -r f; do
      n="$(grep -icE "$CLEAN" "$f" 2>/dev/null || echo 0)"
      printf '%s\t%s\n' "$n" "$f"
    done \
  | sort -rn | head -8 \
  | while IFS=$'\t' read -r count f; do
      rel="${f#"$HOME"/}"
      echo "## $rel  ($count matches)"
      grep -iE -m3 -A1 -B1 "$CLEAN" "$f" 2>/dev/null | sed 's/^/    /' | head -18
      echo
    done

echo "_Read the top files above to answer._"
