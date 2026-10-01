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
# Which architecture this artifact is FOR. Defaults to the host, so the
# ordinary native build is byte-for-byte the command it always was.
#
# Cross-building was previously called "not something to guess at", on the
# assumption that the arch-bound parts get compiled. They do not: the bundled
# Node is a DOWNLOAD from nodejs.org, and better-sqlite3 ships a darwin-x64
# prebuild that npm selects with --cpu/--os. Only the Swift binaries are
# genuinely compiled, and swiftc cross-targets. So the honest constraint is
# much weaker than "you need an Intel Mac".
#
# What this CANNOT do is test the result. An x86_64 artifact assembled here is
# unverified until someone runs it on an Intel Mac — see the arch audit at the
# end, which at least proves every shipped binary is the arch it claims.
HOST_ARCH="$(uname -m)"
ARCH="${JARVIS_TARGET_ARCH:-$HOST_ARCH}"
case "$ARCH" in arm64|x86_64) ;; *) fail "unsupported target architecture: $ARCH" ;; esac
CROSS=0
[ "$ARCH" != "$HOST_ARCH" ] && CROSS=1
if [ "$CROSS" = 1 ]; then
  # The ABI self-check below EXECUTES the bundled runtime, so the host has to
  # be able to run the target's binaries.
  arch -"$ARCH" /usr/bin/true 2>/dev/null \
    || fail "cannot run $ARCH binaries on this $HOST_ARCH Mac — install Rosetta (softwareupdate --install-rosetta)"
  say "CROSS-BUILDING for $ARCH on a $HOST_ARCH host — the result is untested until it runs on one"
fi
say "building with $NODE_BIN ($NODE_VERSION, ABI $NODE_ABI, target $ARCH)"

echo "── web ──"
pnpm --filter @jarvis/web build >/dev/null 2>&1 || fail "vite build failed"
[ -s apps/web/dist/index.html ] || fail "web build produced no index.html"
ok "web built"

echo "── native ──"
# A cross build compiles into a SCRATCH tree and leaves the working copy
# alone. Overwriting the developer's own JarvisAudio.app with a foreign-arch
# binary would break the machine cutting the release — the same hazard the
# signing note below describes, in a worse form: an app that cannot even
# launch, with its recording grants attached to a binary that no longer runs.
SWIFT_TARGET=""
XBIN=""
if [ "$CROSS" = 1 ]; then
  # macos13.0: the floor the source already assumes (#available(macOS 13.3)
  # guards imply support below it), and lower than the host would default to.
  SWIFT_TARGET="-target ${ARCH}-apple-macos13.0"
  XBIN="$(mktemp -d)"
fi
for pair in "tools/call-capture/audiocap.swift:tools/call-capture/JarvisAudio.app/Contents/MacOS/audiocap" \
            "tools/menubar/jarvisbar.swift:tools/menubar/JarvisBar.app/Contents/MacOS/jarvisbar"; do
  src="${pair%%:*}"; dst="${pair##*:}"
  [ "$CROSS" = 1 ] && dst="$XBIN/$dst"
  mkdir -p "$(dirname "$dst")"
  # shellcheck disable=SC2086
  swiftc -O $SWIFT_TARGET "$src" -o "$dst" 2>/dev/null || fail "swiftc failed for $src ($ARCH)"
done
# miccheck natively; a cross build also needs bin/audiocap, which doctor.sh
# and logs.ts check for and nothing has ever built — until now it shipped as
# whatever stale copy sat in the working tree, which on a cross build is the
# wrong architecture entirely.
BIN_HELPERS="miccheck"
[ "$CROSS" = 1 ] && BIN_HELPERS="miccheck audiocap"
for b in $BIN_HELPERS; do
  [ -f "tools/call-capture/$b.swift" ] || continue
  mdst="tools/call-capture/bin/$b"
  [ "$CROSS" = 1 ] && mdst="$XBIN/$mdst"
  mkdir -p "$(dirname "$mdst")"
  # shellcheck disable=SC2086
  swiftc -O $SWIFT_TARGET "tools/call-capture/$b.swift" -o "$mdst" 2>/dev/null || true
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
if [ "$CROSS" = 0 ]; then
  codesign --force -s "$SIGN_ID" tools/call-capture/JarvisAudio.app >/dev/null 2>&1 || true
  codesign --force -s "$SIGN_ID" tools/menubar/JarvisBar.app >/dev/null 2>&1 || true
fi
# A cross build signs the STAGED copies instead, after staging — the working
# tree holds no foreign-arch binaries to sign.
ok "swift binaries built${CROSS:+ for $ARCH}${SIGN_ID:+ and signed as '$SIGN_ID'}"

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
# --cpu/--os pin which prebuilt binary npm resolves. Without them a cross
# build quietly installs the HOST's better-sqlite3 and ships an artifact that
# dies at dlopen on the machine it was built for.
NPM_ARCH=""
NODE_NPM_ARCH="$([ "$ARCH" = x86_64 ] && echo x64 || echo arm64)"
if [ "$CROSS" = 1 ]; then
  # --cpu/--os pick which optional dependency npm RESOLVES. They do not reach
  # the postinstall scripts, and both arch-bound packages here fetch their own
  # binary from one: better-sqlite3 via prebuild-install, esbuild via its own
  # downloader. Those read npm_config_arch/npm_config_platform. Passing only
  # the flags resolved the right package names and then let the scripts
  # download host binaries over the top.
  NPM_ARCH="--cpu=$NODE_NPM_ARCH --os=darwin"
  export npm_config_arch="$NODE_NPM_ARCH"
  export npm_config_platform=darwin
  export npm_config_target_arch="$NODE_NPM_ARCH"
fi
# shellcheck disable=SC2086
( cd "$STAGE/deps" && PATH="$(dirname "$NODE_BIN"):$PATH" npm install --omit=dev --no-audit --no-fund $NPM_ARCH ) \
  >/dev/null 2>&1 || fail "npm install of production dependencies failed"
unset npm_config_arch npm_config_platform npm_config_target_arch

# esbuild resolves its platform package correctly (@esbuild/darwin-x64 lands
# with the right binary inside) and then its install script downloads a HOST
# binary over the wrapper regardless — it reads os.arch(), not npm_config_arch.
# At runtime esbuild prefers the platform package, so the artifact would
# probably have worked; shipping an arm64 executable in an x86_64 archive is
# still a lie, and the audit at the end rightly refuses it. Put the correct
# slice where the wrapper lives and drop what the downloader left behind.
if [ "$CROSS" = 1 ]; then
  ESB_PLAT="$STAGE/deps/node_modules/@esbuild/darwin-$NODE_NPM_ARCH/bin/esbuild"
  if [ -x "$ESB_PLAT" ] && [ -e "$STAGE/deps/node_modules/esbuild/bin/esbuild" ]; then
    cp "$ESB_PLAT" "$STAGE/deps/node_modules/esbuild/bin/esbuild"
    rm -f "$STAGE"/deps/node_modules/esbuild/lib/downloaded-* 2>/dev/null || true
    say "esbuild wrapper replaced with the darwin-$NODE_NPM_ARCH slice"
  fi
fi
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
# The copy above took tools/ wholesale, which on a cross build means the
# HOST's binaries. Replace them with the ones compiled for the target, then
# sign the staged bundles — the working tree is deliberately left as it was.
if [ "$CROSS" = 1 ]; then
  for rel in tools/call-capture/JarvisAudio.app/Contents/MacOS/audiocap \
             tools/menubar/JarvisBar.app/Contents/MacOS/jarvisbar \
             tools/call-capture/bin/miccheck \
             tools/call-capture/bin/audiocap; do
    [ -f "$XBIN/$rel" ] || continue
    mkdir -p "$(dirname "$STAGE/$rel")"
    cp "$XBIN/$rel" "$STAGE/$rel"
  done
  codesign --force -s "$SIGN_ID" "$STAGE/tools/call-capture/JarvisAudio.app" >/dev/null 2>&1 || true
  codesign --force -s "$SIGN_ID" "$STAGE/tools/menubar/JarvisBar.app" >/dev/null 2>&1 || true
  rm -rf "$XBIN"
fi
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
RUN_AS=""
[ "$CROSS" = 1 ] && RUN_AS="arch -$ARCH"
# shellcheck disable=SC2086
BUNDLED_ABI="$($RUN_AS "$STAGE/runtime/node" -p 'process.versions.modules' 2>/dev/null || echo "")"
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

# ── architecture audit ──────────────────────────────────────────────────────
# The one check that makes a cross build worth trusting. Everything above can
# succeed while quietly shipping a host-arch binary: npm can fall back, a
# swiftc flag can be dropped, a cp can take the wrong file. This reads the
# Mach-O headers of every binary actually in the artifact and refuses if one
# is not the architecture the archive is about to claim in its name.
#
# It runs for native builds too. A native build cannot really get this wrong,
# which is exactly why the check costs nothing to leave on.
MACH_ARCH="$([ "$ARCH" = x86_64 ] && echo "x86_64" || echo "arm64")"
bad=""
while IFS= read -r bin; do
  info="$(file -b "$bin" 2>/dev/null || true)"
  case "$info" in
    *Mach-O*)
      # A universal binary is fine as long as it CONTAINS the target slice.
      printf '%s' "$info" | grep -q "$MACH_ARCH" || bad="$bad\n   $(printf '%s' "${bin#$STAGE/}") → $info" ;;
  esac
done <<EOF
$(find "$STAGE" -type f \( -perm -u+x -o -name '*.node' -o -name '*.dylib' \) 2>/dev/null)
EOF
if [ -n "$bad" ]; then
  printf "  \033[31m✗\033[0m these binaries are not %s:%b\n" "$MACH_ARCH" "$bad" >&2
  fail "the artifact claims $ARCH but carries foreign-architecture binaries"
fi
ok "every Mach-O in the artifact is $MACH_ARCH"

echo "── archive ──"
mkdir -p "$OUT"
NAME="jarvis-engine-$ARCH-node$NODE_ABI.tar.gz"
tar -czf "$OUT/$NAME" -C "$(dirname "$STAGE")" jarvis
SIZE="$(du -h "$OUT/$NAME" | cut -f1)"
shasum -a 256 "$OUT/$NAME" | awk '{print $1}' > "$OUT/$NAME.sha256"
ok "$OUT/$NAME ($SIZE)"
say "sha256 $(cat "$OUT/$NAME.sha256")"
