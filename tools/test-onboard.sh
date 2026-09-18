#!/usr/bin/env bash
set -euo pipefail

ENGINE="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/jarvis-onboard-test.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

make_fixture() {
  local root="$1" bin="$2"
  mkdir -p "$root/node_modules" "$root/apps/web/dist" "$root/memory/settings" "$bin"
  printf '#!/usr/bin/env bash\nif [[ "${1:-}" == "--version" ]]; then echo "Claude Code test"; else echo OK; fi\n' >"$bin/claude"
  printf '#!/usr/bin/env bash\nexit 0\n' >"$bin/pnpm"
  printf '#!/usr/bin/env bash\necho '\''{"ok":true}'\''\n' >"$bin/curl"
  chmod +x "$bin/claude" "$bin/pnpm" "$bin/curl"
}

ROOT_ONE="$TMP/complete"
BIN_ONE="$TMP/bin-complete"
make_fixture "$ROOT_ONE" "$BIN_ONE"
PATH="$BIN_ONE:$PATH" JARVIS_DIR="$ROOT_ONE" JARVIS_ONBOARD_NAME="Test User" \
  JARVIS_ONBOARD_ROLE="Tester" JARVIS_ONBOARD_FOCUS="Reliable setup" \
  "$ENGINE/jarvis" onboard --non-interactive >"$TMP/first.txt"

STATE_ONE="$ROOT_ONE/memory/settings/onboarding.json"
node - "$STATE_ONE" <<'NODE'
const fs = require("fs");
const state = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
for (const [step, progress] of Object.entries(state.steps)) {
  if (progress.status !== "complete") throw new Error(`${step} was not completed`);
}
NODE
rg -q 'Test User' "$ROOT_ONE/memory/about-me.md"
rg -q 'Onboarding complete' "$TMP/first.txt"

BEFORE="$(shasum -a 256 "$STATE_ONE" "$ROOT_ONE/memory/about-me.md")"
PATH="$BIN_ONE:$PATH" JARVIS_DIR="$ROOT_ONE" \
  "$ENGINE/jarvis" onboard --non-interactive >"$TMP/second.txt"
AFTER="$(shasum -a 256 "$STATE_ONE" "$ROOT_ONE/memory/about-me.md")"
[[ "$BEFORE" == "$AFTER" ]] || { echo "completed onboarding rewrote user state" >&2; exit 1; }
rg -q 'already complete' "$TMP/second.txt"

ROOT_TWO="$TMP/interrupted"
BIN_TWO="$TMP/bin-interrupted"
make_fixture "$ROOT_TWO" "$BIN_TWO"
set +e
PATH="$BIN_TWO:$PATH" JARVIS_DIR="$ROOT_TWO" JARVIS_ONBOARD_NAME="Resume User" \
  JARVIS_ONBOARD_STOP_AFTER=profile \
  "$ENGINE/jarvis" onboard --non-interactive >"$TMP/interrupted.txt" 2>&1
INTERRUPTED_STATUS=$?
set -e
[[ $INTERRUPTED_STATUS -eq 130 ]] || { echo "expected interruption exit 130, got $INTERRUPTED_STATUS" >&2; exit 1; }
NEXT="$(JARVIS_DIR="$ROOT_TWO" node "$ENGINE/tools/onboarding-state.mjs" status \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).nextStep))')"
[[ "$NEXT" == "vault" ]] || { echo "expected resume at vault, got $NEXT" >&2; exit 1; }

PATH="$BIN_TWO:$PATH" JARVIS_DIR="$ROOT_TWO" \
  "$ENGINE/jarvis" onboard --non-interactive >"$TMP/resumed.txt"
rg -q 'Resuming at: vault' "$TMP/resumed.txt"
rg -q 'Onboarding complete' "$TMP/resumed.txt"

ROOT_THREE="$TMP/claude-blocked"
BIN_THREE="$TMP/bin-claude-blocked"
make_fixture "$ROOT_THREE" "$BIN_THREE"
printf '#!/usr/bin/env bash\nif [[ "${1:-}" == "--version" ]]; then echo "Claude Code test"; else echo "Not logged in"; exit 1; fi\n' >"$BIN_THREE/claude"
chmod +x "$BIN_THREE/claude"
set +e
PATH="$BIN_THREE:$PATH" JARVIS_DIR="$ROOT_THREE" JARVIS_ONBOARD_NAME="Blocked User" \
  "$ENGINE/jarvis" onboard --non-interactive \
  >"$TMP/blocked.txt" 2>&1
BLOCKED_STATUS=$?
set -e
[[ $BLOCKED_STATUS -eq 1 ]] || { echo "expected Claude failure, got $BLOCKED_STATUS" >&2; exit 1; }
BLOCKED_NEXT="$(JARVIS_DIR="$ROOT_THREE" node "$ENGINE/tools/onboarding-state.mjs" status \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).nextStep))')"
[[ "$BLOCKED_NEXT" == "claude" ]] || { echo "expected blocked resume at claude, got $BLOCKED_NEXT" >&2; exit 1; }
rg -q 'complete /login' "$TMP/blocked.txt"
rg -q 'rerun: jarvis onboard' "$TMP/blocked.txt"

echo "onboarding wizard contract: ok"
