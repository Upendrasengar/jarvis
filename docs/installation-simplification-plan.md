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

Store only non-secret progress under `memory/settings/`. Credentials remain in
`secrets/.env`.

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

Offer three profiles:

- **Core:** assistant, memory, and dashboard
- **Meetings:** Core plus calendar, recording, and transcription
- **Full:** Meetings plus Obsidian, Telegram, and background jobs

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

Expose non-secret setup status and narrowly scoped configuration endpoints.

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

Artifacts should contain installed production dependencies, the Vite build,
compiled Swift binaries, JarvisBar, Jarvis Audio, and Node/native-ABI metadata.

Acceptance criteria:

- Installation does not run pnpm, Vite, or `swiftc`.
- Artifacts contain no user data or secrets.
- Pre-push audit passes.
- Jarvis boots directly from the extracted artifact.

Dependencies: Phase 2 complete.

### Task 10: Publish architecture-specific Homebrew bottles

Produce bottles for Apple Silicon and Intel.

Acceptance criteria:

- Homebrew downloads a bottle instead of compiling.
- Installation passes on the supported macOS matrix.
- `better-sqlite3` loads with the packaged Node runtime.
- `brew upgrade` preserves `~/.jarvis`.
- Formula tests run Doctor and boot a sandbox server.

Dependencies: Task 9.

### Task 11: Automate release validation

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

Sign Jarvis Audio and JarvisBar with a Developer ID certificate.

Acceptance criteria:

- Bundle identifiers remain stable across releases.
- `codesign --verify` succeeds.
- Gatekeeper assessment succeeds.
- Upgrades do not unnecessarily invalidate recording permissions.
- Signing credentials exist only in the release environment.

Dependencies: Apple Developer account and release CI.

### Task 13: Notarize native artifacts

Acceptance criteria:

- Applications are notarized and stapled.
- Clean Macs open them without an unidentified-developer warning.
- CI verifies notarization before release.
- Failed notarization blocks publishing.

Dependencies: Task 12.

### Task 14: Improve permission onboarding

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

The native app would own server lifecycle, menu-bar behavior, setup, login
startup, permission identity, updates, and opening the web interface.

Success criterion: a user installs Jarvis from a DMG without using Terminal.

### Task 16: Add a Homebrew cask

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
