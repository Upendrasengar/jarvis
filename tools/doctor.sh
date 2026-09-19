#!/usr/bin/env bash
# Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
# Read-only Jarvis health report. Keep this script safe to run on any install.
set -uo pipefail

ROOT="${JARVIS_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
JSON=0
[[ "${1:-}" == "--json" ]] && JSON=1

IDS=() LABELS=() SECTIONS=() STATUSES=() MESSAGES=() REMEDIATIONS=()
BLOCKED=0

add_check() {
  IDS+=("$1"); LABELS+=("$2"); SECTIONS+=("$3"); STATUSES+=("$4")
  MESSAGES+=("$5"); REMEDIATIONS+=("$6")
  [[ "$4" == "blocked" ]] && BLOCKED=1
}

has_nonempty_secret() {
  local key="$1" file="$ROOT/secrets/.env"
  [[ -f "$file" ]] && grep -Eq "^[[:space:]]*${key}=[[:space:]]*[^[:space:]#]" "$file"
}

# Platform
if [[ "$(uname -s 2>/dev/null)" == "Darwin" ]]; then
  add_check platform "macOS" platform pass "macOS detected" ""
else
  add_check platform "macOS" platform blocked "Jarvis requires macOS" "Install Jarvis on a supported Mac."
fi

# Core dependencies
# Present is not the same as working. A binary that aborts on a missing dylib
# satisfies `command -v` perfectly, and this reported "Claude CLI installed" as
# a pass on a Mac where every invocation died in dyld — then contradicted
# itself one check later.
if command -v claude >/dev/null 2>&1 && ! claude --version >/dev/null 2>&1; then
  add_check claude-cli "Claude CLI" "core dependencies" blocked     "Claude CLI is installed but will not start"     "Run 'claude --version' to see the error. A crash here usually means a broken Homebrew install — try 'brew doctor' and reinstall Claude Code."
elif command -v claude >/dev/null 2>&1; then
  CLAUDE_VERSION="$(claude --version 2>/dev/null | head -1)"
  add_check claude-cli "Claude CLI" "core dependencies" pass "Claude CLI installed${CLAUDE_VERSION:+ ($CLAUDE_VERSION)}" ""
  if [[ "${JARVIS_DOCTOR_SKIP_CLAUDE_PROBE:-0}" == "1" ]]; then
    add_check claude-auth "Claude login" "core dependencies" warning "Claude login probe skipped" "Run 'claude' and confirm it responds."
  else
    PROBE="$(mktemp "${TMPDIR:-/tmp}/jarvis-doctor.XXXXXX")"
    (claude -p --model haiku "Reply with exactly: OK" >"$PROBE" 2>&1) & PROBE_PID=$!
    elapsed=0
    while kill -0 "$PROBE_PID" 2>/dev/null && [[ $elapsed -lt 10 ]]; do sleep 1; elapsed=$((elapsed + 1)); done
    if kill -0 "$PROBE_PID" 2>/dev/null; then
      kill "$PROBE_PID" 2>/dev/null || true
      wait "$PROBE_PID" 2>/dev/null || true
      add_check claude-auth "Claude login" "core dependencies" blocked "Claude CLI did not respond within 10 seconds" "Run 'claude' in a terminal and complete login."
    else
      wait "$PROBE_PID" 2>/dev/null || true
      if grep -qi 'OK' "$PROBE"; then
        add_check claude-auth "Claude login" "core dependencies" pass "Claude CLI is logged in and responding" ""
      else
        add_check claude-auth "Claude login" "core dependencies" blocked "Claude CLI is installed but did not complete the probe" "Run 'claude' in a terminal and complete login."
      fi
    fi
    rm -f "$PROBE"
  fi
else
  add_check claude-cli "Claude CLI" "core dependencies" blocked "Claude CLI is not installed" "Install Claude Code from https://claude.com/claude-code, then run 'claude' to log in."
fi

# Report the Node that Jarvis will ACTUALLY run, not whatever is first on
# PATH. A published engine carries its own interpreter, so doctor was naming a
# version — "Node.js v26.8.2" — that nothing would ever load the server with.
#
# Same precedence as tools/services.sh, and it has to stay that way: if these
# two disagree, doctor blesses one runtime while the server boots another,
# which is how a green report accompanies a dlopen failure.
NODE_SRC=""
if [ -n "${JARVIS_NODE:-}" ] && [ -x "${JARVIS_NODE}" ]; then
  NODE_EXE="$JARVIS_NODE"; NODE_SRC="JARVIS_NODE"
elif [ -x "$ROOT/runtime/node" ]; then
  NODE_EXE="$ROOT/runtime/node"; NODE_SRC="bundled with the engine"
else
  PINNED="$(head -1 "$ROOT/memory/settings/node-bin.txt" 2>/dev/null | tr -d '[:space:]')"
  if [ -n "$PINNED" ] && [ -x "$PINNED" ]; then
    NODE_EXE="$PINNED"; NODE_SRC="memory/settings/node-bin.txt"
  elif command -v node >/dev/null 2>&1; then
    NODE_EXE="$(command -v node)"; NODE_SRC="PATH"
  else
    NODE_EXE=""
  fi
fi

if [ -n "$NODE_EXE" ]; then
  NODE_VERSION="$("$NODE_EXE" --version 2>/dev/null)"
  NODE_MODULES_ABI="$("$NODE_EXE" -p 'process.versions.modules' 2>/dev/null || echo "")"
  NODE_MAJOR="${NODE_VERSION#v}"; NODE_MAJOR="${NODE_MAJOR%%.*}"
  # The artifact records the ABI its native modules were compiled for. A
  # mismatch is not a warning sign, it is a guaranteed crash at better-sqlite3's
  # dlopen — so check the two against each other rather than trusting a version.
  WANT_ABI="$(sed -n 's/.*"nodeAbi"[[:space:]]*:[[:space:]]*"\([0-9]*\)".*/\1/p' "$ROOT/artifact.json" 2>/dev/null | head -1)"
  if [ -n "$WANT_ABI" ] && [ -n "$NODE_MODULES_ABI" ] && [ "$WANT_ABI" != "$NODE_MODULES_ABI" ]; then
    add_check node "Node.js" "core dependencies" blocked       "Node.js $NODE_VERSION ($NODE_SRC) is ABI $NODE_MODULES_ABI, but this engine's native modules need ABI $WANT_ABI"       "Point Jarvis at the matching Node: set JARVIS_NODE, or reinstall so the bundled runtime is used."
  elif [[ "$NODE_MAJOR" =~ ^[0-9]+$ ]] && [[ "$NODE_MAJOR" -ge 20 ]]; then
    add_check node "Node.js" "core dependencies" pass "Node.js $NODE_VERSION ($NODE_SRC)" ""
  else
    add_check node "Node.js" "core dependencies" blocked "Node.js 20 or newer is required (found ${NODE_VERSION:-unknown}, $NODE_SRC)" "Install Node.js 20 or newer with Homebrew."
  fi
else
  add_check node "Node.js" "core dependencies" blocked "Node.js 20 or newer is not installed" "Install Node.js 20 or newer with Homebrew, or reinstall Jarvis so it brings its own."
fi

if command -v pnpm >/dev/null 2>&1; then
  add_check pnpm "pnpm" "core dependencies" pass "pnpm is installed" ""
else
  add_check pnpm "pnpm" "core dependencies" blocked "pnpm is not installed" "Run 'npm install -g pnpm'."
fi

# Homebrew renamed whisper-cpp to whisper.cpp; the old name still resolves via
# oldnames, but printing a deprecated name in a remediation someone is meant to
# copy is how instructions rot.
for spec in "ffmpeg|FFmpeg|brew install ffmpeg" "whisper-cli|Whisper CLI|brew install whisper.cpp"; do
  IFS='|' read -r command label remediation <<<"$spec"
  if command -v "$command" >/dev/null 2>&1; then
    add_check "$command" "$label" "meetings (optional)" pass "$label installed" ""
  else
    add_check "$command" "$label" "meetings (optional)" optional "$label is not installed; call transcription is unavailable" "Run '$remediation' to enable meeting transcription."
  fi
done

if command -v python3 >/dev/null 2>&1; then
  add_check python3 "Python 3" "core dependencies" pass "Python 3 installed" ""
else
  add_check python3 "Python 3" "core dependencies" warning "Python 3 is not installed" "Install Python 3 with Homebrew for maintenance tools."
fi

# Optional native meeting helpers
for spec in "audiocap|Audio capture helper|tools/call-capture/bin/audiocap" "miccheck|Microphone helper|tools/call-capture/bin/miccheck" "jarvis-audio|JarvisAudio.app|tools/call-capture/JarvisAudio.app/Contents/MacOS/audiocap" "jarvis-bar|JarvisBar.app|tools/menubar/JarvisBar.app/Contents/MacOS/jarvisbar"; do
  IFS='|' read -r id label relative <<<"$spec"
  if [[ -x "$ROOT/$relative" ]]; then
    add_check "$id" "$label" "native helpers (optional)" pass "$label is built" ""
  else
    add_check "$id" "$label" "native helpers (optional)" optional "$label is not built" "Run 'jarvis setup' to build optional native helpers."
  fi
done
# Signing identity. Ad-hoc signing carries no identity, so macOS binds
# recording grants to the exact binary hash and every rebuild silently revokes
# them. This machine lost system audio on two calls and its own microphone on
# eight before anyone noticed, so it earns a check of its own.
if [[ -d "$ROOT/tools/menubar/JarvisBar.app" || -d "$ROOT/tools/call-capture/JarvisAudio.app" ]]; then
  SIGN_WANT="$(head -1 "$ROOT/memory/settings/signing-identity.txt" 2>/dev/null | tr -d '\n')"
  SIGN_APP="$ROOT/tools/call-capture/JarvisAudio.app"
  [[ -d "$SIGN_APP" ]] || SIGN_APP="$ROOT/tools/menubar/JarvisBar.app"
  # codesign reports these two cases under DIFFERENT keys: an ad-hoc bundle
  # prints "Signature=adhoc", a real one prints "Signature size=1699" plus an
  # "Authority=" line. Parsing only "Signature=" therefore read every properly
  # signed app as unsigned — this check called a bundle unsigned moments after
  # signing it. Authority is the reliable signal.
  SIGN_AUTH="$(codesign -dvvv "$SIGN_APP" 2>&1 | sed -n 's/^Authority=//p' | head -1)"
  SIGN_KIND="$(codesign -dv "$SIGN_APP" 2>&1 | sed -n 's/^Signature=//p' | head -1)"
  [[ -n "$SIGN_AUTH" ]] && SIGN_KIND="$SIGN_AUTH"
  if [[ "$SIGN_KIND" == "adhoc" ]]; then
    add_check signing-identity "Signing identity" "meetings (optional)" warning \
      "Native apps are signed ad-hoc, so macOS recording permissions reset on every rebuild" \
      "Run 'jarvis sign create', then 'jarvis setup', and re-grant recording once."
  elif [[ -n "$SIGN_KIND" ]]; then
    add_check signing-identity "Signing identity" "meetings (optional)" pass \
      "Native apps carry a stable signature${SIGN_AUTH:+ ($SIGN_AUTH)}" ""
  else
    add_check signing-identity "Signing identity" "meetings (optional)" warning \
      "Native apps are unsigned" "Run 'jarvis sign create', then 'jarvis setup'."
  fi
fi

if [[ -x "$ROOT/tools/call-capture/JarvisAudio.app/Contents/MacOS/audiocap" ]]; then
  # Ask the app rather than assume. Inference is exactly what failed here
  # before: TCC answered "granted" while the recorder wrote silence.
  PERM_FILE="$(mktemp)"
  open -n -g -a "$ROOT/tools/call-capture/JarvisAudio.app" --args --check "$PERM_FILE" 2>/dev/null || true
  PERM_I=0
  while [[ $PERM_I -lt 16 && ! -s "$PERM_FILE" ]]; do sleep 0.25; PERM_I=$((PERM_I+1)); done
  PERM_MIC="$(sed -n 's/^microphone: //p' "$PERM_FILE" 2>/dev/null | head -1)"
  PERM_SCR="$(sed -n 's/^screen-recording: //p' "$PERM_FILE" 2>/dev/null | head -1)"
  rm -f "$PERM_FILE"
  case "${PERM_MIC:-unknown}" in
    granted) add_check permission-microphone "Microphone" "meetings (optional)" pass "Microphone granted to Jarvis Audio" "" ;;
    not-determined) add_check permission-microphone "Microphone" "meetings (optional)" optional "Microphone has not been requested yet" "Grant it in System Settings > Privacy & Security > Microphone, or start a recording." ;;
    denied) add_check permission-microphone "Microphone" "meetings (optional)" warning "Microphone denied - your side of calls records silence" "System Settings > Privacy & Security > Microphone > enable Jarvis Audio." ;;
    *) add_check permission-microphone "Microphone" "meetings (optional)" warning "Microphone state could not be read" "Run 'jarvis setup' and grant Microphone when prompted." ;;
  esac
  case "${PERM_SCR:-unknown}" in
    granted) add_check permission-screen "Screen and system audio" "meetings (optional)" pass "Screen recording granted to Jarvis Audio" "" ;;
    denied) add_check permission-screen "Screen and system audio" "meetings (optional)" warning "Screen recording denied or never requested - the other side of calls is not captured" "System Settings > Privacy & Security > Screen & System Audio Recording > enable Jarvis Audio." ;;
    *) add_check permission-screen "Screen and system audio" "meetings (optional)" warning "Screen recording state could not be read" "Run 'jarvis setup' and grant Screen Recording when prompted." ;;
  esac
else
  add_check recording-permissions "Recording permissions" "meetings (optional)" optional "Recording permissions are not needed until JarvisAudio.app is built" "Run 'jarvis setup', then grant Microphone and Screen Recording when prompted."
fi

# Obsidian is not just a viewer here. Workers are told to reach for the
# `obsidian` CLI FIRST for vault lookups (see OBSIDIAN_CLI_LINES in
# services/agents.ts): indexed full-text search, backlinks, and tag inventory,
# all of which understand frontmatter and wikilinks. tools/vault-search.sh is
# the fallback, and it is plain keyword grep — it cannot answer "what links to
# [[X]]" at all.
#
# So this check is tri-state. The CLI also needs the Obsidian APP to be
# running, which is the state most likely to be true one minute and false the
# next, and the one that silently downgrades every recall answer.
if command -v obsidian >/dev/null 2>&1 || [[ -x /Applications/Obsidian.app/Contents/MacOS/obsidian-cli ]]; then
  if pgrep -x Obsidian >/dev/null 2>&1; then
    add_check obsidian "Obsidian" "integrations (optional)" pass       "Obsidian CLI is available and the app is running — indexed search, backlinks and tags are in use" ""
  else
    add_check obsidian "Obsidian" "integrations (optional)" warning       "Obsidian CLI is installed but the app is not running — recall falls back to keyword grep, with no backlinks or tag queries"       "Open Obsidian. The CLI talks to the running app; with it closed the index is unreachable."
  fi
else
  add_check obsidian "Obsidian" "integrations (optional)" optional     "Obsidian is not installed — recall uses keyword grep only, losing indexed search, backlinks and tag inventory"     "Run 'brew install --cask obsidian' and open it. Your notes stay plain Markdown either way."
fi

if compgen -G "$ROOT/models/ggml-*.bin" >/dev/null 2>&1; then
  add_check whisper-model "Whisper model" "meetings (optional)" pass "A local Whisper model is present" ""
else
  add_check whisper-model "Whisper model" "meetings (optional)" optional "No local Whisper model is present" "Run 'jarvis model base' to enable local transcription."
fi

# Workspace and local configuration
if [[ -d "$ROOT/node_modules" || -L "$ROOT/node_modules" ]]; then
  add_check workspace-deps "Workspace dependencies" "JS workspace" pass "Workspace dependencies are installed" ""
else
  add_check workspace-deps "Workspace dependencies" "JS workspace" blocked "Workspace dependencies are missing" "Run 'jarvis setup'."
fi
if [[ -d "$ROOT/apps/web/dist" ]]; then
  add_check web-build "Web app" "JS workspace" pass "Production web assets are built" ""
else
  add_check web-build "Web app" "JS workspace" blocked "Production web assets are missing" "Run 'jarvis setup'."
fi

VAULT_POINTER="$ROOT/memory/settings/vault-dir.txt"
if [[ -n "${JARVIS_VAULT:-}" || -s "$VAULT_POINTER" ]]; then
  add_check vault "Vault" configuration pass "A vault location is configured" ""
else
  add_check vault "Vault" configuration optional "No unified vault is configured; legacy storage remains active" "Run 'jarvis vault' to configure a unified vault."
fi
if has_nonempty_secret CALENDAR_FEED_URL; then
  add_check calendar "Calendar feed" configuration pass "A calendar feed URL is configured" ""
else
  add_check calendar "Calendar feed" configuration optional "No calendar feed URL is configured" "Open Jarvis Settings to add a calendar feed URL."
fi
PROFILE="$(head -1 "$ROOT/memory/settings/installation-profile.txt" 2>/dev/null | tr -d '[:space:]')"
case "$PROFILE" in
  core|meetings|full) add_check installation-profile "Installation profile" configuration pass "The ${PROFILE} installation profile is selected" "" ;;
  "") add_check installation-profile "Installation profile" configuration optional "No installation profile is selected" "Run 'jarvis onboard --profile core'." ;;
  *) add_check installation-profile "Installation profile" configuration warning "The installation profile setting is invalid" "Run 'jarvis onboard --profile core|meetings|full'." ;;
esac
if has_nonempty_secret TELEGRAM_BOT_TOKEN && has_nonempty_secret TELEGRAM_CHAT_ID; then
  add_check telegram "Telegram" "integrations (optional)" pass "Telegram is configured" ""
else
  add_check telegram "Telegram" "integrations (optional)" optional "Telegram is not configured" "Run 'jarvis telegram' to connect it."
fi

PORT="$(head -1 "$ROOT/memory/settings/port.txt" 2>/dev/null || true)"; PORT="${PORT:-4321}"
if command -v curl >/dev/null 2>&1 && curl -fsS --max-time 2 "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
  add_check server-health "Local server" runtime pass "Jarvis is healthy on port $PORT" ""
else
  add_check server-health "Local server" runtime warning "Jarvis is not responding on port $PORT" "Run 'jarvis start'."
fi
if launchctl print "gui/$(id -u)/com.jarvis" >/dev/null 2>&1; then
  add_check login-service "Login service" runtime pass "The Jarvis login service is loaded" ""
else
  add_check login-service "Login service" runtime optional "The Jarvis login service is not loaded" "Run 'jarvis service install' to start Jarvis at login."
fi

json_escape() {
  local value="$1"
  value="${value//\\/\\\\}"; value="${value//\"/\\\"}"
  value="${value//$'\n'/\\n}"; value="${value//$'\r'/\\r}"; value="${value//$'\t'/\\t}"
  printf '%s' "$value"
}

if [[ $JSON -eq 1 ]]; then
  [[ $BLOCKED -eq 0 ]] && overall=true || overall=false
  printf '{"ok":%s,"checks":[' "$overall"
  for ((i=0; i<${#IDS[@]}; i++)); do
    [[ $i -gt 0 ]] && printf ','
    printf '{"id":"%s","label":"%s","section":"%s","status":"%s","message":"%s","remediation":"%s"}' \
      "$(json_escape "${IDS[$i]}")" "$(json_escape "${LABELS[$i]}")" \
      "$(json_escape "${SECTIONS[$i]}")" "${STATUSES[$i]}" \
      "$(json_escape "${MESSAGES[$i]}")" "$(json_escape "${REMEDIATIONS[$i]}")"
  done
  printf ']}\n'
else
  printf 'Jarvis doctor\n\n'
  current=""
  for ((i=0; i<${#IDS[@]}; i++)); do
    if [[ "${SECTIONS[$i]}" != "$current" ]]; then
      current="${SECTIONS[$i]}"; printf '── %s ──\n' "$current"
    fi
    case "${STATUSES[$i]}" in
      pass) symbol='✓' ;; blocked) symbol='✗' ;; warning) symbol='!' ;; optional) symbol='○' ;;
    esac
    printf '  %s %s\n' "$symbol" "${MESSAGES[$i]}"
    [[ "${STATUSES[$i]}" != pass ]] && printf '    → %s\n' "${REMEDIATIONS[$i]}"
  done
  printf '\n'
  if [[ $BLOCKED -eq 1 ]]; then printf 'Some core items need attention (✗ above).\n'; else printf 'Core is ready. Start Jarvis: ./jarvis start\n'; fi
fi

[[ $BLOCKED -eq 0 ]]
