#!/usr/bin/env python3
# Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
"""merge-transcripts.py — interleave two whisper.cpp JSON transcripts
(mic = "Me", system audio = "Them") into one speaker-labeled markdown
transcript ordered by time. Deterministic; no LLM.

Usage: merge-transcripts.py --me mic.json --them system.json > transcript.md
"""
import argparse
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


def fmt(ms):
    s = ms // 1000
    return f"{s // 60:02d}:{s % 60:02d}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--me", required=True)
    ap.add_argument("--them", required=True)
    args = ap.parse_args()

    segs = sorted(load(args.me, "Me") + load(args.them, "Them"))
    if not segs:
        print("_(no speech detected)_")
        return

    # Coalesce consecutive segments from the same speaker into one line.
    merged = []
    for start, speaker, text in segs:
        if merged and merged[-1][1] == speaker:
            merged[-1][2] += " " + text
        else:
            merged.append([start, speaker, text])

    print("## Transcript\n")
    for start, speaker, text in merged:
        print(f"**[{fmt(start)}] {speaker}:** {text}\n")


if __name__ == "__main__":
    sys.exit(main())
