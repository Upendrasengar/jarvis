#!/usr/bin/env bash
# Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
# install.sh — set up Jarvis on a fresh Mac.
#   ./install.sh          full setup: check deps, build audio helpers,
#                         download a whisper model, install JS deps, build UI
#   ./install.sh --check  doctor mode: report what's missing, change nothing
set -uo pipefail
cd "$(dirname "$0")" || exit 1
CHECK_ONLY=0
if [[ "${1:-}" == "--check" ]]; then
  shift
  exec bash tools/doctor.sh "$@"
fi

ok()   { printf "  \033[32m✓\033[0m %s\n" "$1"; }
bad()  { printf "  \033[31m✗\033[0m %s\n" "$1"; MISSING=1; }
warn() { printf "  \033[33m!\033[0m %s\n" "$1"; }
MISSING=0

echo "Jarvis $( [[ $CHECK_ONLY == 1 ]] && echo doctor || echo installer )"
echo
echo "── platform ──"
[[ "$(uname)" == "Darwin" ]] && ok "macOS" || bad "macOS required (call recording uses ScreenCaptureKit/CoreAudio)"

# Ask a tool for its version, and treat "installed but will not start" as the
# failure it is. `command -v` is satisfied by a binary that aborts on a missing
# dylib — which is how this printed "✓ claude CLI ()" and then contradicted
# itself on the next line, under a screenful of dyld output.
#   returns 0 = usable (version on stdout), 1 = present but broken, 2 = absent
probe_version() {
  local bin="$1"; shift
  command -v "$bin" >/dev/null 2>&1 || return 2
  local out
  out="$("$bin" "$@" 2>/dev/null | head -1 | tr -d '\r')" || return 1
  [ -n "$out" ] || return 1
  printf '%s' "$out"
}
broken() {   # $1 = label, $2 = how to see the real error
  bad "$1 is installed but will not start — run: $2"
}

echo "── core dependencies ──"
if CLAUDE_V="$(probe_version claude --version)"; then
  ok "claude CLI ($CLAUDE_V)"
  # is it actually logged in? a dead CLI is the #1 cause of silent chat failure
  PROBE_OUT="$(mktemp)"
  ( claude -p --model haiku "Reply with exactly: OK" > "$PROBE_OUT" 2>&1 ) & PROBE_PID=$!
  for _ in $(seq 1 30); do kill -0 $PROBE_PID 2>/dev/null || break; sleep 1; done
  if kill -0 $PROBE_PID 2>/dev/null; then kill -9 $PROBE_PID 2>/dev/null; bad "claude CLI unresponsive after 30s — check your login: run \`claude\` in a terminal"
  elif grep -qi "OK" "$PROBE_OUT"; then ok "claude CLI logged in and responding"
  else bad "claude CLI present but NOT working — run \`claude\` in a terminal to log in ($(tail -1 "$PROBE_OUT" | cut -c1-60))"; fi
  rm -f "$PROBE_OUT"
elif [ $? = 1 ]; then broken "claude CLI" "claude --version"
else bad "claude CLI — install Claude Code (https://claude.com/claude-code) and log in"; fi

if NODE_V="$(probe_version node --version)"; then
  nmaj="${NODE_V#v}"; nmaj="${nmaj%%.*}"
  if [[ "$nmaj" =~ ^[0-9]+$ ]] && [ "$nmaj" -ge 20 ]; then ok "node $NODE_V"
  else bad "node >= 20 (found $NODE_V)"; fi
elif [ $? = 1 ]; then broken "node" "node --version"
else bad "node >= 20"; fi

if PNPM_V="$(probe_version pnpm --version)"; then ok "pnpm $PNPM_V"
elif [ $? = 1 ]; then broken "pnpm" "pnpm --version"
else bad "pnpm — npm i -g pnpm"; fi

# Optional from here: meetings only. Absent is a normal state, not a problem.
if FFMPEG_V="$(probe_version ffmpeg -version)"; then ok "ffmpeg"
elif [ $? = 1 ]; then broken "ffmpeg" "ffmpeg -version"
else bad "ffmpeg — brew install ffmpeg"; fi

command -v whisper-cli >/dev/null 2>&1 && ok "whisper-cli" || bad "whisper-cli — brew install whisper.cpp"

if PY_V="$(probe_version python3 --version)"; then ok "python3"
elif [ $? = 1 ]; then broken "python3" "python3 --version"
else bad "python3"; fi

# ── signing identity ───────────────────────────────────────────────────────
# Resolved BEFORE anything is built, because the two build steps below sign
# with it. It used to be resolved further down, AFTER those steps: under
# `set -u` that aborts a fresh install on an unbound SIGN_ID, and the only
# reason nobody hit it is that a rebuild skips the build branch entirely when
# the app is already present.
#
# A stable identity keeps macOS recording grants alive across rebuilds. Ad-hoc
# ("-") has no identity, so TCC binds to the binary hash and every rebuild
# silently revokes Screen Recording and Microphone.
echo "── signing identity ──"
SIGN_ID="$(head -1 memory/settings/signing-identity.txt 2>/dev/null | tr -d '\n')"
# `find-identity -p codesigning` without -v, deliberately: -v lists only
# "valid" identities, and a self-signed certificate reads as
# CSSMERR_TP_NOT_TRUSTED until an admin marks it trusted. Trust governs
# VERIFYING a signature, not producing one — codesign signs fine with it, which
# is all a stable TCC identity needs.
if [ -n "$SIGN_ID" ] && ! security find-identity -p codesigning 2>/dev/null | grep -q "$SIGN_ID"; then
  warn "signing identity '$SIGN_ID' is configured but not in the keychain — falling back to ad-hoc"
  SIGN_ID=""
fi
SIGN_ID="${SIGN_ID:--}"
[ "$SIGN_ID" = "-" ] && warn "signing ad-hoc — recording permissions reset on every rebuild (fix: jarvis sign create)" \
                     || ok "signing as '$SIGN_ID'"

# Reconcile an already-built bundle with the configured identity. The build
# branches below only run when the binary is MISSING, so without this the exact
# sequence `jarvis sign create` prints — "now run jarvis setup" — would leave
# both apps ad-hoc forever: they are already built, so nothing re-signs them.
resign_if_stale() {
  app="$1"; label="$2"
  [ -d "$app" ] || return 0
  [ "${CHECK_ONLY:-0}" = 1 ] && return 0
  if codesign -dv "$app" 2>&1 | grep -q '^Signature=adhoc'; then have="-"
  else have="$(codesign -dvvv "$app" 2>&1 | sed -n 's/^Authority=//p' | head -1)"; fi
  [ "$have" = "$SIGN_ID" ] && return 0
  if codesign --force -s "$SIGN_ID" "$app" 2>>/tmp/jarvis-swift-err; then
    ok "$label re-signed ($have → $SIGN_ID)"
    warn "re-grant Screen Recording and Microphone once — the identity changed"
  else warn "$label could not be re-signed — see /tmp/jarvis-swift-err"; fi
}

echo "── audio helpers (built from source in tools/call-capture) ──"
for b in audiocap miccheck; do
  if [[ -x "tools/call-capture/bin/$b" ]]; then ok "$b"
  elif [[ $CHECK_ONLY == 1 ]]; then bad "$b not built — run: jarvis setup"
  else
    mkdir -p tools/call-capture/bin
    echo "  building $b..."
    if swiftc -O "tools/call-capture/$b.swift" -o "tools/call-capture/bin/$b" 2>/tmp/jarvis-swift-err; then
      ok "$b built"
    else bad "$b failed to build — see /tmp/jarvis-swift-err (Xcode CLT needed: xcode-select --install)"; fi
  fi
done
# JarvisAudio.app: recording with its own permission identity (System
# Settings shows "Jarvis Audio", not your terminal)
APPD="tools/call-capture/JarvisAudio.app/Contents"
if [[ -x "$APPD/MacOS/audiocap" ]]; then ok "JarvisAudio.app"
elif [[ $CHECK_ONLY == 1 ]]; then bad "JarvisAudio.app not built — run: jarvis setup"
else
  mkdir -p "$APPD/MacOS"
  cat > "$APPD/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>com.jarvis.audio</string>
  <key>CFBundleName</key><string>Jarvis Audio</string>
  <key>CFBundleDisplayName</key><string>Jarvis Audio</string>
  <key>CFBundleExecutable</key><string>audiocap</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>LSUIElement</key><true/>
  <key>NSMicrophoneUsageDescription</key>
  <string>Jarvis records your side of calls to transcribe them locally.</string>
</dict>
</plist>
PLIST
  if swiftc -O tools/call-capture/audiocap.swift -o "$APPD/MacOS/audiocap" 2>/tmp/jarvis-swift-err \
     && codesign --force -s "$SIGN_ID" tools/call-capture/JarvisAudio.app 2>>/tmp/jarvis-swift-err; then
    ok "JarvisAudio.app built + signed"
  else bad "JarvisAudio.app build failed — see /tmp/jarvis-swift-err"; fi
fi

# JarvisBar.app: the menu-bar face — status icon, record controls, master
# switch (starting it starts the server). Rebuilt whenever the source is
# newer than the binary so upgrades pick up changes.
BARD="tools/menubar/JarvisBar.app/Contents"
if [[ -x "$BARD/MacOS/jarvisbar" && "$BARD/MacOS/jarvisbar" -nt tools/menubar/jarvisbar.swift ]]; then ok "JarvisBar.app"
elif [[ $CHECK_ONLY == 1 ]]; then bad "JarvisBar.app not built — run: jarvis setup"
else
  mkdir -p "$BARD/MacOS" "$BARD/Resources"
  cat > "$BARD/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>com.jarvis.bar</string>
  <key>CFBundleName</key><string>Jarvis</string>
  <key>CFBundleDisplayName</key><string>Jarvis</string>
  <key>CFBundleExecutable</key><string>jarvisbar</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>LSUIElement</key><true/>
  <key>CFBundleIconFile</key><string>Jarvis</string>
  <!-- the dashboard opens in a WKWebView window now, and its voice feature
       calls getUserMedia; without this key macOS denies the request before
       the app's own delegate is ever consulted -->
  <key>NSMicrophoneUsageDescription</key><string>Jarvis uses the microphone so you can talk to it from the dashboard.</string>
  <key>JarvisDir</key><string>$PWD</string>
</dict>
</plist>
PLIST
  # The app icon is rendered from the same SF Symbol the menu bar uses, then
  # packed into .icns. A notification banner takes its icon from the BUNDLE —
  # NSApp.applicationIconImage only covers the Dock — which is why alerts
  # showed a grey placeholder while the Dock showed the brain.
  if swiftc -O tools/menubar/make-icon.swift -o /tmp/jarvis-make-icon 2>>/tmp/jarvis-swift-err; then
    ISET="$(mktemp -d)/Jarvis.iconset"; mkdir -p "$ISET"
    if /tmp/jarvis-make-icon "$ISET" >/dev/null 2>&1 \
       && iconutil -c icns "$ISET" -o "$BARD/Resources/Jarvis.icns" 2>>/tmp/jarvis-swift-err; then
      ok "app icon rendered"
    else warn "app icon generation failed — the app still runs, notifications show a placeholder"; fi
    rm -rf "$(dirname "$ISET")"
  fi
  if swiftc -O tools/menubar/jarvisbar.swift -o "$BARD/MacOS/jarvisbar" 2>/tmp/jarvis-swift-err \
     && codesign --force -s "$SIGN_ID" tools/menubar/JarvisBar.app 2>>/tmp/jarvis-swift-err; then
    ok "JarvisBar.app built + signed (menu-bar icon)"
  else bad "JarvisBar.app build failed — see /tmp/jarvis-swift-err"; fi
fi
resign_if_stale tools/call-capture/JarvisAudio.app JarvisAudio.app
resign_if_stale tools/menubar/JarvisBar.app JarvisBar.app

echo "── obsidian (optional — vault UI, indexed search, phone sync) ──"
OBS_CLI_BIN="/Applications/Obsidian.app/Contents/MacOS/obsidian-cli"
if command -v obsidian >/dev/null 2>&1; then
  ok "obsidian CLI ($(obsidian version 2>/dev/null | head -1))"
elif [[ -x "$OBS_CLI_BIN" ]]; then
  # the app is installed; the CLI just isn't linked — do it
  BINDIR="$(dirname "$(command -v brew 2>/dev/null || echo /usr/local/bin/brew)")"
  if ln -sf "$OBS_CLI_BIN" "$BINDIR/obsidian" 2>/dev/null; then
    ok "obsidian CLI enabled (linked from Obsidian.app)"
  else warn "Obsidian app found but couldn't link its CLI — in Obsidian: Settings → General → Install command line tool"; fi
elif [[ $CHECK_ONLY == 1 ]]; then
  warn "Obsidian not installed — optional. Jarvis writes plain markdown and searches with grep either way; Obsidian adds the vault UI, indexed search, and mobile sync (brew install --cask obsidian)"
else
  if [ -t 0 ]; then
    printf "Install Obsidian? Optional — Jarvis works without it, but it's the best way to browse your vault (y/N) "
    read -r yn
    case "$yn" in [Yy]*)
      brew install --cask obsidian && [[ -x "$OBS_CLI_BIN" ]] \
        && ln -sf "$OBS_CLI_BIN" "$(dirname "$(command -v brew)")/obsidian" 2>/dev/null \
        && ok "Obsidian installed + CLI linked" || warn "installed — open Obsidian once, then rerun jarvis setup to link the CLI"
      ;;
    *) echo "  skipped — install later with: brew install --cask obsidian" ;;
    esac
  else
    warn "Obsidian not installed (optional — brew install --cask obsidian)"
  fi
fi

echo "── recording permissions (attributed to Jarvis Audio) ──"
check_perms() {
  local rf; rf="$(mktemp)"
  open -n -g -a "$PWD/tools/call-capture/JarvisAudio.app" --args --check "$rf" 2>/dev/null
  local i=0; while [[ $i -lt 12 && ! -s "$rf" ]]; do sleep 0.25; i=$((i+1)); done
  cat "$rf" 2>/dev/null; rm -f "$rf"
}
if [[ -x "$APPD/MacOS/audiocap" ]]; then
  PERMS="$(check_perms)"
  if grep -q "screen-recording: granted" <<<"$PERMS"; then ok "screen recording granted to Jarvis Audio"
  elif [[ $CHECK_ONLY == 1 ]]; then bad "screen recording NOT granted — run: jarvis setup (or System Settings → Privacy → Screen Recording → enable Jarvis Audio)"
  else
    echo "  Requesting permissions now — grant BOTH prompts / toggles for \"Jarvis Audio\":"
    echo "    · Screen Recording (how Jarvis hears the other side of calls)"
    echo "    · Microphone (your side)"
    rf="$(mktemp)"
    open -n -g -W -a "$PWD/tools/call-capture/JarvisAudio.app" --args --request "$rf" 2>/dev/null
    sleep 1; cat "$rf" 2>/dev/null | sed 's/^/  /'; rm -f "$rf"
    PERMS="$(check_perms)"
    if grep -q "screen-recording: granted" <<<"$PERMS"; then ok "screen recording granted"
    else warn "not granted yet — System Settings → Privacy & Security → Screen Recording → enable Jarvis Audio (no restart needed; next recording uses it)"; fi
  fi
  grep -q "microphone: granted" <<<"$PERMS" && ok "microphone granted to Jarvis Audio" || warn "microphone not granted to Jarvis Audio yet (calls still record via the legacy path meanwhile)"
fi


echo "── whisper model ──"
WANT="$(head -1 memory/settings/whisper-model.txt 2>/dev/null || head -1 memory.example/settings/whisper-model.txt)"
WANT="${WANT:-base}"
if ls models/ggml-*.bin >/dev/null 2>&1; then ok "model present: $(ls models/ggml-*.bin | xargs -n1 basename | tr '\n' ' ')"
elif [[ $CHECK_ONLY == 1 ]]; then bad "no whisper model in models/ — run: jarvis setup"
else
  mkdir -p models
  echo "  downloading ggml-$WANT.bin (this can take a while)..."
  if curl -fL --progress-bar -o "models/ggml-$WANT.bin" \
      "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-$WANT.bin"; then
    ok "ggml-$WANT.bin downloaded"
  else bad "model download failed — grab ggml-$WANT.bin from huggingface.co/ggerganov/whisper.cpp manually"; fi
  # VAD model keeps silence from hallucinating text; small, worth having
  [[ -f models/ggml-silero-v5.1.2.bin ]] || curl -fLs -o models/ggml-silero-v5.1.2.bin \
    "https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v5.1.2.bin" \
    && ok "silero VAD model" || warn "VAD model download failed (optional)"
fi

echo "── JS workspace ──"
if [[ -L node_modules ]]; then
  ok "managed by Homebrew (engine in $(readlink node_modules | sed 's|/node_modules$||'))"
elif [[ $CHECK_ONLY == 1 ]]; then
  [[ -d node_modules ]] && ok "dependencies installed" || bad "dependencies — run: jarvis setup"
  [[ -d apps/web/dist ]] && ok "web app built" || bad "web app not built — run: jarvis setup"
else
  pnpm install --silent && ok "dependencies installed" || bad "pnpm install failed"
  (cd apps/web && pnpm exec vite build >/dev/null 2>&1) && ok "web app built" || bad "web build failed"
fi

echo
if [[ $MISSING == 1 ]]; then
  echo "Some items need attention (✗ above)."; exit 1
else
  echo "All good. Start Jarvis:  ./jarvis start   →  http://localhost:4321"
fi
