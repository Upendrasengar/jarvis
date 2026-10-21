#!/usr/bin/env bash
# Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
# live-assist.sh <session-dir> — live meeting copilot for a call that is being
# recorded. Every ~15s it slices the audio that arrived since the last slice
# out of the growing mic.wav/system.wav, transcribes it with a SMALL local
# whisper model, and appends it to live/transcript.md. About once a minute it
# hands the transcript (plus the owner's open action items, calendar hint and
# related notes) to the quick model, which returns a short grouped list —
# questions to ask, things to mention, what was agreed, details to watch —
# into live/assist.json for the call page.
#
# Opt-in per call (the server starts and stops this; see
# apps/server/src/services/liveAssist.ts). Self-terminating: it exits on its
# own when the session gets its "ended:" line, when the session dir is
# deleted, or when live/.stop appears — so a server restart or a dead watcher
# never leaves it running against a finished call.
#
# The final notes still come from process-call.sh's full pass after the call;
# nothing here is reused for them. Transcript text goes to the model as it is
# produced — the same category of data as the post-call notes pass, at a
# different cadence; the UI says so.
set -uo pipefail
JARVIS_DIR="${JARVIS_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
source "$JARVIS_DIR/tools/paths.sh"

SESSION="$(cd "${1:?session dir required}" 2>/dev/null && pwd)" || { echo "no such session: $1"; exit 1; }
LIVE="$SESSION/live"
mkdir -p "$LIVE"

# One instance per session. A stale pid file (dead process) is taken over.
if [ -f "$LIVE/.pid" ]; then
  old="$(tr -cd '0-9' < "$LIVE/.pid")"
  if [ -n "$old" ] && [ "$old" != "$$" ] && kill -0 "$old" 2>/dev/null \
     && ps -o command= -p "$old" 2>/dev/null | grep -q live-assist; then
    echo "already running (pid $old)"; exit 0
  fi
fi
echo "$$" > "$LIVE/.pid"
rm -f "$LIVE/.stop"

log() { echo "$(date '+%H:%M:%S') $*"; }

# ── tunables ──────────────────────────────────────────────────────────────
SLICE=15          # seconds between rounds
MIN_NEW=10        # do not bother whisper with less than this much new audio
MAX_SLICE=45      # longest slice per channel per round (keeps lag bounded)
OVERLAP=1.5       # seconds re-read from the previous slice so boundary words survive
ASSIST_EVERY=60   # seconds between model rounds
SILENT_DB=-45     # a slice quieter than this (mean) is skipped — nobody spoke

jarvis_model() {   # $1 = role file stem, $2 = default
  local v
  v="$(head -1 "$JARVIS_DIR/memory/settings/$1.txt" 2>/dev/null | tr -d '[:space:]' | tr 'A-Z' 'a-z')"
  case "$v" in haiku|sonnet|opus) printf '%s' "$v" ;; *) printf '%s' "$2" ;; esac
}
MODEL_TIER="$(jarvis_model model-quick haiku)"

# Small and fast on purpose: this runs WHILE the call (and Teams/Meet) is
# using the machine. memory/settings/live-whisper-model.txt overrides.
PREF="$(tr -d '[:space:]' 2>/dev/null < "$JARVIS_DIR/memory/settings/live-whisper-model.txt" || true)"
WMODEL=""
for cand in "${PREF:-small}" base small base.en small.en "$(tr -d '[:space:]' 2>/dev/null < "$JARVIS_DIR/memory/settings/whisper-model.txt")"; do
  [ -n "$cand" ] && [ -f "$JARVIS_DIR/models/ggml-$cand.bin" ] && { WMODEL="$JARVIS_DIR/models/ggml-$cand.bin"; break; }
done
WHISPER="$(command -v whisper-cli || echo /opt/homebrew/bin/whisper-cli)"
VAD_FLAGS=""
[ -f "$JARVIS_DIR/models/ggml-silero-v5.1.2.bin" ] && VAD_FLAGS="--vad -vm $JARVIS_DIR/models/ggml-silero-v5.1.2.bin"
WFLAGS="-np -nt -mc 0 -sns -l auto"

write_status() {   # $1 = paused reason ("" = running)
  python3 - "$LIVE/status.json" "$1" "$TRANSCRIBED" "$WMODEL" "$LAST_ROUND_MS" "$MODEL_TIER" <<'PY' 2>/dev/null
import json, sys, time, os
p, paused, secs, wmodel, ms, tier = sys.argv[1:]
tmp = p + ".tmp"
json.dump({"at": int(time.time()*1000), "paused": paused, "transcriptSecs": float(secs or 0),
           "whisper": os.path.basename(wmodel), "lastRoundMs": int(ms or 0), "model": tier}, open(tmp, "w"))
os.replace(tmp, p)
PY
}

fail() {
  log "FATAL: $*"
  python3 - "$LIVE/assist.json" "$*" <<'PY' 2>/dev/null
import json, sys, time
p, err = sys.argv[1:]
try: d = json.load(open(p))
except Exception: d = {"updatedAt": 0, "summary": "", "items": [], "rounds": 0, "model": ""}
d["error"] = err; d["updatedAt"] = int(time.time()*1000)
json.dump(d, open(p, "w"))
PY
  rm -f "$LIVE/.pid"
  exit 1
}
TRANSCRIBED=0; LAST_ROUND_MS=0
[ -x "$WHISPER" ] || command -v "$WHISPER" >/dev/null 2>&1 || fail "whisper-cli not found — brew install whisper-cpp"
[ -n "$WMODEL" ] || fail "no whisper model under models/ — run: jarvis setup"
command -v claude >/dev/null 2>&1 || fail "claude CLI not on PATH"

# macOS has no timeout(1); same backgrounded-killer pattern as call-watch.sh.
bounded() {   # $1 = seconds, rest = command; stdout passes through
  local secs="$1"; shift
  local out; out="$(mktemp)"
  "$@" >"$out" 2>/dev/null &
  local pid=$!
  ( sleep "$secs"; kill -9 "$pid" 2>/dev/null ) >/dev/null 2>&1 &
  local killer=$!
  wait "$pid" 2>/dev/null; local rc=$?
  kill "$killer" 2>/dev/null; wait "$killer" 2>/dev/null
  cat "$out"; rm -f "$out"
  return $rc
}

children=()
cleanup() {
  for p in "${children[@]:-}"; do [ -n "$p" ] && kill "$p" 2>/dev/null; done
  rm -f "$LIVE/.pid"
  write_status "stopped"
}
trap 'cleanup; exit 0' TERM INT
trap 'rm -f "$LIVE/.pid"' EXIT

# ── audio geometry ────────────────────────────────────────────────────────
# The recorders write a WAV whose size fields are placeholders until they
# close the file, so duration comes from the byte count, not the header.
# bytes-per-second and the data offset are probed once per file.
# macOS ships bash 3.2 (no associative arrays): per-channel state lives in
# MIC_BPS/MIC_OFF/MIC_DONE and SYS_BPS/SYS_OFF/SYS_DONE, reached by name.
MIC_BPS=""; MIC_OFF=""; MIC_DONE=0
SYS_BPS=""; SYS_OFF=""; SYS_DONE=0
probe() {   # $1 = channel key (MIC|SYS), $2 = wav → sets <key>_BPS/<key>_OFF; 1 if not readable yet
  local key="$1" f="$2" info rate ch codec bytes off
  [ -s "$f" ] || return 1
  info="$(ffprobe -v error -show_entries stream=codec_name,sample_rate,channels -of default=nw=1 "$f" 2>/dev/null)"
  rate="$(sed -n 's/^sample_rate=//p' <<<"$info" | head -1)"
  ch="$(sed -n 's/^channels=//p' <<<"$info" | head -1)"
  codec="$(sed -n 's/^codec_name=//p' <<<"$info" | head -1)"
  case "$codec" in pcm_s16le|pcm_s16be) bytes=2 ;; pcm_s24le) bytes=3 ;; pcm_f32le|pcm_s32le) bytes=4 ;; pcm_u8) bytes=1 ;; *) return 1 ;; esac
  [ -n "$rate" ] && [ -n "$ch" ] || return 1
  off="$(python3 -c "
import sys; b=open(sys.argv[1],'rb').read(65536); i=b.find(b'data'); print(i+8 if i>=0 else 44)" "$f" 2>/dev/null || echo 44)"
  eval "${key}_BPS=$(( rate * ch * bytes )); ${key}_OFF=$off"
  return 0
}
secs_available() {   # $1 = channel key, $2 = wav
  local key="$1" f="$2" size bps off
  size="$(stat -f %z "$f" 2>/dev/null || echo 0)"
  bps="${key}_BPS"; off="${key}_OFF"
  python3 -c "print(max(0.0, ($size - ${!off}) / ${!bps}))"
}

# ── context the model gets once ───────────────────────────────────────────
META="$(cat "$SESSION/meta.txt" 2>/dev/null)"
SUBJECT="$(sed -n 's/^calendar-hint: \([^|]*\).*/\1/p' <<<"$META" | head -1 | sed 's/ *$//')"
STARTED="$(sed -n 's/^started: //p' <<<"$META" | head -1)"
START_EPOCH="$(date -j -f "%Y-%m-%d %H:%M:%S" "$STARTED" +%s 2>/dev/null || date +%s)"
PORT="$(tr -d '[:space:]' < "$JARVIS_DIR/memory/settings/port.txt" 2>/dev/null || echo 4321)"

OPEN_ITEMS="$(curl -s --max-time 8 "http://localhost:$PORT/api/actions" 2>/dev/null | python3 -c '
import json, sys
try: acts = json.load(sys.stdin)
except Exception: acts = []
out = []
for a in acts:
    if a.get("done"): continue
    out.append(f"- [{a.get(\"callStarted\",\"\")[:10]} · {a.get(\"callTitle\",\"\")[:60]}] {a.get(\"text\",\"\")[:160]}")
    if len(out) >= 40: break
print("\n".join(out))' 2>/dev/null)"

PREV_NOTES=""; RELATED=""
if [ -n "$SUBJECT" ]; then
  prev="$(grep -ilF -- "$SUBJECT" "$CALL_NOTES_DIR"/*.md 2>/dev/null | sort | tail -1)"
  [ -n "$prev" ] && PREV_NOTES="$(head -c 3500 "$prev")"
  RELATED="$(bounded 15 bash "$JARVIS_DIR/tools/vault-search.sh" "$SUBJECT" | head -c 2500)"
fi
ROSTER="$(head -c 3000 "$JARVIS_DIR/memory/about-me.md" 2>/dev/null || true)"

log "live assist on: $SESSION (whisper $(basename "$WMODEL"), model $MODEL_TIER, subject '${SUBJECT:-?}')"
write_status "starting"

# ── transcription round ───────────────────────────────────────────────────
TRANSCRIPT="$LIVE/transcript.md"
touch "$TRANSCRIPT"
stamp() {   # $1 = seconds into the call → clock time
  date -r "$(python3 -c "print(int($START_EPOCH + $1))")" +%H:%M
}
transcribe_channel() {   # $1 = channel key (MIC|SYS), $2 = wav, $3 = speaker label
  local key="$1" f="$2" who="$3" avail new start dur slice vol text bpsvar donevar done
  bpsvar="${key}_BPS"; donevar="${key}_DONE"
  [ -n "${!bpsvar}" ] || probe "$key" "$f" || return 0
  done="${!donevar}"
  avail="$(secs_available "$key" "$f")"
  new="$(python3 -c "print($avail - $done)")"
  [ "$(python3 -c "print(1 if $new >= $MIN_NEW else 0)")" = 1 ] || return 0
  # the final half-second may still be mid-write; leave it for next time
  start="$(python3 -c "print(max(0.0, $done - $OVERLAP))")"
  dur="$(python3 -c "print(min($avail - 0.5 - $start, $MAX_SLICE + $OVERLAP))")"
  slice="$LIVE/.slice-$who.wav"
  # -ignore_length: the header says 0 bytes while the recorder is writing.
  # Input-side -ss is a byte seek on PCM, so a 1 GB file costs nothing.
  bounded 20 ffmpeg -y -hide_banner -loglevel error -ignore_length 1 -ss "$start" -t "$dur" \
    -i "$f" -ac 1 -ar 16000 "$slice" >/dev/null
  [ -s "$slice" ] || return 0
  eval "${donevar}=$(python3 -c "print($start + $dur)")"
  vol="$(ffmpeg -hide_banner -i "$slice" -af volumedetect -f null - 2>&1 | sed -n 's/.*mean_volume: \([-0-9.]*\) dB.*/\1/p' | head -1)"
  if [ -n "$vol" ] && [ "$(python3 -c "print(1 if $vol < $SILENT_DB else 0)")" = 1 ]; then
    rm -f "$slice"; return 0
  fi
  # nice, not taskpolicy -b: this has to keep up with the call, not yield to it
  text="$(bounded 60 nice -n 10 "$WHISPER" -m "$WMODEL" -f "$slice" $WFLAGS $VAD_FLAGS \
    | sed 's/^[[:space:]]*//; s/[[:space:]]*$//' | grep -v '^$' | grep -v '^\[BLANK_AUDIO\]$' | tr '\n' ' ')"
  rm -f "$slice"
  text="$(sed 's/  */ /g; s/ $//' <<<"$text")"
  [ -n "$text" ] || return 0
  printf '[%s] %s: %s\n' "$(stamp "$start")" "$who" "$text" >> "$TRANSCRIPT"
}

# ── model round ───────────────────────────────────────────────────────────
LAST_ASSIST=0; LAST_LEN=0; ROUNDS=0
assist_round() {
  local now len tail tmpd prompt raw
  now="$(date +%s)"
  [ $(( now - LAST_ASSIST )) -ge "$ASSIST_EVERY" ] || return 0
  len="$(wc -c < "$TRANSCRIPT" | tr -d ' ')"
  # nothing new to say anything about (first round waits for a real start)
  if [ "$LAST_LEN" = 0 ]; then [ "$len" -ge 200 ] || return 0
  else [ $(( len - LAST_LEN )) -ge 80 ] || return 0; fi
  LAST_ASSIST="$now"; LAST_LEN="$len"
  tmpd="$(mktemp -d)"
  # the last ~12k chars is plenty of context; the earlier part lives on in
  # the previous items, which carry forward by id
  tail="$(tail -c 12000 "$TRANSCRIPT")"
  {
    echo "You are a live meeting copilot for the owner of this transcript. A call is IN PROGRESS; below is what has been said so far."
    echo "Speakers: 'Me' = the owner (your user). 'Them' = everyone else on the call (one channel, not separated by person)."
    echo "The transcript comes from a small local speech model in 15-45 second slices: a few words may repeat at slice boundaries, names are often misheard, and the two channels are interleaved by time, not by turn."
    echo
    [ -n "$ROSTER" ] && { echo "## About the owner (names they know — fix misheard names against these)"; echo "$ROSTER"; echo; }
    echo "## This meeting"
    grep -E '^(url|started|calendar-hint)' <<<"$META"
    echo
    [ -n "$OPEN_ITEMS" ] && { echo "## The owner's OPEN action items from earlier calls (things they may owe someone, or be owed)"; echo "$OPEN_ITEMS"; echo; }
    [ -n "$PREV_NOTES" ] && { echo "## Notes from the previous call with the same title"; echo "$PREV_NOTES"; echo; }
    [ -n "$RELATED" ] && { echo "## Related pages from the owner's notes (grep hits — snippets only)"; echo "$RELATED"; echo; }
    echo "## Suggestions you gave last round (JSON). An item that is still about the same thing keeps its EXACT id AND its exact text — do not reword, merge, split or re-group it. DROP an item only when the transcript shows it was asked, mentioned or answered since. Add a new item only for something genuinely new, with a new id."
    cat "$LIVE/assist.json" 2>/dev/null || echo '{"items":[]}'
    echo
    if [ -s "$LIVE/history.jsonl" ]; then
      echo "## Items you dropped in earlier rounds — do not bring these back reworded. Re-add one only if the topic genuinely comes back up:"
      python3 - "$LIVE/history.jsonl" "$LIVE/assist.json" "$LIVE/done.txt" <<'PY' 2>/dev/null
import json, sys
hp, ap, dp = sys.argv[1:]
try: cur = {i["id"] for i in json.load(open(ap)).get("items", [])}
except Exception: cur = set()
try: done = {l.strip() for l in open(dp) if l.strip()}
except Exception: done = set()
seen = {}
for line in open(hp):
    try: r = json.loads(line)
    except Exception: continue
    for it in r.get("items", []): seen[it["id"]] = it
for it in list(seen.values())[-14:]:
    if it["id"] not in cur and it["id"] not in done: print(f"- ({it['group']}) {it['text']}")
PY
      echo
    fi
    if [ -s "$LIVE/done.txt" ]; then
      echo "## Ids the owner has already ticked off — never bring these back under any id:"
      tr '\n' ' ' < "$LIVE/done.txt"; echo
    fi
    echo
    echo "## Transcript so far (most recent at the bottom)"
    echo "$tail"
    echo
    cat <<'EOP'
## Your output
Return ONLY a JSON object, no prose, no code fence:
{"summary": "<one line: where the conversation is right now>",
 "items": [{"id": "<short stable id>", "group": "ask|mention|agreed|watch", "text": "<=140 chars", "why": "<=90 chars or empty>"}]}

Groups:
- ask     — a question the owner should ask: something left unanswered or ambiguous, a decision that needs the owner's input, a number or date nobody confirmed.
- mention — something the owner should bring up: an open item from their ledger that this discussion touches, a fact from their notes the others are missing, a commitment relevant to what is being said right now.
- agreed  — a decision or commitment made ON THIS CALL: who, what, by when. Only what was actually said.
- watch   — a date, number, name or figure said once that will matter later.

Rules: at most 4 items per group, most useful first. Specific to THIS conversation — nothing generic ("ask about next steps" is worthless). Write items the owner can say out loud as they are. If nothing is actionable yet, return an empty items array. Never invent names: use the roster, or describe the person. Never write "Speaker", "a speaker" or "the speaker" — 'Them' is several people on one channel: name the person when a cue exists, otherwise say "they" / "someone on the call" / their role. One fact = one item: never list the same thing under two groups.
EOP
  } > "$tmpd/prompt.txt"
  # No tools: everything it needs is in the prompt, and nothing here may
  # touch a file (same lockdown as triage-actions.sh).
  # The prompt file is opened INSIDE the bounded command: a job started with
  # '&' in a non-interactive shell gets /dev/null as stdin, so a redirect on
  # the outside would hand the model an empty prompt (it did).
  raw="$(bounded 90 sh -c 'exec claude -p --model "$1" \
    --disallowedTools="Bash,Read,Edit,Write,Grep,Glob,WebFetch,WebSearch,Task,NotebookEdit" < "$2"' \
    _ "$MODEL_TIER" "$tmpd/prompt.txt")"
  ROUNDS=$((ROUNDS + 1))
  printf '%s' "$raw" > "$tmpd/raw.txt"
  # kept for `jarvis logs`-style debugging of a round that produced nothing
  printf '%s' "$raw" > "$LIVE/last-raw.txt"
  python3 - "$LIVE/assist.json" "$tmpd/raw.txt" "$ROUNDS" "$MODEL_TIER" "$LIVE/done.txt" <<'PY'
import json, re, sys, time, os
out, rawp, rounds, model, donep = sys.argv[1:]
raw = open(rawp, errors="replace").read().strip()
raw = re.sub(r"^```(json)?\s*|\s*```$", "", raw, flags=re.M).strip()
try: prev = json.load(open(out))
except Exception: prev = {"items": [], "summary": ""}
d = None
try:
    d = json.loads(raw)
except Exception:
    m = re.search(r"\{[\s\S]*\}", raw)
    if m:
        try: d = json.loads(m.group(0))
        except Exception: d = None
try: done = {l.strip() for l in open(donep) if l.strip()}
except Exception: done = set()
state = {"updatedAt": int(time.time()*1000), "rounds": int(rounds), "model": model, "error": ""}
if not isinstance(d, dict):
    # keep the last good list on screen; say the round failed
    state["summary"] = prev.get("summary", ""); state["items"] = prev.get("items", [])
    state["error"] = "model returned no JSON this round"
else:
    items, seen = [], set()
    for it in (d.get("items") or []):
        if not isinstance(it, dict): continue
        g = str(it.get("group", "")).strip().lower()
        t = str(it.get("text", "")).strip()
        i = re.sub(r"[^\w-]", "", str(it.get("id", "")))[:40] or f"i{len(items)+1}"
        if g not in ("ask", "mention", "agreed", "watch") or not t or i in seen or i in done: continue
        seen.add(i)
        items.append({"id": i, "group": g, "text": t[:200], "why": str(it.get("why", "") or "")[:140]})
    state["summary"] = str(d.get("summary", "") or "")[:240]
    # The model rewords and re-ids items it was told to keep — the same
    # suggestion then shows up as NEW while its twin drops to "earlier". So
    # the mapping is enforced here: a candidate that reads like a previous
    # item (on screen now, or in history) takes that item's id, and keeps
    # its on-screen wording so the list does not jitter under the reader.
    import difflib
    STOP = set("the a an and or of to in on for with is are was were be been it this that they them you your we our its at by as from about into not no do does did will would should can could any what who when where which how there here".split())
    def stem(w):
        for suf in ("ing", "ed", "es", "s"):
            if len(w) > 4 and w.endswith(suf): return w[: -len(suf)]
        return w
    def words(t):
        t = re.sub(r"(\d+)\s*million\b", r"\1m", t.lower()).replace("$", "")
        return {stem(w) for w in re.findall(r"[a-z0-9%]+", t) if w not in STOP}
    def alike(a, b):
        wa, wb = words(a), words(b)
        if not wa or not wb: return False
        j = len(wa & wb) / len(wa | wb)
        return j >= 0.45 or difflib.SequenceMatcher(None, a.lower(), b.lower()).ratio() >= 0.62
    known = {}   # id -> item, history first then current (current wins)
    try:
        for line in open(os.path.join(os.path.dirname(out), "history.jsonl")):
            try: r = json.loads(line)
            except Exception: continue
            for it in r.get("items", []): known[it["id"]] = it
    except Exception: pass
    cur_ids = set()
    for it in prev.get("items", []): known[it["id"]] = it; cur_ids.add(it["id"])
    merged, used = [], set()
    for it in items:
        match = known.get(it["id"])
        if match is None or not alike(match.get("text", ""), it["text"]):
            # new id (or an id reused for something else): look for a twin
            best, best_cur = None, False
            for kid, k in known.items():
                if kid in used: continue
                if alike(k.get("text", ""), it["text"]):
                    is_cur = kid in cur_ids
                    if best is None or (is_cur and not best_cur): best, best_cur = kid, is_cur
            if best is not None:
                if best in done: continue              # the owner ticked this off already
                k = known[best]
                it = {"id": best, "group": k.get("group", it["group"]), "text": it["text"], "why": it["why"]}
                if best in cur_ids:                    # on screen: keep the wording it has
                    it["text"], it["why"] = k.get("text", it["text"]), k.get("why", it["why"])
        if it["id"] in used: continue
        used.add(it["id"]); merged.append(it)
    state["items"] = merged[:16]
tmp = out + ".tmp"
json.dump(state, open(tmp, "w"), ensure_ascii=False)
os.replace(tmp, out)
# Every round is appended, so an item the model drops next round is still
# on record: the page shows it under "earlier" and the recap after the call.
if not state["error"]:
    with open(os.path.join(os.path.dirname(out), "history.jsonl"), "a") as h:
        h.write(json.dumps({"at": state["updatedAt"], "round": state["rounds"],
                            "summary": state["summary"], "items": state["items"]}, ensure_ascii=False) + "\n")
PY
  rm -rf "$tmpd"
  log "assist round $ROUNDS: $(python3 -c "import json;d=json.load(open('$LIVE/assist.json'));print(len(d.get('items',[])),'items',('— '+d['error']) if d.get('error') else '')" 2>/dev/null)"
}

# ── main loop ─────────────────────────────────────────────────────────────
while :; do
  [ -d "$SESSION" ] || { log "session gone — exiting"; break; }
  [ -f "$LIVE/.stop" ] && { log "stop requested — exiting"; break; }
  grep -q '^ended:' "$SESSION/meta.txt" 2>/dev/null && { log "call ended — exiting"; break; }

  # On battery and low: hold whisper rather than finish the call at 5%.
  batt="$(pmset -g batt 2>/dev/null)"
  pct="$(sed -n 's/.*[[:space:]]\([0-9]\{1,3\}\)%.*/\1/p' <<<"$batt" | head -1)"
  if grep -q "Battery Power" <<<"$batt" && [ -n "$pct" ] && [ "$pct" -lt 25 ]; then
    write_status "paused: battery at ${pct}% — plug in to resume"
    sleep "$SLICE" & children=($!); wait $!; continue
  fi

  t0="$(date +%s)"
  transcribe_channel MIC "$SESSION/mic.wav" "Me"
  transcribe_channel SYS "$SESSION/system.wav" "Them"
  TRANSCRIBED="$(python3 -c "print(max($MIC_DONE, $SYS_DONE))")"
  LAST_ROUND_MS=$(( ($(date +%s) - t0) * 1000 ))
  write_status ""
  assist_round

  sleep "$SLICE" & children=($!); wait $!
done
cleanup
