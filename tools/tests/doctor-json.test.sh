#!/usr/bin/env bash
# Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
set -euo pipefail

# grep, not ripgrep: these tests are the evidence that Jarvis installs on a
# clean Mac, and ripgrep is not on a clean Mac. Depending on it meant the
# suites could not run on the very machines the support matrix promises.

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/jarvis-doctor-test.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

assert_json_contract() {
  local file="$1"
  node - "$file" <<'NODE'
const fs = require('fs');
const report = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (typeof report.ok !== 'boolean' || !Array.isArray(report.checks) || report.checks.length === 0) process.exit(1);
const allowed = new Set(['pass', 'warning', 'blocked', 'optional']);
for (const check of report.checks) {
  if (!check.id || !check.label || !allowed.has(check.status) || !check.message) process.exit(2);
  if (check.status !== 'pass' && !check.remediation) process.exit(3);
}
NODE
}

set +e
JARVIS_DIR="$TMP/empty-install" JARVIS_DOCTOR_SKIP_CLAUDE_PROBE=1 "$ROOT/jarvis" doctor --json >"$TMP/report.json" 2>"$TMP/report.err"
status=$?
set -e

[[ $status -eq 1 ]] || { echo "expected blocked doctor to exit 1, got $status" >&2; exit 1; }
[[ ! -e "$TMP/empty-install/memory" ]] || { echo "doctor mutated an empty installation" >&2; exit 1; }
assert_json_contract "$TMP/report.json"
node - "$TMP/report.json" <<'NODE'
const fs = require('fs');
const report = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (report.ok || !report.checks.some((check) => check.status === 'blocked')) process.exit(1);
NODE

mkdir -p "$TMP/empty-install/secrets"
printf 'CALENDAR_FEED_URL=jarvis-doctor-secret-canary\n' >"$TMP/empty-install/secrets/.env"
set +e
JARVIS_DIR="$TMP/empty-install" JARVIS_DOCTOR_SKIP_CLAUDE_PROBE=1 "$ROOT/jarvis" doctor --json >"$TMP/redacted.json" 2>"$TMP/redacted.err"
set -e
assert_json_contract "$TMP/redacted.json"
if grep -q 'jarvis-doctor-secret-canary' "$TMP/redacted.json" "$TMP/redacted.err"; then
  echo "doctor leaked a secret value" >&2
  exit 1
fi

# A configured installation may still have optional modules absent, but Core
# must report healthy. Stub only external identity/version commands; the
# doctor must never need to mutate this fixture.
CONFIGURED="$TMP/configured-install"
BIN="$TMP/bin"
mkdir -p "$BIN" "$CONFIGURED/node_modules" "$CONFIGURED/apps/web/dist" \
  "$CONFIGURED/memory/settings" "$CONFIGURED/secrets"
printf '#!/usr/bin/env bash\necho "Claude Code test"\n' >"$BIN/claude"
printf '#!/usr/bin/env bash\nexit 0\n' >"$BIN/pnpm"
chmod +x "$BIN/claude" "$BIN/pnpm"
printf 'CALENDAR_FEED_URL=jarvis-doctor-configured-secret\n' >"$CONFIGURED/secrets/.env"
PATH="$BIN:$PATH" JARVIS_DIR="$CONFIGURED" JARVIS_DOCTOR_SKIP_CLAUDE_PROBE=1 \
  "$ROOT/jarvis" doctor --json >"$TMP/configured.json"
assert_json_contract "$TMP/configured.json"
node - "$TMP/configured.json" <<'NODE'
const fs = require('fs');
const report = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (!report.ok || report.checks.some((check) => check.status === 'blocked')) process.exit(1);
NODE
! grep -q 'jarvis-doctor-configured-secret' "$TMP/configured.json"

JARVIS_DIR="$TMP/empty-install" JARVIS_DOCTOR_SKIP_CLAUDE_PROBE=1 "$ROOT/jarvis" doctor >"$TMP/human.txt" 2>&1 || true
grep -q '^Jarvis doctor$' "$TMP/human.txt"
grep -q '^── platform ──$' "$TMP/human.txt"
if node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$TMP/human.txt" 2>/dev/null; then
  echo "human output unexpectedly contained only JSON" >&2
  exit 1
fi

echo "doctor JSON contract: ok"
