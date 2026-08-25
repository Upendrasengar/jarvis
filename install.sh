#!/usr/bin/env bash
# Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
# install.sh — set up Jarvis on a fresh Mac.
#   ./install.sh          full setup: check deps, build audio helpers,
#                         download a whisper model, install JS deps, build UI
#   ./install.sh --check  doctor mode: report what's missing, change nothing
set -uo pipefail
cd "$(dirname "$0")" || exit 1
CHECK_ONLY=0
[[ "${1:-}" == "--check" ]] && CHECK_ONLY=1

ok()   { printf "  \033[32m✓\033[0m %s\n" "$1"; }
bad()  { printf "  \033[31m✗\033[0m %s\n" "$1"; MISSING=1; }
warn() { printf "  \033[33m!\033[0m %s\n" "$1"; }
MISSING=0

echo "Jarvis $( [[ $CHECK_ONLY == 1 ]] && echo doctor || echo installer )"
echo
echo "── platform ──"
[[ "$(uname)" == "Darwin" ]] && ok "macOS" || bad "macOS required (call recording uses ScreenCaptureKit/CoreAudio)"

echo "── core dependencies ──"
if command -v claude >/dev/null 2>&1; then
  ok "claude CLI ($(claude --version 2>/dev/null | head -1))"
  # is it actually logged in? a dead CLI is the #1 cause of silent chat failure
  PROBE_OUT="$(mktemp)"
  ( claude -p --model haiku "Reply with exactly: OK" > "$PROBE_OUT" 2>&1 ) & PROBE_PID=$!
  for _ in $(seq 1 30); do kill -0 $PROBE_PID 2>/dev/null || break; sleep 1; done
  if kill -0 $PROBE_PID 2>/dev/null; then kill -9 $PROBE_PID 2>/dev/null; bad "claude CLI unresponsive after 30s — check your login: run \`claude\` in a terminal"
  elif grep -qi "OK" "$PROBE_OUT"; then ok "claude CLI logged in and responding"
  else bad "claude CLI present but NOT working — run \`claude\` in a terminal to log in ($(tail -1 "$PROBE_OUT" | cut -c1-60))"; fi
  rm -f "$PROBE_OUT"
else bad "claude CLI — install Claude Code (https://claude.com/claude-code) and log in"; fi
if command -v node >/dev/null 2>&1; then
  v="$(node -e 'console.log(process.versions.node.split(".")[0])')"
  [[ "$v" -ge 20 ]] && ok "node $(node --version)" || bad "node >= 20 (found $(node --version))"
else bad "node >= 20"; fi
command -v pnpm >/dev/null 2>&1 && ok "pnpm $(pnpm --version)" || bad "pnpm — npm i -g pnpm"
command -v ffmpeg >/dev/null 2>&1 && ok "ffmpeg" || bad "ffmpeg — brew install ffmpeg"
command -v whisper-cli >/dev/null 2>&1 && ok "whisper-cli" || bad "whisper-cli — brew install whisper-cpp"
command -v python3 >/dev/null 2>&1 && ok "python3" || bad "python3"

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
     && codesign --force -s - tools/call-capture/JarvisAudio.app 2>>/tmp/jarvis-swift-err; then
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
  mkdir -p "$BARD/MacOS"
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
  <key>JarvisDir</key><string>$PWD</string>
</dict>
</plist>
PLIST
  if swiftc -O tools/menubar/jarvisbar.swift -o "$BARD/MacOS/jarvisbar" 2>/tmp/jarvis-swift-err \
     && codesign --force -s - tools/menubar/JarvisBar.app 2>>/tmp/jarvis-swift-err; then
    ok "JarvisBar.app built + signed (menu-bar icon)"
  else bad "JarvisBar.app build failed — see /tmp/jarvis-swift-err"; fi
fi

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
