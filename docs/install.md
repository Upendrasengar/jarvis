# Jarvis Installation Contract

## Product promise

Jarvis supports Apple Silicon and Intel Macs that run the current stable macOS
major release or either of the previous two. A Core installation should finish
in under five minutes, require no manual file editing, start a healthy local
server, and preserve user data across upgrades.

Calendar, recording, transcription, Obsidian, Telegram, menu-bar controls, and
background services are optional. Declining any of them must not prevent Core
from working.

See [Support Matrix](support-matrix.md) for the complete boundary and test
matrix.

## Current installation path

The current released flow is:

```bash
brew tap upendrasengar/jarvis
brew trust upendrasengar/jarvis
brew install jarvis
jarvis init
jarvis start
```

This works, but it does not yet satisfy the final installation contract: it
has multiple setup commands, performs build work during installation, and
configures optional capabilities separately.

## Target installation path

The planned supported flow is:

```bash
brew install upendrasengar/jarvis/jarvis
jarvis onboard
```

`jarvis onboard` is the resumable entry point for first run and later
integration setup. Use `jarvis onboard --non-interactive` for automation; set
`JARVIS_ONBOARD_NAME` and optionally `JARVIS_ONBOARD_ROLE` and
`JARVIS_ONBOARD_FOCUS` when a local profile does not exist yet.

## Definition of installed

Installation is successful only when all of the following are true:

1. `jarvis doctor` reports no blocked Core checks.
2. Claude Code is installed and authenticated.
3. The engine and production web assets are present.
4. User-owned state lives under `~/.jarvis`, outside the Homebrew cellar.
5. The Jarvis server starts using the Node runtime matching its native modules.
6. `GET /api/health` returns an `ok` response.
7. The local dashboard loads.
8. Re-running onboarding or upgrading does not overwrite user configuration,
   vault content, reports, recordings, secrets, or runtime data.

An optional capability that is skipped, unavailable, or incorrectly
configured must be reported separately from Core health.

## Installation profiles

Choose a profile with `jarvis onboard --profile <name>`:

- **Core:** assistant, memory, and dashboard
- **Meetings:** Core plus calendar, recording, and transcription
- **Full:** Meetings plus Obsidian, Telegram, and background jobs

Core is the default recommendation for the first successful launch. Optional
capabilities can be added later by rerunning onboarding with a larger profile;
existing user files and already-completed steps are preserved.

## Responsibility boundaries

Jarvis owns:

- Installing and validating its engine
- Keeping user data outside package-managed directories
- Selecting a compatible Node/native-module combination
- Starting and health-checking its local server
- Explaining optional downloads before starting them
- Guiding macOS permission setup without enabling recording by default
- Producing actionable failures rather than raw stack traces

The user owns:

- Installing Homebrew under the initial distribution strategy
- Providing and authenticating a Claude Code account
- Granting macOS permissions when an optional feature needs them
- Obtaining legally required consent before recording calls
- Supplying credentials for optional external integrations

## Timing and size measurement

The five-minute target begins immediately before the Jarvis Homebrew command
and ends when `/api/health` is healthy and the dashboard is available. It
assumes Homebrew and an authenticated Claude Code installation already exist.

Release verification records:

- CPU architecture and macOS major version
- Cold Homebrew download size attributable to Jarvis and dependencies
- Optional model download sizes separately
- Time to install the package
- Time spent in onboarding
- Time from start request to a healthy API

Core download has an initial ceiling of 500 MB. Optional speech models do not
count toward that ceiling, but their exact size must be shown before download.

## Upgrade contract

An upgrade may replace the engine and rebuild package-managed artifacts. It
must not silently change or delete anything under the user's data directories.
Any required data migration must be explicit, backed up, reversible where
practical, and verified before the old representation is removed.

## Implementation roadmap

The ordered work and acceptance criteria are maintained in the
[One-Command Installation Plan](installation-simplification-plan.md).
