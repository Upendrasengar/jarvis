#!/usr/bin/env bash
# Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
# release-artifact.sh [VERSION] — build THIS machine's engine, publish it, and
# point the formula at it.
#
# A release needs one artifact per architecture, and an artifact can only be
# built on the architecture it targets: the native module and the bundled Node
# are both arch-specific, and cross-building them is not something to guess at.
# So a full release is two runs of this script on two Macs, against the same
# tag.
#
# It is deliberately the SAME script on both. The earlier arrangement had the
# Apple Silicon path inline in release.sh and nothing at all for Intel, which
# is how the two architectures ended up published from different commits.
set -uo pipefail

JARVIS_DIR="${JARVIS_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
TAP_DIR="${JARVIS_TAP_DIR:-$JARVIS_DIR/../homebrew-jarvis}"
REPO="upendrasengar/jarvis"

say()  { printf "  %s\n" "$1"; }
ok()   { printf "  \033[32m✓\033[0m %s\n" "$1"; }
fail() { printf "  \033[31m✗\033[0m %s\n" "$1" >&2; exit 1; }

command -v gh >/dev/null 2>&1 || fail "gh is not installed — brew install gh, then gh auth login"
gh auth status >/dev/null 2>&1 || fail "gh is not logged in — run: gh auth login"
[ -d "$TAP_DIR/.git" ] || fail "tap not found at $TAP_DIR (set JARVIS_TAP_DIR)"

cd "$JARVIS_DIR"
git fetch --quiet --tags origin 2>/dev/null || true
VERSION="${1:-$(git tag --sort=-v:refname | head -1)}"
VERSION="${VERSION#v}"
[ -n "$VERSION" ] || fail "no version given and no tags found"
TAG="v$VERSION"
git rev-parse -q --verify "refs/tags/$TAG" >/dev/null || fail "tag $TAG does not exist — cut the release first"

# Build from EXACTLY the tagged tree. Building from whatever happens to be
# checked out is how an artifact came to claim a version it was not built from.
HEAD_SHA="$(git rev-parse HEAD)"
TAG_SHA="$(git rev-parse "$TAG^{commit}")"
if [ "$HEAD_SHA" != "$TAG_SHA" ]; then
  [ -z "$(git status --porcelain)" ] || fail "working tree is dirty — commit or stash, then re-run"
  say "checking out $TAG (was $(git rev-parse --short HEAD))"
  git checkout --quiet "$TAG" || fail "could not check out $TAG"
fi
ok "building from $TAG ($(git rev-parse --short HEAD))"

OUT="$(mktemp -d)"
say "building the engine — this takes a few minutes"
bash "$JARVIS_DIR/tools/build-artifact.sh" "$OUT" >"$OUT/build.log" 2>&1 \
  || { tail -20 "$OUT/build.log" >&2; fail "build failed — see above"; }
ART="$(ls "$OUT"/jarvis-engine-*.tar.gz 2>/dev/null | head -1)"
[ -n "$ART" ] || fail "the build produced no archive"
ok "built $(basename "$ART") ($(du -h "$ART" | cut -f1))"

# Check the artifact before publishing it, not after. Every one of these has
# been wrong at least once: an engine with no runtime, a 15 MB archive that
# looked fine, and an artifact stamped with the previous tag.
say "verifying the archive"
tar -tzf "$ART" | grep -q '^jarvis/runtime/node$' || fail "no bundled Node runtime in the archive"
STAMP="$(tar -xzOf "$ART" jarvis/artifact.json 2>/dev/null)"
echo "$STAMP" | grep -q "\"version\": \"$TAG\"" \
  || fail "archive claims $(echo "$STAMP" | sed -n 's/.*"version"[^"]*"\([^"]*\)".*/\1/p'), not $TAG"
case "$(basename "$ART")" in
  *arm64*)  ARCH_BLOCK=on_arm ;;
  *x86_64*) ARCH_BLOCK=on_intel ;;
  *) fail "cannot tell which architecture $(basename "$ART") targets" ;;
esac
ok "archive carries the runtime and is stamped $TAG ($ARCH_BLOCK)"

say "uploading to the $TAG release"
if gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
  gh release upload "$TAG" "$ART" --clobber --repo "$REPO" >/dev/null \
    || fail "upload failed"
else
  gh release create "$TAG" "$ART" --repo "$REPO" --title "$TAG" \
    --notes "Prebuilt engine for $(basename "$ART" | sed 's/jarvis-engine-//;s/.tar.gz//')." >/dev/null \
    || fail "could not create the release"
fi

# Verify the PUBLISHED bytes rather than the local ones. An upload that
# silently truncated would otherwise be recorded as correct in the formula.
say "confirming what GitHub now serves"
PUB="$OUT/published.tar.gz"
curl -fsSL "https://github.com/$REPO/releases/download/$TAG/$(basename "$ART")" -o "$PUB" \
  || fail "could not download the artifact back"
ART_SHA="$(shasum -a 256 "$ART" | cut -d' ' -f1)"
PUB_SHA="$(shasum -a 256 "$PUB" | cut -d' ' -f1)"
[ "$ART_SHA" = "$PUB_SHA" ] || fail "published bytes differ from what was built ($PUB_SHA vs $ART_SHA)"
ok "published and verified — sha256 $ART_SHA"

# The tap is shared by both machines, so take the other one's changes first.
say "updating the formula ($ARCH_BLOCK)"
git -C "$TAP_DIR" fetch --quiet origin || true
[ -z "$(git -C "$TAP_DIR" status --porcelain)" ] || fail "tap has uncommitted changes — reconcile it first"
git -C "$TAP_DIR" merge --ff-only origin/main >/dev/null 2>&1 \
  || fail "tap cannot fast-forward to origin/main — reconcile it by hand"

# The formula has ONE version, and its engine urls interpolate it. Publishing
# an older version's checksum into it points that architecture at an artifact
# that does not exist — a 404 on install instead of the clean "not published"
# message the placeholder gives.
#
# This is not hypothetical: a machine that had not fetched the newest tag ran
# this with no argument, defaulted to the tag it knew, and patched a formula
# that had already moved on.
TAP_VERSION="$(sed -n 's|.*archive/refs/tags/v\([0-9][0-9.]*\)\.tar\.gz.*|\1|p' \
  "$TAP_DIR/Formula/jarvis.rb" | head -1)"
if [ -n "$TAP_VERSION" ] && [ "$TAP_VERSION" != "$VERSION" ]; then
  fail "the tap is on $TAP_VERSION but this is $VERSION — run 'git fetch --tags' and build $TAP_VERSION, or cut the release for $VERSION first"
fi

python3 - "$TAP_DIR/Formula/jarvis.rb" "$ARCH_BLOCK" "$ART_SHA" <<'PYEOF'
import re, sys
path, block, sha = sys.argv[1], sys.argv[2], sys.argv[3]
src = open(path).read()
pattern = re.compile(r'(' + block + r'\s+do\b.*?sha256\s+")[0-9a-f]{64}(")', re.S)
new, n = pattern.subn(lambda m: m.group(1) + sha + m.group(2), src, count=1)
if n != 1:
    sys.stderr.write(f"could not find exactly one sha256 inside {block} do ... end\n")
    sys.exit(1)
open(path, "w").write(new)
PYEOF
[ $? -eq 0 ] || fail "could not update the $ARCH_BLOCK checksum"

if git -C "$TAP_DIR" diff --quiet; then
  ok "formula already pointed at this artifact — nothing to commit"
else
  git -C "$TAP_DIR" add Formula/jarvis.rb
  git -C "$TAP_DIR" commit --quiet -m "formula: $ARCH_BLOCK engine for $TAG

Built on $(uname -m) from $(git rev-parse --short HEAD), published to the
$TAG release and verified by re-downloading it. sha256 $ART_SHA"
  git -C "$TAP_DIR" push --quiet origin main || fail "could not push the tap"
  ok "tap updated and pushed"
fi

echo
ok "$TAG · $ARCH_BLOCK is live"
say "users on this architecture now get it with: brew update && brew upgrade jarvis"
