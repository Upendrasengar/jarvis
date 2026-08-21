#!/usr/bin/env bash
# process-call.sh — Call Notes capability, stage 2: transcribe + summarize.
# Takes a session dir produced by call-watch.sh (mic.wav + system.wav),
# transcribes both sides locally with whisper.cpp, merges them into a
# speaker-labeled transcript, then has Sonnet write the call notes.
#
# Audio never leaves this machine. WAVs are deleted after a successful
# transcription; the transcript and notes are kept.
#
# Usage: bash tools/process-call.sh reports/calls/<session-dir>
set -euo pipefail

JARVIS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SESSION="$1"
# Multilingual whisper model — handles calls that mix languages. Which size
# to use lives in memory/settings/whisper-model.txt ("medium" = better
# names/accuracy at ~2.3x realtime, "small" = faster). Falls back if missing.
PREF="$(tr -d '[:space:]' < "$JARVIS_DIR/memory/settings/whisper-model.txt" 2>/dev/null || true)"
MODEL="$JARVIS_DIR/models/ggml-${PREF:-medium}.bin"
[ -f "$MODEL" ] || MODEL="$JARVIS_DIR/models/ggml-small.bin"
[ -f "$MODEL" ] || MODEL="$JARVIS_DIR/models/ggml-small.en.bin"
echo "whisper model: $MODEL"
WHISPER="$(command -v whisper-cli || echo /opt/homebrew/bin/whisper-cli)"
BRAIN_DIR="$(head -1 "$JARVIS_DIR/memory/settings/brain-dir.txt" 2>/dev/null || true)"
BRAIN_DIR="${BRAIN_DIR:-$JARVIS_DIR/brain}"
BRAIN_DIR="${BRAIN_DIR/#\~/$HOME}"
VAULT_CALLS="$BRAIN_DIR/Calls"
# Who "Me" is in the notes (memory/settings/owner.txt)
OWNER="$(head -1 "$JARVIS_DIR/memory/settings/owner.txt" 2>/dev/null || true)"
OWNER="${OWNER:-the user}"
# Languages your calls mix, space-separated, e.g. "en hi" (first is primary;
# a detection outside this list retries pinned to the LAST one).
LANGS="$(head -1 "$JARVIS_DIR/memory/settings/call-languages.txt" 2>/dev/null || true)"
LANGS="${LANGS:-en}"
RETRY_LANG="${LANGS##* }"
STAMP="$(basename "$SESSION")"

cd "$SESSION"

# Loud failures: any error writes FAILED.txt (the UI shows the session as
# "failed" with a rerun hint) instead of dying silently mid-pipeline.
rm -f FAILED.txt
trap 'code=$?; [ $code -ne 0 ] && echo "failed at line $LINENO (exit $code) — rerun: bash tools/process-call.sh reports/calls/$STAMP" > FAILED.txt' ERR

# One processor per session. A stale lock (crash, kill -9) is reclaimed if no
# processor for this session is actually alive.
if ! mkdir .processing 2>/dev/null; then
  if pgrep -f "process-call.sh.*$STAMP" | grep -v "^$$\$" >/dev/null; then
    echo "another processor is active for $STAMP — exiting"
    exit 0
  fi
  echo "reclaiming stale lock"
fi
trap 'rmdir .processing 2>/dev/null' EXIT

[ -s mic.wav ] || [ -s system.wav ] || [ -s system16.wav ] || { echo "no audio captured"; exit 1; }

# whisper wants 16 kHz mono; mic.wav is already recorded that way. The raw
# system.wav (48 kHz float stereo, ~1.4 GB/hr) is deleted once the 16 kHz
# copy exists — the conversion is lossless for speech purposes and the small
# copy is what the 7-day re-run retention keeps.
if [ -s system.wav ]; then
  ffmpeg -y -hide_banner -loglevel error -i system.wav -ac 1 -ar 16000 system16.wav
  [ -s system16.wav ] && rm -f system.wav
fi

# VAD strips silence before transcription — without it, whisper hallucinates
# on quiet stretches and language auto-detect goes off the rails.
VAD_FLAGS=""
[ -f "$JARVIS_DIR/models/ggml-silero-v5.1.2.bin" ] && \
  VAD_FLAGS="--vad -vm $JARVIS_DIR/models/ggml-silero-v5.1.2.bin"

# Language auto-detect samples only the first seconds, so silence-led audio
# can misfire wildly (once: 'Norwegian' -> garbage). Accept only the
# configured languages; anything else retries pinned to the fallback.
# -mc 0 stops whisper's repetition loops on long echoey call audio (it
# otherwise re-feeds its own output as context and can get stuck emitting the
# same phrase for minutes); -sns suppresses non-speech tokens.
WFLAGS="-np -mc 0 -sns"

# The lang probe reads with errors='replace' because whisper can emit invalid
# UTF-8 mid-Devanagari (this once silently killed the pipeline), and it must
# NEVER abort processing — hence the '|| true'.
transcribe() { # $1 wav, $2 output prefix
  "$WHISPER" -m "$MODEL" -f "$1" -oj -of "$2" -l auto $WFLAGS $VAD_FLAGS
  local lang
  lang="$(python3 -c "import json,pathlib;print(json.loads(pathlib.Path('$2.json').read_text(errors='replace'))['result']['language'])" 2>/dev/null || true)"
  case " $LANGS " in
    *" $lang "*) ;;   # accepted
    *) [ -z "$lang" ] && return 0
       echo "detected '$lang' — retrying pinned to $RETRY_LANG"
       "$WHISPER" -m "$MODEL" -f "$1" -oj -of "$2" -l "$RETRY_LANG" $WFLAGS $VAD_FLAGS ;;
  esac
}

[ -s mic.wav ]      && transcribe mic.wav mic
[ -s system16.wav ] && transcribe system16.wav system

python3 "$JARVIS_DIR/tools/merge-transcripts.py" \
  --me mic.json --them system.json > transcript.md

# Audio (mic.wav + system16.wav) is kept for 7 days so any call can be
# re-transcribed after a fix or with a better model; call-watch's startup
# sweep purges WAVs older than that. Nothing is deleted here — the raw
# system.wav was already swapped for its small 16 kHz copy above.

NOTES="$JARVIS_DIR/reports/call-notes-$STAMP.md"

# No speech at all → almost always a phantom detection (a Meet pre-join tab
# left open holds the mic and looks like a call). Write a stub note, skip the
# Sonnet call, and keep it out of the second brain.
if ! grep -q '^\*\*\[' transcript.md; then
  {
    echo "# No speech detected"
    echo
    sed 's/^/- /' meta.txt
    echo
    echo "_Likely a phantom detection (pre-join screen left open) or a silent call._"
    echo "_Audio kept 7 days — rerun \`bash tools/process-call.sh reports/calls/$STAMP\` if this was real._"
  } > "$NOTES"
  echo "notes (no speech): $NOTES"
  exit 0
fi

# Known-people roster from the owner's memory: whisper spells names
# phonetically ("Harsh preet", "Insheeta"), and the prompt forbids inventing
# names — without the roster it faithfully preserves the misspelling.
ROSTER="$(head -c 6000 "$JARVIS_DIR/memory/about-me.md" 2>/dev/null)"
# Controlled topic vocabulary — the brain's Topics/ pages. Feeding the list
# into the prompt keeps one [[Claims]] hub instead of three near-duplicates.
TOPICS_DIR="$BRAIN_DIR/Topics"
TOPICS_LIST="$(ls "$TOPICS_DIR" 2>/dev/null | sed 's/\.md$//' | paste -sd ', ' -)"

{
  cat meta.txt
  echo
  cat transcript.md
} | claude -p --model sonnet "You are Jarvis writing meeting minutes for $OWNER, in the style of a good meeting facilitator (think Copilot meeting recap).
KNOWN PEOPLE — the owner's memory file, listing their team and colleagues with canonical spellings:
$ROSTER
When a name in the transcript is plausibly a phonetic or misspelled rendering of someone above (transcription mangles names), use the CANONICAL spelling from the roster. Only match when clearly plausible in context — a genuinely unknown participant keeps the transcript's spelling with a (?) marker; never force-match a stranger onto the roster.
CALENDAR HINTS: metadata lines starting 'calendar-hint:' describe calendar events that OVERLAPPED this recording — treat them as hints, NEVER as truth. If the transcript's content clearly matches a hinted meeting (same topic/people), use its subject to inform the title and its attendee list to resolve speaker names ('Them' voices are likely those attendees). If the conversation is clearly a DIFFERENT discussion (ad-hoc call during a scheduled block), IGNORE the hint entirely and derive everything from the transcript. When multiple hints overlap, pick the one the content supports, or none.
Input: call metadata, then a transcript. 'Me' is ALWAYS $OWNER. 'Them' is every other participant mixed into one channel — attribute their lines to real people using conversational cues: people addressing each other by name ('Arjun, can you take this?'), self-introductions, who answers a question aimed at a name, who a task is assigned to. NEVER invent a name; if no cue exists, write 'Someone'. Transcription may have errors (possibly mixed-language) — smooth over obvious ones, translate non-English phrases into English in the notes.
Output ONLY a markdown note, nothing else:
# <short descriptive call title>
- **Date/time:** <from metadata> · **Duration:** <estimate from timestamps> · **Platform:** <from url or mode>
## Participants
One bullet per person you can identify: '$OWNER (Me)', plus every name the conversation reveals. Mark guesses with (?). Omit section only if truly no one is identifiable.
## Summary
2-4 tight sentences: what the call was about and where it landed.
## Discussion
The Copilot-style recap — one bullet per meaningful point, attributed:
- <Name> explained/proposed/pointed out/raised ...
- $OWNER asked/agreed/committed to ...
Group related points; keep each bullet one line. This is the heart of the note.
## Decisions
Bullets, each with who drove it if clear. Omit section if none.
## Action items
Bullets, '- [ ]' checkboxes, owner FIRST: '- [ ] Arjun: send the design doc'. Use the named owner the call assigned it to; 'Me' for $OWNER's items; 'Unassigned' if nobody owns it. Omit if none.
## Open questions
Bullets. Omit if none.
End with EXACTLY one line connecting this call into the knowledge graph:
**Topics:** [[Topic One]] [[Topic Two]]
2-5 broad recurring themes the call belongs to (projects, workstreams, platforms). STRONGLY prefer these existing topics, exact spelling: ${TOPICS_LIST:-none yet}. Coin a new topic only for a clearly new recurring theme: Title Case, 1-3 words, ONE theme per topic (never mush two themes into one name), no punctuation or slashes inside the brackets.
Keep it scannable — read in 30 seconds." > "$NOTES"

# Topic hubs: create a stub page for any topic the notes reference, so each
# theme is a real node in the brain graph (and gets backlinks in Obsidian).
mkdir -p "$TOPICS_DIR"
grep -o '\[\[[^]]*\]\]' "$NOTES" | sed 's/^\[\[//;s/\]\]$//' | sort -u | while IFS= read -r t; do
  [ -z "$t" ] && continue
  t="${t//\//-}"   # slashes would become subdirectories
  tf="$TOPICS_DIR/$t.md"
  [ -f "$tf" ] || printf -- '---\ntitle: %s\ncreated: %s\n---\n\nTopic hub — every call and note linking here forms this cluster.\n' "$t" "$(date +%Y-%m-%d)" > "$tf"
done

# File a copy in the second brain so vault-search / recall can find it.
mkdir -p "$VAULT_CALLS"
cp "$NOTES" "$VAULT_CALLS/call-$STAMP.md"

echo "notes: $NOTES"
echo "vault: $VAULT_CALLS/call-$STAMP.md"
osascript -e "display notification \"Call notes ready: call-notes-$STAMP.md\" with title \"Jarvis\"" >/dev/null 2>&1 || true
