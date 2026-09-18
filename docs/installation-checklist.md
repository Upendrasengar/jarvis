# One-Command Installation Checklist

This is the progress tracker for the
[one-command installation plan](installation-simplification-plan.md). Update
it in the same commit whenever work completes, changes scope, or becomes
blocked.

- **Last updated:** 2026-09-18
- **Current task:** Task 10 — Publish architecture-specific Homebrew bottles
- **Completed:** 9 of 16 tasks

## Phase 1: Installation contract

- [x] **Task 1 — Define supported Macs and success criteria**
  - [x] Record the supported hardware and macOS policy.
  - [x] Separate Core health from optional capabilities.
  - [x] Define installation time and download-size targets.
  - [x] Define clean-install and upgrade verification scenarios.
  - Evidence: [Installation Contract](install.md) and
    [Support Matrix](support-matrix.md).
- [x] **Task 2 — Make Doctor machine-readable**
  - [x] Add `jarvis doctor --json`.
  - [x] Classify checks as `pass`, `warning`, `blocked`, or `optional`.
  - [x] Give every failure one actionable remediation.
  - [x] Prove output contains no secret values.
  - [x] Preserve the existing human-readable output.
  - Evidence: `tools/tests/doctor-json.test.sh` exercises blocked and
    configured temporary installs, validates the schema, and checks secret
    canaries do not appear in either output stream.

## Phase 2: Resumable onboarding

- [x] **Task 3 — Introduce onboarding state**
  - [x] Store only non-secret progress.
  - [x] Resume at the first incomplete step.
  - [x] Recognize existing installations.
  - Evidence: `tools/test-onboarding-state.mjs` verifies clean and
    existing installations, step completion and revisiting, upgrade-safe
    reads, schema allowlisting, and rejection of credential-like fields.
- [x] **Task 4 — Add the `jarvis onboard` CLI wizard**
  - [x] Check the system and Claude Code.
  - [x] Configure the user profile and offer optional modules.
  - [x] Start Jarvis and verify `/api/health`.
  - [x] Resume safely after interruption.
  - Evidence: `tools/test-onboard.sh` covers clean non-interactive setup,
    idempotent reruns, interruption/resume, and an unauthenticated Claude CLI.
- [x] **Task 5 — Add installation profiles**
  - [x] Core profile
  - [x] Meetings profile
  - [x] Full profile
  - [x] Allow optional modules to be added later.
  - Evidence: `tools/test-onboard.sh` verifies profile selection and display,
    Core isolation from recording setup, Meetings requirements, Full
    integrations, invalid selection, and additive Core-to-Meetings upgrades.

### CLI checkpoint

- [ ] Core onboarding completes against a clean temporary home.
- [ ] A second onboarding run is idempotent.
- [ ] Interrupted onboarding resumes correctly.
- [ ] Existing user data remains unchanged.
- [ ] The local server finishes healthy.

## Phase 3: Browser onboarding

- [x] **Task 6 — Create an onboarding status API**
  - [x] Expose non-secret setup status.
  - [x] Validate mutations with Zod and keep them local-only.
  - [x] Make every mutation safe to repeat.
  - [x] Report whether a secret exists, not its value.
  - [x] Identify the next recommended step.
  - Evidence: `apps/server/test/onboarding.test.ts` validates the payload
    against the shared contract, asserts no secret value or extra field
    appears, rejects unknown steps and profiles without writing them, and
    proves a repeated mutation changes nothing.
- [x] **Task 7 — Build `/onboarding`**
  - [x] Guided flow over the Task 6 API.
  - [x] Works in light and dark themes (palette tokens only).
  - [x] Keyboard navigation between steps.
  - [x] Required and optional steps are clearly distinguished.
  - [x] Sensitive inputs are never collected or redisplayed.
  - [x] Calendar proves the connection with safe status only.
  - [x] Completion opens the normal overview.
  - Evidence: `GET /api/doctor` returns the same 23 checks as the CLI;
    `/onboarding` serves; calendar shows fetch time and event count only.
- [x] **Task 8 — Route incomplete installs into onboarding**
  - [x] Fresh installs enter onboarding.
  - [x] Existing installs continue opening normally.
  - [x] Settings reopens onboarding.
  - [x] Failed optional integrations never trap the user.
  - Evidence: `apps/server/test/onboarding.test.ts` proves an incomplete
    optional step leaves `setupComplete` true while an incomplete required
    step forces it false; this install reports `setupComplete: true` and is
    not redirected.

### Browser checkpoint

- [ ] Complete onboarding on a clean macOS account.
- [ ] Verify start at login.
- [ ] Upgrade and confirm settings and permissions survive.

## Phase 4: Prebuilt distribution

- [x] **Task 9 — Produce prebuilt engine artifacts**
  - [x] Installation does not run pnpm, Vite, or `swiftc`.
  - [x] Artifacts contain no user data or secrets.
  - [x] Pre-push audit passes.
  - [x] Jarvis boots directly from the extracted artifact.
  - Evidence: `tools/build-artifact.sh` produced a 15 MB arm64/ABI-127
    archive; the extracted copy served `/api/health` with no build tooling
    present; the archive contains no `memory/`, `reports/`, `brain/`, `data/`,
    `secrets/`, `models/` or `.git`; the ABI guard refuses a mismatched
    runtime and stays silent on a matching one.
- [ ] **Task 10 — Publish architecture-specific Homebrew bottles**
  - [ ] Apple Silicon bottle
  - [ ] Intel bottle
  - [ ] Upgrade preservation test
  - [ ] Formula sandbox-boot test
- [ ] **Task 11 — Automate release validation**
  - [ ] Build and test both architectures.
  - [ ] Audit tracked files.
  - [ ] Verify published archive contents and checksums.
  - [ ] Test installation through the tap.

### Distribution checkpoint

- [ ] One install command works on a clean Apple Silicon Mac.
- [ ] One install command works on a clean Intel Mac.
- [ ] Installation invokes no compiler or manual Node selection.
- [ ] Installation requires no source checkout or file editing.

## Phase 5: macOS permissions

- [ ] **Task 12 — Establish stable application identities**
  - [ ] Sign Jarvis Audio.
  - [ ] Sign JarvisBar.
  - [ ] Verify stable bundle identifiers.
  - [ ] Keep signing credentials only in release infrastructure.
- [ ] **Task 13 — Notarize native artifacts**
  - [ ] Notarize and staple applications.
  - [ ] Verify Gatekeeper acceptance on a clean Mac.
  - [ ] Block releases when notarization fails.
- [ ] **Task 14 — Improve permission onboarding**
  - [ ] Request permissions only for enabled features.
  - [ ] Explain each permission before prompting.
  - [ ] Distinguish denied, not requested, and granted states.
  - [ ] Retest after returning from System Settings.

## Phase 6: Optional native application

- [ ] **Task 15 — Prototype `Jarvis.app`**
  - [ ] Own server and menu-bar lifecycle.
  - [ ] Own setup, permissions, and start at login.
  - [ ] Prove installation from a DMG without Terminal.
- [ ] **Task 16 — Add a Homebrew cask**
  - [ ] Install the signed and notarized application.
  - [ ] Document uninstall and zap behavior.
  - [ ] Preserve user data unless deletion is explicitly requested.
  - [ ] Retain CLI access for advanced users.

## Completion log

| Date | Task | Commit | Evidence |
|---|---|---|---|
| 2026-09-18 | Task 1 — Installation contract | `d0a3ee5` | `docs/install.md`, `docs/support-matrix.md` |
| 2026-09-18 | Task 2 — Machine-readable Doctor | This commit | `tools/doctor.sh`, `tools/tests/doctor-json.test.sh` |
| 2026-09-18 | Task 3 — Resumable onboarding state | This commit | `tools/onboarding-state.mjs`, `tools/test-onboarding-state.mjs` |
| 2026-09-18 | Task 4 — Resumable CLI wizard | This commit | `tools/onboard.sh`, `tools/test-onboard.sh` |
| 2026-09-18 | Task 5 — Installation profiles | This commit | `tools/onboard.sh`, `tools/doctor.sh`, `tools/test-onboard.sh` |

## Update rule

For every installation-related change:

1. Check off only acceptance criteria verified with evidence.
2. Add the completion commit and evidence to the log.
3. Update **Current task**, **Completed**, and **Last updated**.
4. Record partial progress under the relevant task; do not mark the task done.
5. Commit the checklist update with the implementation it describes.
