#!/usr/bin/env bash
# Resumable first-run wizard. Secrets are configured later through Settings.
set -uo pipefail

ENGINE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="${JARVIS_DIR:-$ENGINE_DIR}"
STATE_TOOL="$ENGINE_DIR/tools/onboarding-state.mjs"
NON_INTERACTIVE=0

case "${1:-}" in
  "") ;;
  --non-interactive) NON_INTERACTIVE=1 ;;
  *) echo "usage: jarvis onboard [--non-interactive]" >&2; exit 2 ;;
esac

command -v node >/dev/null 2>&1 || {
  echo "Jarvis onboarding requires Node.js 20 or newer. Install Node, then rerun: jarvis onboard" >&2
  exit 1
}

on_interrupt() {
  printf '\nOnboarding paused. Resume with: jarvis onboard\n' >&2
  exit 130
}
trap on_interrupt INT TERM

state_json() { JARVIS_DIR="$DATA_DIR" node "$STATE_TOOL" status; }
next_step() {
  state_json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const n=JSON.parse(s).nextStep;process.stdout.write(n??"")})'
}
complete_step() { JARVIS_DIR="$DATA_DIR" node "$STATE_TOOL" complete "$1" >/dev/null; }
pause_after() {
  if [[ "${JARVIS_ONBOARD_STOP_AFTER:-}" == "$1" ]]; then on_interrupt; fi
}
ask_yes() {
  local prompt="$1" answer
  [[ $NON_INTERACTIVE -eq 1 ]] && return 1
  read -r -p "$prompt [y/N] " answer
  [[ "$answer" == [Yy]* ]]
}

doctor_report() {
  local destination="$1"
  JARVIS_DIR="$DATA_DIR" bash "$ENGINE_DIR/tools/doctor.sh" --json >"$destination" || true
}

doctor_status() {
  local report="$1" id="$2"
  node - "$report" "$id" <<'NODE'
const fs = require("fs");
const report = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
process.stdout.write(report.checks.find((check) => check.id === process.argv[3])?.status ?? "missing");
NODE
}

system_step() {
  local report="$1"
  echo "[1/8] Checking the Mac and Core dependencies..."
  if ! node - "$report" <<'NODE'
const fs = require("fs");
const report = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const blocked = report.checks.filter((check) => check.status === "blocked" && !check.id.startsWith("claude-"));
if (blocked.length) {
  for (const check of blocked) console.error(`  ✗ ${check.message}\n    → ${check.remediation}`);
  process.exit(1);
}
NODE
  then
    echo "Core prerequisites need attention. Repair them, then rerun: jarvis onboard" >&2
    return 1
  fi
  complete_step system
  echo "  ✓ Core prerequisites are ready"
}

claude_step() {
  local report="$1"
  echo "[2/8] Checking Claude Code..."
  if [[ "$(doctor_status "$report" claude-auth)" != pass ]]; then
    echo "  ✗ Claude Code is not authenticated." >&2
    echo "    Run 'claude', complete /login, then rerun: jarvis onboard" >&2
    return 1
  fi
  complete_step claude
  echo "  ✓ Claude Code is authenticated"
}

profile_configured() {
  local file="$DATA_DIR/memory/about-me.md"
  [[ -s "$file" ]] && grep -Eq '^[-] \*\*Name\*\*:[[:space:]]*[^[:space:]]' "$file"
}

profile_step() {
  local name role focus
  echo "[3/8] Configuring your local profile..."
  if profile_configured; then
    echo "  ✓ Existing profile preserved"
  else
    if [[ $NON_INTERACTIVE -eq 1 ]]; then
      name="${JARVIS_ONBOARD_NAME:-}"
      role="${JARVIS_ONBOARD_ROLE:-}"
      focus="${JARVIS_ONBOARD_FOCUS:-}"
      [[ -n "$name" ]] || { echo "JARVIS_ONBOARD_NAME is required in --non-interactive mode" >&2; return 1; }
    else
      read -r -p "Your name: " name
      [[ -n "$name" ]] || { echo "A name is required." >&2; return 1; }
      read -r -p "One line about your role: " role
      read -r -p "Current focus: " focus
    fi
    mkdir -p "$DATA_DIR/memory/settings" "$DATA_DIR/reports" "$DATA_DIR/brain" "$DATA_DIR/secrets" "$DATA_DIR/data"
    {
      printf '# About me\n\n'
      printf -- '- **Name**: %s\n' "$name"
      printf -- '- **Role / what I do**: %s\n' "$role"
      printf -- '- **Current focus**: %s\n' "$focus"
    } >"$DATA_DIR/memory/about-me.md"
    printf '%s\n' "$name" >"$DATA_DIR/memory/settings/owner.txt"
    echo "  ✓ Profile saved locally"
  fi
  complete_step profile
}

vault_step() {
  local target
  echo "[4/8] Optional unified vault..."
  if [[ -n "${JARVIS_VAULT:-}" || -s "$DATA_DIR/memory/settings/vault-dir.txt" ]]; then
    echo "  ✓ Vault already configured"
  elif ask_yes "Configure a unified Markdown/Obsidian vault now?"; then
    read -r -p "Vault path [~/Jarvis]: " target
    target="${target:-$HOME/Jarvis}"
    [[ "$DATA_DIR" == "$ENGINE_DIR" ]] || { echo "Vault migration requires the active Jarvis installation." >&2; return 1; }
    bash "$ENGINE_DIR/tools/migrate-vault.sh" "$target" || return 1
  else
    echo "  ○ Skipped — add later with: jarvis vault"
  fi
  complete_step vault
}

calendar_step() {
  local report="$1"
  echo "[5/8] Optional calendar feed..."
  if [[ "$(doctor_status "$report" calendar)" == pass ]]; then
    echo "  ✓ Calendar feed already configured"
  else
    echo "  ○ Skipped — after startup, open Settings → Calendar to add the URL"
  fi
  complete_step calendar
}

meetings_step() {
  local report="$1"
  echo "[6/8] Optional meeting recording..."
  if node - "$report" <<'NODE'
const fs = require("fs");
const report = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const ids = ["ffmpeg", "whisper-cli", "audiocap", "miccheck", "jarvis-audio", "whisper-model"];
process.exit(ids.every((id) => report.checks.find((check) => check.id === id)?.status === "pass") ? 0 : 1);
NODE
  then
    echo "  ✓ Meeting transcription components are ready"
  elif ask_yes "Install optional meeting recording components now?"; then
    [[ "$DATA_DIR" == "$ENGINE_DIR" ]] || { echo "Meeting setup requires the active Jarvis installation." >&2; return 1; }
    bash "$ENGINE_DIR/install.sh" || return 1
  else
    echo "  ○ Skipped — enable later with: jarvis setup"
  fi
  complete_step meetings
}

service_step() {
  local report="$1"
  echo "[7/8] Optional start at login..."
  if [[ "$(doctor_status "$report" login-service)" == pass ]]; then
    echo "  ✓ Login service is already installed"
  elif ask_yes "Start Jarvis automatically when you log in?"; then
    [[ "$DATA_DIR" == "$ENGINE_DIR" ]] || { echo "Service setup requires the active Jarvis installation." >&2; return 1; }
    bash "$ENGINE_DIR/tools/service.sh" install || return 1
  else
    echo "  ○ Skipped — enable later with: jarvis service install"
  fi
  complete_step service
}

healthy() {
  local port
  port="$(head -1 "$DATA_DIR/memory/settings/port.txt" 2>/dev/null | tr -cd '0-9')"; port="${port:-4321}"
  curl -fsS --max-time 3 "http://127.0.0.1:$port/api/health" 2>/dev/null \
    | grep -Eq '"ok"[[:space:]]*:[[:space:]]*true'
}

finish_step() {
  echo "[8/8] Starting Jarvis and verifying health..."
  if ! healthy; then
    [[ "$DATA_DIR" == "$ENGINE_DIR" ]] || { echo "Start verification requires the active Jarvis installation." >&2; return 1; }
    bash "$ENGINE_DIR/tools/services.sh" start || return 1
  fi
  healthy || { echo "Jarvis did not become healthy. Check reports/api.log, then rerun: jarvis onboard" >&2; return 1; }
  complete_step complete
  echo
  echo "✓ Onboarding complete — Jarvis is running and healthy."
}

TMP_REPORT="$(mktemp "${TMPDIR:-/tmp}/jarvis-onboard.XXXXXX")"
on_exit() {
  local status="$1"
  rm -f "$TMP_REPORT"
  if [[ $status -ne 0 && $status -ne 130 ]]; then
    echo "Onboarding paused. Repair the issue, then rerun: jarvis onboard" >&2
  fi
}
trap 'on_exit $?' EXIT

NEXT="$(next_step)" || exit 1
if [[ -z "$NEXT" ]]; then
  echo "Jarvis onboarding is already complete; verifying health..."
  if healthy; then echo "✓ Jarvis is healthy."; exit 0; fi
  [[ "$DATA_DIR" == "$ENGINE_DIR" ]] && bash "$ENGINE_DIR/tools/services.sh" start >/dev/null 2>&1 || true
  healthy && { echo "✓ Jarvis is healthy."; exit 0; }
  echo "Jarvis is not healthy. Run: jarvis start" >&2
  exit 1
fi

echo "Jarvis onboarding"
echo "Resuming at: $NEXT"
echo
doctor_report "$TMP_REPORT"

STEPS=(system claude profile vault calendar meetings service complete)
for step in "${STEPS[@]}"; do
  [[ "$(next_step)" == "$step" ]] || continue
  case "$step" in
    system) system_step "$TMP_REPORT" || exit 1 ;;
    claude) claude_step "$TMP_REPORT" || exit 1 ;;
    profile) profile_step || exit 1 ;;
    vault) vault_step || exit 1 ;;
    calendar) calendar_step "$TMP_REPORT" || exit 1 ;;
    meetings) meetings_step "$TMP_REPORT" || exit 1 ;;
    service) service_step "$TMP_REPORT" || exit 1 ;;
    complete) finish_step || exit 1 ;;
  esac
  pause_after "$step"
done
