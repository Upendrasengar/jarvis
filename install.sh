#!/usr/bin/env bash
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
if command -v claude >/dev/null 2>&1; then ok "claude CLI ($(claude --version 2>/dev/null | head -1))"
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
  elif [[ $CHECK_ONLY == 1 ]]; then bad "$b not built — run ./install.sh"
  else
    mkdir -p tools/call-capture/bin
    echo "  building $b..."
    if swiftc -O "tools/call-capture/$b.swift" -o "tools/call-capture/bin/$b" 2>/tmp/jarvis-swift-err; then
      ok "$b built"
    else bad "$b failed to build — see /tmp/jarvis-swift-err (Xcode CLT needed: xcode-select --install)"; fi
  fi
done

echo "── whisper model ──"
WANT="$(head -1 memory/settings/whisper-model.txt 2>/dev/null || head -1 memory.example/settings/whisper-model.txt)"
WANT="${WANT:-base}"
if ls models/ggml-*.bin >/dev/null 2>&1; then ok "model present: $(ls models/ggml-*.bin | xargs -n1 basename | tr '\n' ' ')"
elif [[ $CHECK_ONLY == 1 ]]; then bad "no whisper model in models/ — run ./install.sh"
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
  [[ -d node_modules ]] && ok "dependencies installed" || bad "dependencies — run ./install.sh"
  [[ -d apps/web/dist ]] && ok "web app built" || bad "web app not built — run ./install.sh"
else
  pnpm install --silent && ok "dependencies installed" || bad "pnpm install failed"
  (cd apps/web && pnpm exec vite build >/dev/null 2>&1) && ok "web app built" || bad "web build failed"
fi

echo "── macOS permissions (grant on first real use) ──"
warn "Microphone + Screen Recording: System Settings → Privacy & Security."
warn "macOS will prompt when the first call is recorded; grant both to your terminal."

echo
if [[ $MISSING == 1 ]]; then
  echo "Some items need attention (✗ above)."; exit 1
else
  echo "All good. Start Jarvis:  ./jarvis start   →  http://localhost:4321"
fi
