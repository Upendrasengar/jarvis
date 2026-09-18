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

enable_meetings() {
  local root="$1" bin="$2"
  mkdir -p "$root/tools/call-capture/bin" \
    "$root/tools/call-capture/JarvisAudio.app/Contents/MacOS" "$root/models"
  : >"$root/tools/call-capture/bin/audiocap"
  : >"$root/tools/call-capture/bin/miccheck"
  : >"$root/tools/call-capture/JarvisAudio.app/Contents/MacOS/audiocap"
  : >"$root/models/ggml-base.bin"
  chmod +x "$root/tools/call-capture/bin/audiocap" "$root/tools/call-capture/bin/miccheck" \
    "$root/tools/call-capture/JarvisAudio.app/Contents/MacOS/audiocap"
  printf '#!/usr/bin/env bash\nexit 0\n' >"$bin/ffmpeg"
  printf '#!/usr/bin/env bash\nexit 0\n' >"$bin/whisper-cli"
  chmod +x "$bin/ffmpeg" "$bin/whisper-cli"
}

ROOT_ONE="$TMP/complete"
BIN_ONE="$TMP/bin-complete"
make_fixture "$ROOT_ONE" "$BIN_ONE"
PATH="$BIN_ONE:$PATH" JARVIS_DIR="$ROOT_ONE" JARVIS_ONBOARD_NAME="Test User" \
  JARVIS_ONBOARD_ROLE="Tester" JARVIS_ONBOARD_FOCUS="Reliable setup" \
  "$ENGINE/jarvis" onboard --profile core --non-interactive >"$TMP/first.txt"

STATE_ONE="$ROOT_ONE/memory/settings/onboarding.json"
node - "$STATE_ONE" <<'NODE'
const fs = require("fs");
const state = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
for (const [step, progress] of Object.entries(state.steps)) {
  if (progress.status !== "complete") throw new Error(`${step} was not completed`);
}
NODE
rg -q 'Test User' "$ROOT_ONE/memory/about-me.md"
[[ "$(<"$ROOT_ONE/memory/settings/installation-profile.txt")" == core ]]
rg -q 'Selected profile: Core' "$TMP/first.txt"
rg -q 'Core profile: meeting recording skipped' "$TMP/first.txt"
rg -q 'Onboarding complete' "$TMP/first.txt"
PATH="$BIN_ONE:$PATH" JARVIS_DIR="$ROOT_ONE" JARVIS_DOCTOR_SKIP_CLAUDE_PROBE=1 \
  "$ENGINE/jarvis" doctor --json >"$TMP/core-doctor.json"
node - "$TMP/core-doctor.json" <<'NODE'
const fs = require("fs");
const report = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (report.checks.find((check) => check.id === "installation-profile")?.status !== "pass") process.exit(1);
if (report.checks.find((check) => check.id === "telegram")?.status !== "optional") process.exit(2);
NODE

BEFORE="$(shasum -a 256 "$STATE_ONE" "$ROOT_ONE/memory/about-me.md")"
PATH="$BIN_ONE:$PATH" JARVIS_DIR="$ROOT_ONE" \
  "$ENGINE/jarvis" onboard --non-interactive >"$TMP/second.txt"
AFTER="$(shasum -a 256 "$STATE_ONE" "$ROOT_ONE/memory/about-me.md")"
[[ "$BEFORE" == "$AFTER" ]] || { echo "completed onboarding rewrote user state" >&2; exit 1; }
rg -q 'already complete' "$TMP/second.txt"

# A larger profile reopens only its newly relevant steps and preserves the
# local user profile.
enable_meetings "$ROOT_ONE" "$BIN_ONE"
PROFILE_BEFORE="$(shasum -a 256 "$ROOT_ONE/memory/about-me.md")"
PATH="$BIN_ONE:$PATH" JARVIS_DIR="$ROOT_ONE" \
  "$ENGINE/jarvis" onboard --profile meetings --non-interactive >"$TMP/upgrade.txt"
[[ "$(<"$ROOT_ONE/memory/settings/installation-profile.txt")" == meetings ]]
[[ "$PROFILE_BEFORE" == "$(shasum -a 256 "$ROOT_ONE/memory/about-me.md")" ]]
rg -q 'Selected profile: Meetings' "$TMP/upgrade.txt"
rg -q 'Resuming at: calendar' "$TMP/upgrade.txt"
rg -q 'Meeting transcription components are ready' "$TMP/upgrade.txt"

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

ROOT_FOUR="$TMP/full"
BIN_FOUR="$TMP/bin-full"
make_fixture "$ROOT_FOUR" "$BIN_FOUR"
enable_meetings "$ROOT_FOUR" "$BIN_FOUR"
printf '#!/usr/bin/env bash\nexit 0\n' >"$BIN_FOUR/obsidian"
chmod +x "$BIN_FOUR/obsidian"
mkdir -p "$ROOT_FOUR/secrets"
printf 'TELEGRAM_BOT_TOKEN=full-profile-secret-canary\nTELEGRAM_CHAT_ID=123\n' >"$ROOT_FOUR/secrets/.env"
PATH="$BIN_FOUR:$PATH" JARVIS_DIR="$ROOT_FOUR" JARVIS_ONBOARD_NAME="Full User" \
  "$ENGINE/jarvis" onboard --profile full --non-interactive >"$TMP/full.txt"
[[ "$(<"$ROOT_FOUR/memory/settings/installation-profile.txt")" == full ]]
rg -q 'Selected profile: Full' "$TMP/full.txt"
rg -q 'Obsidian is available' "$TMP/full.txt"
rg -q 'Telegram is configured' "$TMP/full.txt"
! rg -q 'full-profile-secret-canary' "$TMP/full.txt"

ROOT_FIVE="$TMP/meetings-missing"
BIN_FIVE="$TMP/bin-meetings-missing"
make_fixture "$ROOT_FIVE" "$BIN_FIVE"
set +e
PATH="$BIN_FIVE:$PATH" JARVIS_DIR="$ROOT_FIVE" JARVIS_ONBOARD_NAME="Meetings User" \
  "$ENGINE/jarvis" onboard --profile meetings --non-interactive >"$TMP/meetings-missing.txt" 2>&1
MISSING_STATUS=$?
set -e
[[ $MISSING_STATUS -eq 1 ]] || { echo "expected missing Meetings components to fail" >&2; exit 1; }
rg -q "Run 'jarvis setup'" "$TMP/meetings-missing.txt"

set +e
"$ENGINE/jarvis" onboard --profile impossible --non-interactive >"$TMP/invalid.txt" 2>&1
INVALID_STATUS=$?
set -e
[[ $INVALID_STATUS -eq 2 ]] || { echo "expected invalid profile exit 2" >&2; exit 1; }
rg -q 'invalid profile' "$TMP/invalid.txt"

echo "onboarding wizard contract: ok"
