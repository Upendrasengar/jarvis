# Releasing Jarvis

A release publishes one **engine** per architecture — a self-contained archive
holding the built web UI, the Swift helpers, production dependencies, and the
Node runtime the native modules were compiled against. Installing is then an
extract: no compiler runs on a user's Mac.

An engine can only be built on the architecture it targets. The native module
and the bundled Node are both arch-specific, and cross-building them is not
something to guess at. **So a release is two commands on two Macs, against the
same tag.**

## The two commands

On the Mac you cut releases from (Apple Silicon here):

```bash
cd homebrew-jarvis
./release.sh 0.3.30
```

On the second Mac (Intel here), any time afterwards:

```bash
cd jarvis
git fetch --tags
bash tools/release-artifact.sh 0.3.30      # version optional — defaults to the newest tag
```

Both run the *same* script for the engine step; `release.sh` calls
`tools/release-artifact.sh` for its own architecture after tagging. That is
deliberate — the earlier arrangement had the Apple Silicon path inline in
`release.sh` and nothing for Intel, which is how the two architectures came to
be published from different commits.

## What `release.sh` does

1. **Refuses to start** unless the engine repo is on `main`, clean, and level
   with `origin/main`, and the tap is clean and fast-forwardable.
2. **Runs four gates** — doctor JSON contract, onboarding state, onboarding
   wizard, public audit. A failure here stops everything with nothing pushed.
3. Tags `vX.Y.Z` and pushes the tag.
4. Updates the formula's source `url` and `sha256`, verifying the published
   tarball matches before committing.
5. Writes `reports/releases/vX.Y.Z.md`.
6. Commits **and pushes** the tap.
7. Hands off to `tools/release-artifact.sh` for this machine's architecture.

## What `tools/release-artifact.sh` does

1. Resolves the version (argument, or newest tag) and **checks out that tag** —
   it builds the tagged tree, not whatever happens to be checked out. Refuses
   on a dirty working tree.
2. Builds the engine.
3. **Verifies before publishing**: the archive must contain `runtime/node` and
   declare the tag being released.
4. Uploads to the GitHub release.
5. **Verifies after publishing** by re-downloading the artifact and comparing
   checksums — a truncated upload would otherwise be recorded as correct.
6. Fast-forwards the tap, patches only its **own** architecture's `sha256`, and
   pushes.

Every one of those checks exists because the matching mistake was made:

| Check | What it caught |
|---|---|
| Build from the tag | An artifact stamped `v0.3.28` but built from a later tree |
| Archive contains a runtime | A 15 MB engine with no Node, which installed "successfully" |
| Re-download and compare | Nothing yet — it is the cheap insurance |
| Patch one architecture only | A blanket `sed` that would have stamped one checksum onto the other's entry |

## Until the second architecture is published

The formula carries an all-zeros placeholder for any unpublished architecture.
`build_prebuilt?` treats that as "not published", and the install stops with a
clear message rather than attempting a source build it has no toolchain for.

So between the two commands, one architecture is live and the other says so.
That is intentional: a clear refusal beats a silent hour of compiling.

## Checking a release landed

```bash
gh release view v0.3.30 --repo upendrasengar/jarvis --json assets \
  -q '.assets[] | "\(.name) \(.size)"'
```

Both engines should be **~50 MB**. Fifteen megabytes means the runtime is
missing — that release should not be advertised.

```bash
gh api repos/Upendrasengar/homebrew-jarvis/contents/Formula/jarvis.rb \
  --jq '.content' | base64 -d | grep -A2 'on_arm do\|on_intel do'
```

Neither checksum should be all zeros.

> Read the formula through the API, not `raw.githubusercontent.com` — the raw
> CDN caches for several minutes and has already reported a stale formula as
> current during a release.

## Versioning

Plain `MAJOR.MINOR.PATCH`, no `v` in the argument (`./release.sh 0.3.30`); the
tag gets the `v`. Tags are never moved — if a release is wrong, cut the next
patch version. A moved tag leaves Homebrew caches pointing at content that no
longer exists.
