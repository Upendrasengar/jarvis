#!/usr/bin/env bash
# Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
# whisper-model.sh [size] — show the transcription models, or pick one.
#
# Picking and installing used to be separate: memory/settings/whisper-model.txt
# chose which file process-call.sh loads, while `jarvis setup` downloaded only
# when models/ was completely empty. Choosing a size you did not have on disk
# was therefore accepted silently and failed at the next call. This does both,
# and refuses to switch to something it could not fetch.
set -uo pipefail

# Prefer an inherited JARVIS_DIR; fall back to this script's location.
# See tools/call-watch.sh for why: under Homebrew the engine is read-only in
# the cellar and symlinked into ~/.jarvis, so a caller reaching this by its
# real path would resolve data/ somewhere the server never writes.
JARVIS_DIR="${JARVIS_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$JARVIS_DIR" || exit 1
SETTING="memory/settings/whisper-model.txt"
SIZES=(tiny base small medium large-v3)
BASE_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main"

have()    { [ -s "models/ggml-$1.bin" ]; }
current() { head -1 "$SETTING" 2>/dev/null | tr -d '[:space:]'; }

listing() {
  local cur; cur="$(current)"
  echo "Transcription models — models/"
  for s in "${SIZES[@]}"; do
    local mark="  " size="not installed"
    have "$s" && size="$(du -h "models/ggml-$s.bin" | cut -f1)"
    [ "$s" = "$cur" ] && mark=" ●"
    printf "%s %-10s %s\n" "$mark" "$s" "$size"
  done
  # anything downloaded outside this list still counts — do not hide it
  for f in models/ggml-*.bin; do
    [ -e "$f" ] || continue
    local n; n="$(basename "$f" .bin)"; n="${n#ggml-}"
    case " ${SIZES[*]} silero-v5.1.2 " in *" $n "*) ;; *) printf "   %-10s %s (extra)\n" "$n" "$(du -h "$f" | cut -f1)" ;; esac
  done
  echo
  echo "selected: ${cur:-none}   ·   pick one with: jarvis model <size>"
  echo "larger = better names and punctuation, proportionally slower"
}

WANT="${1:-}"
[ -z "$WANT" ] && { listing; exit 0; }

case " ${SIZES[*]} " in
  *" $WANT "*) ;;
  *) echo "unknown model '$WANT' — choose one of: ${SIZES[*]}" >&2; exit 1 ;;
esac

if ! have "$WANT"; then
  echo "downloading ggml-$WANT.bin — this can take a while..."
  mkdir -p models
  # to a temp name first: a half-downloaded file left at the real path would
  # look installed to every check in the codebase
  if ! curl -fL --progress-bar -o "models/.ggml-$WANT.part" "$BASE_URL/ggml-$WANT.bin"; then
    rm -f "models/.ggml-$WANT.part"
    echo "download failed — the setting is unchanged, so transcription keeps working" >&2
    exit 1
  fi
  mv "models/.ggml-$WANT.part" "models/ggml-$WANT.bin"
fi

mkdir -p "$(dirname "$SETTING")"
echo "$WANT" > "$SETTING"
echo "✓ transcription model set to $WANT ($(du -h "models/ggml-$WANT.bin" | cut -f1))"
echo "  applies to the next call; rerun an old one with: jarvis logs / the Rerun button"
