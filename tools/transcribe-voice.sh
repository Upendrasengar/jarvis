#!/usr/bin/env bash
# Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
# transcribe-voice.sh <audio-file> — one short voice note in, transcript text
# on stdout. Same local whisper.cpp + model-resolution as process-call.sh;
# nothing leaves the machine.
set -euo pipefail
JARVIS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IN="${1:?audio file required}"

PREF="$(tr -d '[:space:]' < "$JARVIS_DIR/memory/settings/whisper-model.txt" 2>/dev/null || true)"
MODEL="$JARVIS_DIR/models/ggml-${PREF:-medium}.bin"
[ -f "$MODEL" ] || MODEL="$JARVIS_DIR/models/ggml-small.bin"
[ -f "$MODEL" ] || MODEL="$JARVIS_DIR/models/ggml-small.en.bin"
[ -f "$MODEL" ] || { echo "no whisper model found — run: jarvis setup" >&2; exit 1; }
WHISPER="$(command -v whisper-cli || echo /opt/homebrew/bin/whisper-cli)"

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
ffmpeg -y -hide_banner -loglevel error -i "$IN" -ac 1 -ar 16000 "$TMP/a16.wav"
"$WHISPER" -m "$MODEL" -f "$TMP/a16.wav" -l auto -np -nt 2>/dev/null \
  | sed 's/^[[:space:]]*//' | grep -v '^$' || true
