# Implementation Plan: One-Command Jarvis Installation

Progress is tracked in the
[One-Command Installation Checklist](installation-checklist.md). Update the
checklist in the same commit as each completed implementation slice.

## Goal

A new user on either Apple Silicon or Intel Mac can install and launch Jarvis
in under five minutes using:

```bash
brew install upendrasengar/jarvis/jarvis
jarvis onboard
```

Onboarding must be resumable, preserve user data, explain macOS permission
steps, and leave Jarvis running and healthy.

## Architecture decisions

- Keep Homebrew as the primary distribution channel initially.
- Introduce `jarvis onboard` while preserving the existing advanced commands.
- Make every setup step idempotent; rerunning onboarding must not overwrite
  configuration or secrets.
- Separate core setup from optional meeting, Obsidian, calendar, Telegram,
  and background-service capabilities.
- Publish prebuilt artifacts so end users do not run pnpm, Vite, or `swiftc`.
- Keep private data in `~/.jarvis`; upgrades replace only the engine.

## Phase 1: Establish the installation contract

### Task 1: Define supported Macs and success criteria

**Status: Complete.** The accepted contract is recorded in
[Installation Contract](install.md) and [Support Matrix](support-matrix.md).

Document the supported combinations:

- Apple Silicon and Intel
- Current macOS plus the previous two major versions
- Clean-machine and upgrade scenarios
- Homebrew installed or absent
- Claude Code authenticated or unauthenticated

Acceptance criteria:

- A support matrix exists.
- “Installation complete” has a precise definition.
- Expected installation time and download size are recorded.
- Optional features do not block core installation.

Likely files:

- `README.md`
- `docs/install.md`
- `docs/support-matrix.md`

Dependencies: none.

### Task 2: Make Doctor machine-readable

Add structured output:

```bash
jarvis doctor --json
```

Checks should cover macOS and CPU architecture, Homebrew, Node and native ABI,
Claude Code installation and authentication, the production web build, server
health, Whisper, FFmpeg, permissions, vault configuration, calendar status,
and the LaunchAgent.

Acceptance criteria:

- Every check reports `pass`, `warning`, `blocked`, or `optional`.
- Every failure has one specific remediation.
- Human-readable output remains the default.
- JSON output never contains secret values.
- Doctor remains read-only.

Verification:

- Unit tests cover every status classification.
- Run against clean and configured temporary homes.
- Scan captured output for secret values.

Dependencies: none.

## Phase 2: Build resumable onboarding

### Task 3: Introduce onboarding state

**Status: Complete.** Implemented by `tools/onboarding-state.mjs`, with the
state contract verified by `tools/test-onboarding-state.mjs`.

Store only non-secret progress under `memory/settings/`. Credentials remain in
`secrets/.env`.

State contract:

- `memory/settings/onboarding.json` stores schema version `1`, creation and
  update timestamps, whether a pre-existing installation was adopted, and an
  allowlisted status for each onboarding step.
- Step status is either `incomplete` or `complete`. Revisiting a completed
  step marks that step incomplete without discarding later progress.
- Reading status does not create or modify the state file. The first explicit
  progress update writes it atomically.
- An installation with an existing profile plus built engine dependencies and
  web assets is adopted as complete when no state file exists. This prevents
  upgrades from resetting established installations.
- The state writer rejects unknown steps, unknown fields, and values that
  resemble credentials or secret configuration.

Suggested steps:

```text
system → claude → profile → vault → calendar → meetings → service → complete
```

Acceptance criteria:

- Onboarding resumes at the first incomplete step.
- Completed steps can be revisited.
- Upgrades do not reset onboarding.
- Existing installations are recognized as configured.
- No secret enters the state file.

Dependencies: Task 2.

### Task 4: Add the `jarvis onboard` CLI wizard

**Status: Complete.** Implemented by `tools/onboard.sh`, with clean-run,
idempotence, interruption/resume, and blocked-Claude behavior verified by
`tools/test-onboard.sh`.

The wizard should:

1. Run Doctor.
2. Check Claude Code.
3. Collect the basic user profile.
4. Offer optional modules.
5. Download Whisper only when meetings are enabled.
6. Offer startup at login.
7. Start Jarvis.
8. Verify `/api/health`.
9. Open the browser.
10. Print a concise completion summary.

CLI contract:

- `jarvis onboard` runs the interactive wizard; `jarvis onboard
  --non-interactive` uses environment-provided profile values and skips
  unconfigured optional integrations.
- Each step is marked complete only after its action succeeds. `Ctrl-C` or a
  failed command leaves that step incomplete and prints the rerun command.
- A completed rerun performs health verification but does not rewrite user
  files or reinstall services.
- The wizard never asks for or persists credentials. Calendar credentials are
  configured through the existing local Settings screen after startup.
- Task 4 offers optional vault, meetings, and login-service setup individually;
  Task 5 adds the named Core, Meetings, and Full profile shortcuts.

Acceptance criteria:

- Core setup requires no manual file editing.
- Ctrl-C safely interrupts every step.
- Rerunning creates no duplicate services or configuration.
- Optional integrations can be skipped.
- Failures preserve progress and show a repair command.

Likely files:

- `jarvis`
- `tools/onboard.sh`
- `tools/init.sh`
- `install.sh`
- onboarding tests

Dependencies: Tasks 2–3.

### Task 5: Add installation profiles

**Status: Complete.** Core, Meetings, and Full selection, persistence, and
additive upgrades are implemented in `tools/onboard.sh` and verified by
`tools/test-onboard.sh`.

Offer three profiles:

- **Core:** assistant, memory, and dashboard
- **Meetings:** Core plus calendar, recording, and transcription
- **Full:** Meetings plus Obsidian, Telegram, and background jobs

Profile contract:

- `core` is the safe default. It never downloads a Whisper model, builds
  recording helpers, or requests recording permissions.
- The selected non-secret profile is stored in
  `memory/settings/installation-profile.txt` and printed before any setup
  action begins.
- `jarvis onboard --profile core|meetings|full` works in interactive and
  non-interactive runs. Interactive runs without a stored selection prompt
  once, defaulting to Core.
- Selecting a larger profile later reopens only the newly relevant onboarding
  steps; it never rewrites the local profile or removes configured features.
- Meetings and Full require meeting components to be ready. Non-interactive
  runs stop with a repair command instead of starting large downloads.
- Full offers Obsidian, Telegram, and start-at-login setup. Declined or
  unconfigured integrations remain optional Doctor findings.

Acceptance criteria:

- Core does not download Whisper or request recording permissions.
- Optional modules can be added later through `jarvis onboard`.
- Skipped integrations appear as optional, not failed, in Doctor.
- The selected profile is shown before installation begins.

Dependencies: Task 4.

### Checkpoint: CLI onboarding

Verify against a temporary clean home:

```bash
JARVIS_HOME="$(mktemp -d)" jarvis onboard
```

- Core onboarding completes.
- A second run is a no-op except for health verification.
- Interrupted onboarding resumes correctly.
- Existing installations are not unexpectedly modified.
- The server starts and returns a healthy response.
- Uninstall offers to retain user data.

## Phase 3: Add browser-based onboarding

### Task 6: Create an onboarding status API

**Status: Complete.** Implemented by `apps/server/src/services/onboarding.ts`
and `apps/server/src/routes/onboarding.ts`, with the contract verified by
`apps/server/test/onboarding.test.ts`.

Expose non-secret setup status and narrowly scoped configuration endpoints.

API contract:

- `GET /api/onboarding` returns the schema version, per-step status, the next
  incomplete step, the selected installation profile, and whether each optional
  integration is configured. It never returns a secret value; readiness is a
  boolean and the only field on an integration.
- `POST /api/onboarding/step` and `POST /api/onboarding/profile` are local-only
  and Zod-validated. Steps are validated against the CLI's own step list rather
  than a copy of it, so the two cannot disagree about what a valid step is.
- Both mutations are safe to repeat: completing a completed step changes
  nothing but a timestamp, which is what keeps the flow resumable.
- The service imports `tools/onboarding-state.mjs` instead of reimplementing
  it. One writer, one validator, one definition of "which step is next".

Acceptance criteria:

- Read endpoints never return secret values.
- Mutation endpoints are local-only and validated with Zod.
- Every mutation is safe to repeat.
- APIs report whether a secret exists, not its value.
- Status identifies the next recommended step.

Likely files:

- `packages/shared/src/index.ts`
- `apps/server/src/routes/onboarding.ts`
- `apps/server/src/services/onboarding.ts`
- server tests

Dependencies: Tasks 2–3.

### Task 7: Build `/onboarding`

**Status: Complete.** Implemented by
`apps/web/src/features/onboarding/OnboardingPage.tsx`, backed by the Task 6
API and by `GET /api/doctor`, which spawns `tools/doctor.sh --json` rather
than reimplementing its checks.

Screen contract:

- Steps come from the onboarding API, so the browser and the CLI wizard agree
  about what is done and what is next; the page only supplies presentation.
- Required and optional steps are labelled and styled differently, and skipping
  an optional step says plainly that Doctor will record it as optional rather
  than failed.
- No credential is collected or redisplayed. Calendar readiness is proved with
  a fetch timestamp and an event COUNT; the feed address is never shown.
- The system check runs only when asked, because Doctor takes about eight
  seconds, and its result is briefly cached so a repeat click is instant.
- Only failing checks are listed with their remediation. A wall of green
  reports nothing the user can act on.

Create a guided flow:

```text
Welcome → System check → Claude → Profile → Calendar
        → Meeting recording → Startup → Ready
```

Acceptance criteria:

- Works in light and dark themes.
- Supports keyboard navigation.
- Clearly distinguishes required and optional steps.
- Sensitive inputs are never redisplayed.
- Calendar setup proves the connection using safe status information.
- Completion opens the normal Jarvis overview.

Dependencies: Task 6.

### Task 8: Route incomplete installs into onboarding

**Status: Complete.** The gate lives in `apps/web/src/app/router.tsx`, backed
by `setupComplete` from the onboarding API, with a reopen entry point in
Settings.

Gate contract:

- `setupComplete` counts only REQUIRED steps — `system`, `claude`, `profile`,
  `vault`. Optional steps and unconfigured integrations never hold it open.
  Required-ness is decided on the server so the redirect and the setup screen
  cannot hold different opinions about whether setup is finished.
- The redirect fires only from `/` and `/overview`. Navigating anywhere
  deliberately is never overridden, so setup can be left at any moment.
- A server that cannot answer does not redirect, so an API failure cannot
  strand someone in setup.
- Settings carries a Setup section that reports outstanding optional steps and
  reopens the flow, so a skipped module can be added later without a CLI.

Acceptance criteria:

- Fresh installs enter onboarding.
- Existing installs continue opening normally.
- Settings provides a way to reopen onboarding.
- Failed optional integrations never trap the user.

Dependencies: Task 7.

### Checkpoint: End-to-end first run

On a clean macOS user account:

1. Install the formula.
2. Run `jarvis onboard`.
3. Complete browser onboarding.
4. Restart the Mac or user session.
5. Confirm automatic startup.
6. Upgrade Jarvis.
7. Confirm configuration and permissions survive.

## Phase 4: Remove build-time work from user Macs

### Task 9: Produce prebuilt engine artifacts

**Status: Complete.** Built by `tools/build-artifact.sh`, which produces
`jarvis-engine-<arch>-node<abi>.tar.gz` plus a `.sha256`.

Artifact contract:

- The build refuses to run on a Node that is not the pinned one, and records
  the version and ABI it built against in `artifact.json`. `tools/services.sh`
  checks that number before starting and refuses with the mismatch named,
  which turns the dlopen crash this repo has already hit into one sentence.
- Production dependencies are installed with npm rather than `pnpm deploy`:
  deploy requires `inject-workspace-packages`, and changing a repo-wide
  package-manager setting to suit a release script is the wrong trade.
- `tsx` ships despite being declared a devDependency, because `services.sh`
  starts the server through it and `@jarvis/shared` is consumed as raw
  TypeScript. Without it the archive cannot boot.
- Staging uses an explicit allowlist, then re-checks the staged tree for user
  data and credential-shaped strings. A denylist would ship whatever was added
  since it was last reviewed.
- Result: 15 MB compressed, against 274 MB of development `node_modules`.

Artifacts should contain installed production dependencies, the Vite build,
compiled Swift binaries, JarvisBar, Jarvis Audio, and Node/native-ABI metadata.

Acceptance criteria:

- Installation does not run pnpm, Vite, or `swiftc`.
- Artifacts contain no user data or secrets.
- Pre-push audit passes.
- Jarvis boots directly from the extracted artifact.

Dependencies: Phase 2 complete.

### Task 10: Publish architecture-specific Homebrew bottles

**Status: Apple Silicon published in v0.3.27. The compile is gone; the
dependency download is not. Intel blocked on hardware.**

The formula carries a per-architecture `engine` resource and installs by
extracting it, and `release.sh` builds the artifact, attaches it to the GitHub
release, and writes its checksum into the formula before the tap is committed.

First publication, v0.3.27 (2026-09-18):

- Published: `jarvis-engine-arm64-node127.tar.gz`, 15 MB, sha256
  `e48d517e99b003ff937703c8084a94aa028e35b811ae6bd4278b2d8ca32a51ed`, stamped
  with the tag and commit it was built from. The all-zeros placeholder is gone,
  so `build_prebuilt?` now returns true and installs extract instead of
  compiling.
- Verified independently of `release.sh`: the published artifact was
  re-downloaded and re-hashed against the formula, and the extracted tree boots
  a server that answers `/api/health`, serves the UI, and loads
  `better-sqlite3` against ABI 127.

The acceptance criterion below says "downloads a bottle instead of compiling".
Half of that is now true, and the distinction matters enough to write down:

- The **compile** is gone. No pnpm, no Vite, no swiftc on the user's Mac.
- The **dependency download is not**. Homebrew installs `:build` dependencies
  whenever it has no bottle for the formula itself, which is always, because
  the formula is not bottled. An install therefore still pulls `pnpm`, `rust`
  and `llvm@22` and then never uses them. Removing that needs real Homebrew
  bottles for the formula — a separate piece of work from the prebuilt engine
  resource, and not what this task delivered.

`whisper.cpp`, `llama.cpp` and `ggml` are not in that category: they are the
local transcription stack, genuinely required at runtime, and install once.

Two things learned publishing it, both fixed:

- `build-artifact.sh` compiles into the working tree and signed with `-s -`,
  so cutting a release re-signed the release machine's own apps ad-hoc and
  silently revoked its macOS recording grants. It now signs with the
  configured identity.
- A tap clone on another machine is cached, and `brew install` will happily
  install the previous version until `brew update` runs. The published formula
  being correct is not sufficient; verify with `brew info jarvis` before
  concluding anything about a test install.

Still not proven: `brew upgrade` preserving `~/.jarvis` across versions.

- Intel is not attempted. Cross-building a native module is not something to
  guess at, and the plan's own risk table says to secure an Intel runner before
  promising Intel support. An architecture with no artifact falls through to the
  source build rather than failing, so Intel keeps working unchanged. The
  `engine` resource declares only `on_arm`; on Intel it resolves to nothing,
  `build_prebuilt?` rescues to false, and the source path runs.

Produce bottles for Apple Silicon and Intel.

Acceptance criteria:

- Homebrew downloads a bottle instead of compiling.
- Installation passes on the supported macOS matrix.
- `better-sqlite3` loads with the packaged Node runtime.
- `brew upgrade` preserves `~/.jarvis`.
- Formula tests run Doctor and boot a sandbox server.

Dependencies: Task 9.

### Task 11: Automate release validation

**Status: Complete for the single architecture this project can build.**
`release.sh` now gates, publishes, verifies and reports.

- Four gates run BEFORE anything is tagged: the doctor JSON contract, the
  onboarding state contract, the onboarding wizard suite, and the public audit.
  Any failure exits with nothing tagged or pushed — a release that tags first
  and tests afterwards has already published the mistake.
- After tagging, the published source tarball and the published engine are
  downloaded and checked against the formula, and the engine is opened to
  confirm it contains a server. GitHub caches tag tarballs, and this repo has
  already shipped a release whose formula pointed at content that was not what
  had been built.
- Each release writes `reports/releases/v<version>.md` recording the commit,
  checksums, and the result of every gate.
- The dirty-tree, non-main, unpushed-main and tap-fast-forward guards are
  unchanged and still mandatory.
- "Either architecture failing blocks release" cannot be satisfied while only
  one architecture can be built. The release publishes the architecture it runs
  on; the other falls back to a source build rather than shipping something
  unverified.

The release process should build both architectures, run tests and the public
audit, publish artifacts, update the tap, verify the downloaded archive, and
test installation through Homebrew.

Acceptance criteria:

- Either architecture failing blocks release.
- Formula checksums come from published artifacts.
- Published contents are verified after tagging.
- Dirty-tree and non-main guards remain mandatory.
- Each release produces an artifact/test report.

Dependencies: Tasks 9–10.

### Checkpoint: One-command installation

On clean Intel and Apple Silicon Macs:

```bash
brew install upendrasengar/jarvis/jarvis
jarvis onboard
```

There must be no compiler invocation, manual Node selection, source checkout,
manual file editing, or native-module ABI failure.

## Phase 5: Stabilize macOS permissions

### Task 12: Establish stable application identities

**Status: Complete and PROVEN for permission stability; Developer ID still
required for distribution.** `tools/signing-identity.sh` (`jarvis sign create`)
creates a self-signed code-signing identity, `install.sh` uses it when present
and warns when falling back to ad-hoc, and Doctor reports which kind of
signature the apps carry.

When first exercised end to end (2026-09-18) the mechanism did not work, in
four separate ways, each of which hid the next:

- `openssl pkcs12 -export` defaults to a SHA-256 MAC under OpenSSL 3; macOS
  verifies only SHA-1 and rejects it as `wrong password?`. The password was
  never wrong.
- `have_identity()` used `find-identity -v`, which lists only *valid*
  identities. A self-signed certificate reads `CSSMERR_TP_NOT_TRUSTED` until an
  admin marks it trusted, so a working identity was reported as missing. Trust
  governs verifying a signature, not producing one.
- `install.sh` resolved `SIGN_ID` after the two build steps that sign with it —
  under `set -u` that aborts a fresh install, and only a fresh one, because a
  rebuild skips the build branch entirely.
- `jarvis setup` could never re-sign an already-built app, so the sequence
  `jarvis sign create` itself prints was a no-op. `resign_if_stale()` fixes it.

The proof the task actually wanted: cutting a release ad-hoc re-signed both
apps and revoked Screen Recording and Microphone; restoring the identity
brought **both grants back automatically, with no re-prompting**. That is the
acceptance criterion "upgrades do not unnecessarily invalidate recording
permissions", demonstrated rather than assumed.

The distinction that matters: a Developer ID ($99/yr) is needed to hand the
apps to OTHER people without Gatekeeper warnings. Permission stability on your
own Mac needs only a stable identity, which a free certificate provides. The
keychain import is left to the owner to run deliberately.

Sign Jarvis Audio and JarvisBar with a Developer ID certificate.

Acceptance criteria:

- Bundle identifiers remain stable across releases.
- `codesign --verify` succeeds.
- Gatekeeper assessment succeeds.
- Upgrades do not unnecessarily invalidate recording permissions.
- Signing credentials exist only in the release environment.

Dependencies: Apple Developer account and release CI.

### Task 13: Notarize native artifacts

**Status: Blocked on a lapsed membership — one renewal away, not a fresh
enrolment.** Checked directly on 2026-09-18: the owner's Apple Developer
Program membership is **expired**, not absent. The account page offers Renew
rather than Enrol, and Certificates, Identifiers & Profiles is present, which
a free-tier account never shows.

What that changes: nothing technically, everything about the cost of starting.
Notarization and Developer ID certificate issuance both require an *active*
membership, so both remain closed. But this is a $99 renewal on an existing
team, not a new enrolment, and the machine already has `notarytool` and
`stapler` from Command Line Tools — full Xcode is not needed.

No Developer ID certificate exists on the machine (`security find-identity -v`
reports none), so nothing was lost when the membership lapsed and there is
nothing to salvage.

The step most likely to be missed when this is finally done: hardened runtime,
which notarization requires, **denies microphone access by default**. Without
`com.apple.security.device.audio-input` in an entitlements file, notarization
succeeds, Gatekeeper is satisfied, and recording silently dies — the same
class of failure as Task 10's ad-hoc re-signing and the obstructed default
microphone.

Acceptance criteria:

- Applications are notarized and stapled.
- Clean Macs open them without an unidentified-developer warning.
- CI verifies notarization before release.
- Failed notarization blocks publishing.

Dependencies: Task 12.

### Task 14: Improve permission onboarding

**Status: Complete.** `GET /api/permissions` asks JarvisAudio.app for its own
state, `POST /api/permissions/open` opens the exact System Settings pane, and
the onboarding Meeting-recording step shows both permissions with the reason
each is needed before offering to prompt.

- Doctor now separates granted, denied and never-requested for the microphone.
  Screen capture's preflight returns a bool, so denied and never-asked are
  reported together and labelled as such rather than guessed apart.
- Permissions are requested only when recording is enabled; Core installs
  never reach this step.
- The state is re-read on window focus, because granting happens in System
  Settings and the moment the owner returns is exactly when a cached "denied"
  becomes a lie.

Acceptance criteria:

- Permissions are requested only for enabled features.
- The UI explains each permission before prompting.
- Doctor distinguishes denied, not requested, and granted states.
- Users can open the correct System Settings pane.
- Jarvis retests permission state when the user returns.

Dependencies: Tasks 7 and 12.

## Phase 6: Optional native application

Only pursue this after Homebrew onboarding and bottles are reliable.

### Task 15: Prototype `Jarvis.app`

**Status: Substantially built as JarvisBar.app; blocked on Task 13 for its
stated success criterion.**

JarvisBar already owns server lifecycle (it starts the server when down and
stops services on quit), menu-bar state, the permission identity through
JarvisAudio, and the web interface in a native WKWebView window with its own
Dock icon and title. Setup is reachable at `/onboarding`.

What is missing is distribution, not function: the success criterion is
installing from a DMG without a Terminal, and an application that is not
notarized is refused by Gatekeeper on a machine that has never seen it. That
makes this dependent on Task 13, which needs an Apple Developer account.
Packaging a DMG before then would produce something that cannot be opened by
the people it is for.

The native app would own server lifecycle, menu-bar behavior, setup, login
startup, permission identity, updates, and opening the web interface.

Success criterion: a user installs Jarvis from a DMG without using Terminal.

### Task 16: Add a Homebrew cask

**Status: Blocked.** The first acceptance criterion is that the cask installs a
signed, notarized application, so this cannot begin before Task 13. Nothing
here is partially doable.

Target:

```bash
brew install --cask jarvis
```

Acceptance criteria:

- The cask installs a signed, notarized application.
- Uninstall and zap behavior are documented.
- User data remains unless deletion is explicitly requested.
- CLI access remains available for advanced users.

Dependencies: Task 15.

## Release strategy

Ship each user-visible increment as a patch release:

1. `jarvis doctor --json`
2. Resumable `jarvis onboard`
3. Installation profiles
4. Web onboarding
5. Prebuilt Apple Silicon bottle
6. Intel bottle
7. Signed applications
8. Notarized application and cask

Do not wait for the native application before improving the existing path.

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Intel CI availability | High | Secure an Intel runner before promising Intel support. |
| Native Node ABI drift | High | Pin Node and build native dependencies inside each release artifact. |
| macOS permissions reset | High | Use stable bundle IDs, Developer ID signing, and notarization. |
| Claude authentication cannot be automated | Medium | Detect it and guide the user through the official login. |
| Homebrew third-party trust friction | Medium | Test the fully qualified formula command and document only the shortest reliable path. |
| Setup becomes monolithic | Medium | Model onboarding as independent, resumable steps. |
| Optional integrations break core setup | Medium | Treat them as warnings and allow deferral. |
| Release pipeline becomes fragile | Medium | Add architecture builds incrementally, starting with Apple Silicon. |

## Not doing initially

- Bundling Claude Code or its credentials
- Replacing Homebrew immediately
- Docker-based installation
- Automatic recording enablement or consent handling
- Migrating existing user data without confirmation
- Linux or Windows support
- A custom auto-updater before signed native packaging exists

## Recommended first milestone

Deliver Tasks 1–5 first. This creates a materially simpler experience without
changing the distribution architecture:

```bash
brew install upendrasengar/jarvis/jarvis
jarvis onboard
```

Later phases improve speed, polish, and reliability rather than blocking first
use.
