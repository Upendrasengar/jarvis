#!/usr/bin/env bash
# Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
# build-artifact.sh [OUTDIR] — produce a prebuilt engine archive (plan Task 9).
#
# Everything a user Mac currently compiles happens HERE instead: pnpm, Vite and
# swiftc run on the release machine, and the install becomes an extract.
#
# The native module is why this needs care. better-sqlite3 is compiled against
# one Node ABI, and running the server on a different one fails at dlopen with
# NODE_MODULE_VERSION — which is exactly how `jarvis start` broke when Homebrew
# put node 26 ahead of nvm's 22 on PATH. So the build refuses to run on a Node
# that does not match the pinned one, records the ABI it built against, and the
# archive carries that number for the installer to check.
set -euo pipefail

JARVIS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$JARVIS_DIR"

OUT="${1:-$JARVIS_DIR/dist-artifact}"
STAGE="$(mktemp -d)/jarvis"
trap 'rm -rf "$(dirname "$STAGE")"' EXIT

say()  { printf "  %s\n" "$1"; }
fail() { printf "  \033[31m✗\033[0m %s\n" "$1" >&2; exit 1; }
ok()   { printf "  \033[32m✓\033[0m %s\n" "$1"; }

# ── the Node this must be built with ───────────────────────────────────────
# Same precedence the launcher uses, so the artifact is compiled against the
# runtime that will actually load it.
NODE_BIN="${JARVIS_NODE:-}"
if [ -z "$NODE_BIN" ] && [ -f memory/settings/node-bin.txt ]; then
  NODE_BIN="$(head -1 memory/settings/node-bin.txt | tr -d '[:space:]')"
fi
NODE_BIN="${NODE_BIN:-node}"
command -v "$NODE_BIN" >/dev/null 2>&1 || [ -x "$NODE_BIN" ] \
  || fail "node not found at '$NODE_BIN' — set JARVIS_NODE or memory/settings/node-bin.txt"

# Put the resolved Node's directory first on PATH so pnpm/npm/tsx use the same
# runtime — prevents a broken Homebrew node from being picked up by children.
NODE_DIR="$(dirname "$(command -v "$NODE_BIN" 2>/dev/null || echo "$NODE_BIN")")"
export PATH="$NODE_DIR:$PATH"

NODE_VERSION="$("$NODE_BIN" -p 'process.version')"
NODE_ABI="$("$NODE_BIN" -p 'process.versions.modules')"
ARCH="$(uname -m)"
say "building with $NODE_BIN ($NODE_VERSION, ABI $NODE_ABI, $ARCH)"

echo "── web ──"
pnpm --filter @jarvis/web build >/dev/null 2>&1 || fail "vite build failed"
[ -s apps/web/dist/index.html ] || fail "web build produced no index.html"
ok "web built"

echo "── native ──"
for pair in "tools/call-capture/audiocap.swift:tools/call-capture/JarvisAudio.app/Contents/MacOS/audiocap" \
            "tools/menubar/jarvisbar.swift:tools/menubar/JarvisBar.app/Contents/MacOS/jarvisbar"; do
  src="${pair%%:*}"; dst="${pair##*:}"
  mkdir -p "$(dirname "$dst")"
  swiftc -O "$src" -o "$dst" 2>/dev/null || fail "swiftc failed for $src"
done
for b in miccheck; do
  [ -f "tools/call-capture/$b.swift" ] && swiftc -O "tools/call-capture/$b.swift" -o "tools/call-capture/bin/$b" 2>/dev/null || true
done
# Sign with the CONFIGURED identity, not ad-hoc. This step compiles into the
# working tree, so `-s -` re-signed the developer's own installed apps ad-hoc
# as a side effect of cutting a release — silently revoking the macOS
# recording grants that a stable identity exists to preserve. Building a
# release must not break the machine doing the building.
SIGN_ID=""
if [ -f memory/settings/signing-identity.txt ]; then
  SIGN_ID="$(head -1 memory/settings/signing-identity.txt | tr -d '\n')"
fi
if [ -n "$SIGN_ID" ] && ! security find-identity -p codesigning 2>/dev/null | grep -q "$SIGN_ID"; then
  SIGN_ID=""
fi
SIGN_ID="${SIGN_ID:--}"
codesign --force -s "$SIGN_ID" tools/call-capture/JarvisAudio.app >/dev/null 2>&1 || true
codesign --force -s "$SIGN_ID" tools/menubar/JarvisBar.app >/dev/null 2>&1 || true
ok "swift binaries built and signed${SIGN_ID:+ as '$SIGN_ID'}"

echo "── production dependencies ──"
# Built with npm rather than `pnpm deploy`: deploy requires the workspace to
# set inject-workspace-packages, and changing a repo-wide package-manager
# setting to make a release script work is the wrong trade. npm produces a flat
# node_modules that plain Node can resolve with no store or symlinks.
#
# tsx is in this list even though package.json calls it a devDependency,
# because services.sh literally starts the server with
# `node node_modules/tsx/dist/cli.mjs` — @jarvis/shared is published as raw
# TypeScript (main: src/index.ts), so the runtime transpiles on the fly.
# Shipping without tsx produces an archive that cannot boot.
rm -rf "$STAGE"; mkdir -p "$STAGE"
resolved() {   # exact installed version, so the artifact matches what was tested
  node -p "require('$JARVIS_DIR/apps/server/node_modules/$1/package.json').version" 2>/dev/null \
    || node -p "require('$JARVIS_DIR/node_modules/$1/package.json').version" 2>/dev/null
}
DEPS=""
for p in @fastify/static @fastify/websocket better-sqlite3 fastify zod tsx; do
  v="$(resolved "$p")"
  [ -n "$v" ] || fail "could not resolve an installed version of $p"
  DEPS="$DEPS \"$p\": \"$v\","
done
mkdir -p "$STAGE/deps"
cat > "$STAGE/deps/package.json" <<JSON
{ "name": "jarvis-engine-deps", "private": true, "dependencies": { ${DEPS%,} } }
JSON
# --omit=dev keeps it to runtime; the pinned node is what compiles or selects
# the better-sqlite3 binary, which is the whole point of the ABI pin above.
( cd "$STAGE/deps" && PATH="$(dirname "$NODE_BIN"):$PATH" npm install --omit=dev --no-audit --no-fund ) \
  >/dev/null 2>&1 || fail "npm install of production dependencies failed"
ok "production dependencies resolved ($(du -sh "$STAGE/deps/node_modules" | cut -f1))"

echo "── staging ──"
# Explicit allowlist. A denylist here would ship whatever was added since it
# was last reviewed, and this archive is published.
for path in jarvis install.sh package.json pnpm-workspace.yaml README.md LICENSE \
            apps/server/src apps/server/package.json apps/web/dist \
            packages tools docs memory.example; do
  [ -e "$path" ] || continue
  mkdir -p "$STAGE/$(dirname "$path")"
  cp -R "$path" "$STAGE/$path"
done
mv "$STAGE/deps/node_modules" "$STAGE/node_modules"
rm -rf "$STAGE/deps"
# the workspace package ships as source, exactly as the server imports it
mkdir -p "$STAGE/node_modules/@jarvis"
cp -R packages/shared "$STAGE/node_modules/@jarvis/shared"
# build inputs the user will never need
rm -rf "$STAGE/tools/tests" "$STAGE/apps/web/src"
ok "staged"

echo "── node runtime ──"
# Ship the interpreter with the code it was compiled against.
#
# better-sqlite3 is built for one Node ABI and fails at dlopen on any other —
# that is how `jarvis start` broke when Homebrew put node 26 ahead of nvm's 22
# on PATH. Pinning a version in a settings file makes that a rule someone has
# to keep obeying. Carrying the runtime makes it structural.
#
# It also removes node@22 as a Homebrew dependency, which matters more than it
# sounds: Homebrew publishes NO macOS Intel bottles for node@22, so an Intel
# install compiles Node from source before it can start.
#
# Deliberately the official nodejs.org build, not the Homebrew one. Homebrew's
# node links against /opt/homebrew dylibs (icu4c, brotli, libuv…) that are not
# present on a machine that never installed them; the official build is
# self-contained, which is checked below rather than assumed.
case "$ARCH" in
  arm64)  NODE_ARCH=arm64 ;;
  x86_64) NODE_ARCH=x64 ;;
  *) fail "unsupported architecture for a bundled runtime: $ARCH" ;;
esac
NODE_TGZ="node-${NODE_VERSION}-darwin-${NODE_ARCH}.tar.gz"
NODE_TMP="$(mktemp -d)"
curl -fsSL "https://nodejs.org/dist/${NODE_VERSION}/${NODE_TGZ}" -o "$NODE_TMP/$NODE_TGZ"   || fail "could not download the official Node runtime ($NODE_TGZ)"
tar -xzf "$NODE_TMP/$NODE_TGZ" -C "$NODE_TMP" "node-${NODE_VERSION}-darwin-${NODE_ARCH}/bin/node"   || fail "the Node tarball did not contain bin/node"
mkdir -p "$STAGE/runtime"
cp "$NODE_TMP/node-${NODE_VERSION}-darwin-${NODE_ARCH}/bin/node" "$STAGE/runtime/node"
chmod +x "$STAGE/runtime/node"
rm -rf "$NODE_TMP"

# It must be the SAME ABI the native modules were just built against,
# otherwise this ships a runtime guaranteed to fail at dlopen.
BUNDLED_ABI="$("$STAGE/runtime/node" -p 'process.versions.modules' 2>/dev/null || echo "")"
[ "$BUNDLED_ABI" = "$NODE_ABI" ]   || fail "bundled runtime is ABI ${BUNDLED_ABI:-unknown}, but the modules were built for $NODE_ABI"

# Self-contained means it references only the OS. A link into /opt/homebrew or
# /usr/local would work here and fail on the user's Mac, which is the worst
# possible place to find out.
if otool -L "$STAGE/runtime/node" 2>/dev/null | grep -qE '/opt/homebrew|/usr/local'; then
  fail "the bundled runtime links against local Homebrew libraries — it would not run elsewhere"
fi
ok "node ${NODE_VERSION} (${NODE_ARCH}, ABI ${BUNDLED_ABI}) bundled and self-contained"

echo "── metadata ──"
cat > "$STAGE/artifact.json" <<JSON
{
  "version": "$(git describe --tags --abbrev=0 2>/dev/null || echo unknown)",
  "commit": "$(git rev-parse --short HEAD)",
  "builtAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "arch": "$ARCH",
  "node": "$NODE_VERSION",
  "nodeAbi": "$NODE_ABI",
  "bundledRuntime": "runtime/node"
}
JSON
ok "artifact.json written (node $NODE_VERSION, ABI $NODE_ABI, $ARCH)"

echo "── safety ──"
# The acceptance criterion is that no user data or secret ships. Check the
# staged tree rather than trusting the copy list above to have stayed correct.
for d in memory reports brain data secrets models node_modules/.cache .git; do
  [ -e "$STAGE/$d" ] && fail "user data or build junk leaked into the artifact: $d"
done
if [ -f "$STAGE/secrets/.env" ]; then fail "secrets/.env is in the artifact"; fi
if grep -rlqE '(sk-[A-Za-z0-9]{16,}|xoxb-[A-Za-z0-9-]{16,}|BEGIN (RSA |OPENSSH )?PRIVATE KEY)' "$STAGE" 2>/dev/null; then
  fail "a credential-shaped string is present in the artifact"
fi
ok "no user data, no secrets"

echo "── archive ──"
mkdir -p "$OUT"
NAME="jarvis-engine-$ARCH-node$NODE_ABI.tar.gz"
tar -czf "$OUT/$NAME" -C "$(dirname "$STAGE")" jarvis
SIZE="$(du -h "$OUT/$NAME" | cut -f1)"
shasum -a 256 "$OUT/$NAME" | awk '{print $1}' > "$OUT/$NAME.sha256"
ok "$OUT/$NAME ($SIZE)"
say "sha256 $(cat "$OUT/$NAME.sha256")"
