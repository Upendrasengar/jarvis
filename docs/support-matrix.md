# Jarvis Support Matrix

This document defines the installation support contract. It is deliberately
version-relative so the policy remains useful when Apple ships a new macOS
release.

## Supported Macs

| Dimension | Supported | Notes |
|---|---|---|
| CPU | Apple Silicon and Intel | The Mac must support one of the supported macOS releases. |
| macOS | Current stable major release and the previous two major releases | Beta releases are unsupported. |
| Install type | Homebrew | Source installs remain available for development but are not the consumer success path. |
| Homebrew state | Already installed | Installing Homebrew itself is outside Jarvis's five-minute target. |
| Claude Code | Installed and authenticated | Jarvis detects missing or unauthenticated Claude Code and gives one clear remediation. |
| User account | Standard macOS user | Administrator approval may still be required by Homebrew or macOS. |
| Network | Internet access during installation | Jarvis must continue working locally after installation except where an integration inherently needs the network. |

“Intel support” does not mean every Intel Mac ever sold. It means Intel Macs
that Apple allows to run one of the three supported macOS major releases.

## Capability tiers

### Required for a successful Core installation

- Jarvis engine and CLI are installed.
- Claude Code is present and authenticated.
- Private state exists under `~/.jarvis`.
- The production web application is present.
- The local server starts and `/api/health` returns `ok`.
- The dashboard opens locally.
- A restart does not lose user configuration.

### Optional capabilities

These may be skipped without making installation fail:

- Calendar feed
- Call recording and transcription
- Whisper model download
- Obsidian and its CLI
- Telegram
- Background service / start at login
- Menu-bar controls

An optional capability can report `not configured` or `unavailable`; it must
not turn an otherwise healthy Core installation into a failure.

## Performance targets

The targets below apply after Homebrew and Claude Code are already installed
and Claude Code is authenticated.

| Metric | Target |
|---|---|
| Core installation and onboarding | Under 5 minutes on a typical broadband connection |
| Commands required | One install command, then `jarvis onboard` |
| Manual file edits | Zero |
| Core download | At most 500 MB; optional models are disclosed and counted separately |
| First healthy start after installation | Under 30 seconds |
| Repeat onboarding | Safe and idempotent |

Release verification must record actual elapsed time and download size. A
release that exceeds a target may ship only when the release notes call out
the regression and a follow-up is assigned.

## Tested scenarios

Every release intended to change installation behavior must verify:

1. Clean Apple Silicon installation.
2. Clean Intel installation.
3. Upgrade from the immediately previous Jarvis version.
4. Existing `~/.jarvis` data survives upgrade byte-for-byte except for an
   explicitly documented migration.
5. Missing Claude Code produces a guided failure rather than a stack trace.
6. Installed but unauthenticated Claude Code produces a guided login step.
7. Skipping every optional capability still produces a healthy Core install.
8. Interrupted onboarding resumes without duplicating state or services.

If an Intel runner is unavailable, the release is not certified for Intel;
documentation must not imply that it was tested.

## Unsupported configurations

- macOS beta releases
- macOS versions older than the previous two major releases
- Macs that cannot run a supported macOS release
- Linux and Windows
- Docker-based installs
- Homebrew running under an emulation architecture different from the host
- Manually mixed Node/native-module installations

Source installs are supported for contributors on a best-effort basis, but
they are not held to the five-minute consumer installation target.
