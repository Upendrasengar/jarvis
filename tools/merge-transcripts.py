#!/usr/bin/env python3
# Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
"""merge-transcripts.py — interleave two whisper.cpp JSON transcripts
(mic = "Me", system audio = "Them") into one speaker-labeled markdown
transcript ordered by time. Deterministic; no LLM.

Usage: merge-transcripts.py --me mic.json --them system.json > transcript.md
"""
import argparse
import re
from difflib import SequenceMatcher
import json
import sys
from pathlib import Path


def load(path, speaker):
    p = Path(path)
    if not p.is_file():
        return []
    # errors='replace': whisper can emit invalid UTF-8 mid-Devanagari
    data = json.loads(p.read_text(errors="replace"))
    out = []
    for seg in data.get("transcription", []):
        text = seg.get("text", "").replace("�", "").strip()
        start = seg.get("offsets", {}).get("from", 0)  # ms
        # whisper emits noise markers like [BLANK_AUDIO] / (music) on silence
        if not text or text.startswith(("[", "(")):
            continue
        out.append((start, speaker, text))
    return out


# An open microphone in a room with speakers hears BOTH sides. Everything on
# the mic channel was then labelled "Me", so the other person's words were
# attributed to the owner — a call on 2026-09-21 opens with "All right, guys,
# let's go ahead and get started" credited to the owner, spoken by the host.
#
# The system channel is ground truth for the far side: it is captured from the
# audio stream, not a room. So where the mic repeats what the system already
# has, at the same moment, the mic copy is bleed and goes.
#
# Deliberately conservative — a wrongly dropped line is lost evidence, while a
# wrongly kept one is merely a misattribution the reader can see. Both the
# time window and the similarity bar have to be cleared.
BLEED_WINDOW_MS = 3000      # tolerance AFTER the channel offset is removed
BLEED_SIMILARITY = 0.72
LAG_SEARCH_MS = 20000       # the two recorders start seconds apart


def _norm(t):
    return re.sub(r"[^a-z0-9 ]", "", t.lower()).strip()


def channel_lag(me, them):
    """How far the mic clock sits behind the system clock, in ms.

    The two recorders are separate processes started moments apart — on the
    call this was written for, system audio began at 09:35:57 and the mic at
    09:36:01. So the same sentence carries timestamps four seconds apart, and
    a fixed window either misses the match or has to be made so wide it starts
    swallowing genuine speech.

    Measure it instead: for each candidate lag, count how many mic segments
    line up with a near-identical system segment, and take the lag that
    explains the most. No bleed means no clear winner, and 0 is returned.
    """
    pairs = [(m[0], _norm(m[2]), t[0], _norm(t[2]))
             for m in me if len(_norm(m[2])) >= 20
             for t in them if len(_norm(t[2])) >= 20]
    best, best_hits = 0, 0
    for lag in range(-LAG_SEARCH_MS, LAG_SEARCH_MS + 1, 500):
        hits = sum(1 for ms, mn, ts, tn in pairs
                   if abs((ms + lag) - ts) <= BLEED_WINDOW_MS
                   and SequenceMatcher(None, mn, tn).ratio() >= BLEED_SIMILARITY)
        if hits > best_hits:
            best, best_hits = lag, hits
    # One coincidental match is not an offset.
    return best if best_hits >= 2 else 0


def drop_bleed(me, them):
    if not me or not them:
        return me, 0
    lag = channel_lag(me, them)
    kept, dropped = [], 0
    for start, speaker, text in me:
        n = _norm(text)
        if len(n) < 12:            # too short to judge; keep it
            kept.append((start, speaker, text))
            continue
        near = [t for t in them if abs((start + lag) - t[0]) <= BLEED_WINDOW_MS]
        if any(SequenceMatcher(None, n, _norm(t[2])).ratio() >= BLEED_SIMILARITY
               for t in near):
            dropped += 1
            continue
        kept.append((start, speaker, text))
    return kept, dropped


def fmt(ms):
    s = ms // 1000
    return f"{s // 60:02d}:{s % 60:02d}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--me", required=True)
    ap.add_argument("--them", required=True)
    ap.add_argument("--mic-db", type=float, default=None)
    ap.add_argument("--sys-db", type=float, default=None)
    ap.add_argument("--drop-mic", action="store_true",
                    help="the owner did not speak; the mic heard only the room")
    args = ap.parse_args()

    me, them = load(args.me, "Me"), load(args.them, "Them")
    if args.drop_mic:
        # The owner says they did not speak. Then every mic segment is the room,
        # and no similarity test is needed or trustworthy — whisper hears a
        # faint copy differently enough that most spill does not match. A
        # person's own account of whether they talked beats any heuristic.
        print(f"merge: dropping all {len(me)} mic segment(s) — owner did not speak",
              file=sys.stderr)
        me = []
    before = len(me)
    me, dropped = drop_bleed(me, them)
    if dropped:
        # stderr, so it lands in process.log without polluting the transcript
        print(f"merge: dropped {dropped} mic segment(s) that duplicated the "
              f"far side — speaker bleed", file=sys.stderr)
    segs = sorted(me + them)
    if not segs:
        print("_(no speech detected)_")
        return

    # Coalesce consecutive segments from the same speaker — but not without
    # limit. Coalescing only ever broke on a change of speaker, so a call where
    # one side does all the talking (or where the mic is dropped entirely)
    # collapsed into a single unbroken paragraph with one timestamp on it:
    # forty minutes of speech, unnavigable, and useless for citing a moment.
    #
    # Break on a pause as well, and on length, so the transcript keeps the
    # timestamps that make it referenceable.
    GAP_MS = 10000
    MAX_CHARS = 700
    merged = []
    for start, speaker, text in segs:
        last = merged[-1] if merged else None
        if (last and last[1] == speaker
                and start - last[3] <= GAP_MS
                and len(last[2]) + len(text) <= MAX_CHARS):
            last[2] += " " + text
            last[3] = start
        else:
            merged.append([start, speaker, text, start])

    print("## Transcript\n")
    # Only the exact duplicates can be removed. When the mic was clearly
    # listening to the room rather than to one person, whisper hears the far
    # side differently enough on a faint copy that near-matches survive — and
    # a reader who believes every "Me" line is the owner will draw wrong
    # conclusions from the ones that slipped through. Say so once, here, where
    # both the owner and the summariser will see it.
    # Either signal is enough. A quarter of the mic being provable duplicates
    # is damning on its own; so is a mic sitting far below the call it is
    # supposedly half of, because that is a room pickup, not a speaker.
    quiet_mic = (args.mic_db is not None and args.sys_db is not None
                 and args.sys_db - args.mic_db >= 12)
    if (before and dropped / before >= 0.25) or (quiet_mic and dropped):
        print("> [!warning] Speaker attribution is unreliable for this call\n"
              f"> {dropped} of {before} microphone segments were the other side, "
              "picked up from speakers. Obvious duplicates were removed; some "
              "may remain mislabelled as \"Me\". Headphones prevent this.\n")
    for start, speaker, text, _ in merged:
        print(f"**[{fmt(start)}] {speaker}:** {text}\n")


if __name__ == "__main__":
    sys.exit(main())
