#!/usr/bin/env bash
# Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
# triage-actions.sh — nightly attention pass over open action items.
# Sonnet ANNOTATES, never rewrites: items go in as data (stable ids), JSON
# comes back with clusters (same real-world task, incl. paraphrases),
# resolved deadlines (relative phrases anchored to the item's call date),
# blocked/blocking notes, and one-line reasons. Output: data/triage.json.
# Ranking itself is deterministic and lives in the UI — the LLM supplies
# only the judgement code can't.
set -uo pipefail
# Prefer an inherited JARVIS_DIR; fall back to this script's location.
# See tools/call-watch.sh for why: under Homebrew the engine is read-only in
# the cellar and symlinked into ~/.jarvis, so a caller reaching this by its
# real path would resolve data/ somewhere the server never writes.
JARVIS_DIR="${JARVIS_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

# Model routing is configurable in settings (memory/settings/model-*.txt).
# Falls back to the previous hardcoded tier when unset or unreadable, so an
# install that never touches settings behaves exactly as before.
jarvis_model() {   # $1 = role file stem, $2 = default
  local v
  v="$(head -1 "$JARVIS_DIR/memory/settings/$1.txt" 2>/dev/null | tr -d '[:space:]' | tr 'A-Z' 'a-z')"
  case "$v" in haiku|sonnet|opus) printf '%s' "$v" ;; *) printf '%s' "$2" ;; esac
}

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

# Evidence that an item may already be done.
#
# The ledger keeps every unchecked item until someone ticks it, which is the
# right default — an item that silently vanishes because a model guessed is
# worse than one that lingers. But nothing ever ARGUED for closure, so the
# list only grew, and a list that is mostly stale stops being read.
#
# So: hand the model the call notes written AFTER each item was raised, and
# let it point at the sentence where the work was reported done. It proposes;
# the owner still ticks the box.
source "$JARVIS_DIR/tools/paths.sh"
LATER="$(python3 - "$CALL_NOTES_DIR" <<'PYEOF'
import json, os, re, sys
d = sys.argv[1]
out = []
try:
    names = sorted(os.listdir(d), reverse=True)
except Exception:
    names = []
for n in names:
    m = re.match(r"call-notes-(\d{4}-\d{2}-\d{2})", n)
    if not m or not n.endswith(".md"):
        continue
    try:
        txt = open(os.path.join(d, n), encoding="utf-8").read()
    except Exception:
        continue
    # Phantom/silent calls carry no evidence of anything.
    if re.search(r"no speech detected", txt[:400], re.I):
        continue
    title = next((l.lstrip("# ").strip() for l in txt.splitlines() if l.startswith("# ")), n)
    out.append({"date": m.group(1), "title": title, "notes": txt[:1200]})
    # The open-items payload is already ~90KB. Adding 25 notes at 2500 chars
    # took the prompt past what the call would return anything for at all —
    # it came back empty and triage silently kept the previous file. Closure
    # evidence is overwhelmingly recent, so a short window costs little.
    if len(out) >= 12:
        break
print(json.dumps(out))
PYEOF
)"

# The prompt goes in on stdin, not as an argument.
#
# It is roughly 100KB — the open items alone are ~90KB — and passing that as
# argv silently lost the payload: the model replied "the array itself is
# missing" and triage wrote a file of empty fields over a good one. stdin has
# no such limit.
TMPD="$(mktemp -d)"
cat > "$TMPD/prompt.txt" <<PROMPT
Today is $TODAY. Below are my open action items from recorded calls and notes, as JSON (id, owner, text, source call title + date, recent comments).

Reply with ONLY a JSON object (no markdown fences, no prose):
{
 \"clusters\": [[\"id\",\"id\"],...],
 \"deadlines\": {\"id\": \"YYYY-MM-DD\"},
 \"blocked\": {\"id\": \"short note\"},
 \"reasons\": {\"id\": \"one short line why this needs attention now\"},
 \"resolved\": {\"id\": {\"date\": \"YYYY-MM-DD\", \"source\": \"call title\", \"quote\": \"verbatim sentence from that call's notes\"}}
}

Rules:
- clusters: group ids that describe the SAME real-world task (including paraphrases) across different sources. Only genuine duplicates; omit singletons.
- deadlines: only items whose text/comments imply a due date. Resolve relative phrases (\"by Thursday\", \"tonight\", \"end of September\") against the item's callDate. ISO dates only.
- blocked: items that are blocked/waiting on someone, or that BLOCK someone else's work — note who/what in <8 words.
- reasons: at most 10 items that genuinely need attention now; one tight line each. Not a summary — a 'why now'.
- resolved: items that a LATER call says were done. This is the one field that can remove work from my list, so it is held to a higher bar than the others:
  * The evidence must come from a call dated STRICTLY AFTER the item's own callDate. A task discussed twice in one meeting is not its own completion.
  * quote must be copied VERBATIM from that call's notes — not paraphrased, not stitched together. I have to be able to find it by searching. If you cannot quote it, leave the item out.
  * The quote must report the work as DONE ("sent", "shipped", "confirmed", "merged", "closed it out"), not planned, promised, or still in progress. "Will send tomorrow" is not done.
  * Omit anything you are unsure about. A missed closure costs one line in a list; a wrong one tells me something is finished when it is not.
- Reference items ONLY by their exact id. No invented ids, no rewritten text.

MY OPEN ITEMS:
$ITEMS

CALL NOTES WRITTEN SINCE (newest first) — the only place closure evidence may come from:
$LATER
PROMPT
# No tools. Everything it needs is in the prompt, and it returns JSON — there
# is nothing here that should be able to touch a file. process-call.sh has
# always been locked down this way; the digest was not, and 282 action items
# across 56 notes were flipped to done in bulk on 2026-09-19.
RAW="$(claude -p --model "$(jarvis_model model-worker sonnet)" \
  --disallowedTools="Bash,Read,Edit,Write,Grep,Glob,WebFetch,WebSearch,Task,NotebookEdit" \
  < "$TMPD/prompt.txt" 2>/dev/null)"

printf '%s' "$ITEMS" > "$TMPD/items.json"
printf '%s' "$RAW" > "$TMPD/raw.txt"
printf '%s' "$LATER" > "$TMPD/later.json"
python3 - "$OUT" "$TODAY" "$TMPD/items.json" "$TMPD/raw.txt" "$TMPD/later.json" <<'PYEOF'
import json, re, sys
out_path, today, items_path, raw_path, later_path = sys.argv[1:6]
raw = open(raw_path).read().strip()
raw = re.sub(r"^```(json)?\s*|\s*```$", "", raw, flags=re.M).strip()
if not raw:
    print("[triage] the model returned nothing — prompt may be too large; keeping previous triage")
    sys.exit(0)
try:
    d = json.loads(raw)
except Exception as e:
    print(f"[triage] LLM output unparseable ({e}) — keeping previous triage")
    print(f"[triage] first 120 chars: {raw[:120]!r}")
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

# A proposed closure is checked, not taken. This is the only field that can
# make work disappear from the ledger, and the whole point is that the owner
# can audit it — so a quote that is not actually in the cited notes, or
# evidence dated before the item existed, is dropped rather than shown.
items = {i["id"]: i for i in json.load(open(items_path))}
try:
    later = json.load(open(later_path))
except Exception:
    later = []
notes_by_date = {}
for n in later:
    notes_by_date.setdefault(n.get("date", ""), []).append(n)

def norm(t):
    return re.sub(r"\s+", " ", str(t or "")).strip().lower()

resolved, rejected = {}, 0
for k, v in (d.get("resolved") or {}).items():
    if k not in items or not isinstance(v, dict):
        rejected += 1; continue
    date, quote = str(v.get("date", "")), str(v.get("quote", "")).strip()
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", date) or len(quote) < 12:
        rejected += 1; continue
    # strictly after the item was raised
    if date <= str(items[k].get("callDate", "")):
        rejected += 1; continue
    # and the sentence must genuinely appear in that day's notes
    hay = " ".join(norm(n.get("notes")) for n in notes_by_date.get(date, []))
    if norm(quote) not in hay:
        rejected += 1; continue
    resolved[k] = {"date": date, "source": str(v.get("source", ""))[:80], "quote": quote[:300]}
out["resolved"] = resolved
out["resolvedRejected"] = rejected
with open(out_path, "w") as f:
    json.dump(out, f, indent=1)
print(f"[triage] {len(out['clusters'])} clusters · {len(out['deadlines'])} deadlines · "
      f"{len(out['blocked'])} blocked · {len(out['reasons'])} reasons · "
      f"{len(out['resolved'])} look done"
      + (f" ({rejected} unverifiable, dropped)" if rejected else ""))
PYEOF
rm -rf "$TMPD"
