#!/usr/bin/env bash
# triage-actions.sh — nightly attention pass over open action items.
# Sonnet ANNOTATES, never rewrites: items go in as data (stable ids), JSON
# comes back with clusters (same real-world task, incl. paraphrases),
# resolved deadlines (relative phrases anchored to the item's call date),
# blocked/blocking notes, and one-line reasons. Output: data/triage.json.
# Ranking itself is deterministic and lives in the UI — the LLM supplies
# only the judgement code can't.
set -uo pipefail
JARVIS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="$(head -1 "$JARVIS_DIR/memory/settings/port.txt" 2>/dev/null | tr -cd '0-9')"
PORT="${PORT:-4321}"
TODAY="$(date +%Y-%m-%d)"
OUT="$JARVIS_DIR/data/triage.json"

ITEMS="$(curl -s --max-time 10 "http://localhost:$PORT/api/actions" | python3 -c "
import json, sys
try: acts = json.load(sys.stdin)
except Exception: sys.exit(1)
open_items = [
    {'id': f\"{a['callId']}|{a['index']}\", 'owner': a['owner'], 'text': a['text'],
     'callTitle': a['callTitle'], 'callDate': a['callStarted'][:10], 'comments': a['comments'][-3:]}
    for a in acts if not a['done'] and a.get('text')
]
print(json.dumps(open_items))" )"
[ -z "$ITEMS" ] && { echo "[triage] no items / server down — skipped"; exit 0; }

RAW="$(claude -p --model sonnet "Today is $TODAY. Below are my open action items from recorded calls and notes, as JSON (id, owner, text, source call title + date, recent comments).

Reply with ONLY a JSON object (no markdown fences, no prose):
{
 \"clusters\": [[\"id\",\"id\"],...],
 \"deadlines\": {\"id\": \"YYYY-MM-DD\"},
 \"blocked\": {\"id\": \"short note\"},
 \"reasons\": {\"id\": \"one short line why this needs attention now\"}
}

Rules:
- clusters: group ids that describe the SAME real-world task (including paraphrases) across different sources. Only genuine duplicates; omit singletons.
- deadlines: only items whose text/comments imply a due date. Resolve relative phrases (\"by Thursday\", \"tonight\", \"end of September\") against the item's callDate. ISO dates only.
- blocked: items that are blocked/waiting on someone, or that BLOCK someone else's work — note who/what in <8 words.
- reasons: at most 10 items that genuinely need attention now; one tight line each. Not a summary — a 'why now'.
- Reference items ONLY by their exact id. No invented ids, no rewritten text.

$ITEMS" 2>/dev/null)"

TMPD="$(mktemp -d)"
printf '%s' "$ITEMS" > "$TMPD/items.json"
printf '%s' "$RAW" > "$TMPD/raw.txt"
python3 - "$OUT" "$TODAY" "$TMPD/items.json" "$TMPD/raw.txt" <<'PYEOF'
import json, re, sys
out_path, today, items_path, raw_path = sys.argv[1:5]
raw = open(raw_path).read().strip()
raw = re.sub(r"^```(json)?\s*|\s*```$", "", raw, flags=re.M).strip()
try:
    d = json.loads(raw)
except Exception as e:
    print(f"[triage] LLM output unparseable ({e}) — keeping previous triage")
    sys.exit(0)
valid = {i["id"] for i in json.load(open(items_path))}
out = {
    "generatedAt": today,
    "clusters": [[i for i in c if i in valid] for c in d.get("clusters", []) if isinstance(c, list)],
    "deadlines": {k: v for k, v in d.get("deadlines", {}).items() if k in valid and re.match(r"^\d{4}-\d{2}-\d{2}$", str(v))},
    "blocked": {k: str(v)[:80] for k, v in d.get("blocked", {}).items() if k in valid},
    "reasons": {k: str(v)[:140] for k, v in d.get("reasons", {}).items() if k in valid},
}
out["clusters"] = [c for c in out["clusters"] if len(c) >= 2]
with open(out_path, "w") as f:
    json.dump(out, f, indent=1)
print(f"[triage] {len(out['clusters'])} clusters · {len(out['deadlines'])} deadlines · {len(out['blocked'])} blocked · {len(out['reasons'])} reasons")
PYEOF
rm -rf "$TMPD"
