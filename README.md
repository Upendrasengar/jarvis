# Jarvis

A personal AI agent that lives on your Mac, powered by [Claude Code](https://claude.com/claude-code).
It watches your projects, records and summarizes your calls (fully locally),
remembers what you tell it, and briefs you every morning — through a
dashboard, voice, or the terminal.

**Everything private stays on your machine.** Call audio is transcribed
locally with whisper.cpp and never uploaded. Your memory, notes, reports, and
recordings live in gitignored directories. The only thing that leaves your
Mac is text sent to Claude via your own Claude Code login — the same as any
Claude Code session.

## What it does

- **Daily Project Digest** — every morning: what moved across your repos,
  what's uncommitted and at risk, and a carry-forward ledger of every open
  action item — items persist until checked off, with live checkboxes right
  in the digest. Each digest chains on the previous one, so it knows what's
  *still* stalled and for how long.
- **Needs-Attention triage** — a nightly pass annotates open items with
  resolved deadlines ("by Thursday" → a date), blocked/blocking flags, and
  duplicate clusters across meetings; the digest and dashboard lead with a
  ranked bucket (overdue → yours → blocking → repeated → aging), and one
  checkbox completes an item in every call it was raised in.
- **Call Notes** — detects meetings (Google Meet, Teams desktop/web, Zoom,
  Webex in browser tabs), records both sides, transcribes locally
  (multilingual), and writes Copilot-style minutes with named speaker
  attribution and action items. Your team roster (from memory) fixes
  phonetically mangled names; with the calendar adapter, the matching
  event's attendee list is offered as an attribution hint.
- **Knowledge graph** — every call and note is tagged with [[topic]]
  wikilinks into a controlled vocabulary; a 3D Obsidian-style graph (with
  search, filters, forces, per-vault toggles) shows how your meetings and
  themes connect, and clicking a node briefs you from its whole cluster.
- **Second-Brain Recall** — ask "what do I know about X?" and it answers from
  your own Obsidian vaults and its growing knowledge base, with source
  chips linking every answer back to the calls and notes it used.
- **Actions inbox** — one unified list of every open action item across all
  calls and notes, with comments, recurrence badges, and one-click
  completion.
- **Voice** — wake-word ("Jarvis"), conversation mode, or push-to-talk, from
  any page of the dashboard.
- **Chat with workers** — delegate coding or research tasks; Jarvis spawns
  background Claude agents and delivers results back into the conversation.
- **Telegram** — `jarvis telegram` connects a bot bound to your chat only:
  message Jarvis from your phone, get worker results pushed back.
- **Calendar (optional adapter)** — set `CALENDAR_FEED_URL` in
  `secrets/.env` to any ICS feed (Google/Outlook secret address) or a JSON
  endpoint (e.g. a Power Automate flow), and Jarvis gains an agenda-style
  Today board with one-click meeting prep (previous related calls, open
  items, the invite's stated agenda), meetings in the daily digest, and
  calendar hints for call attribution. Unset = the feature doesn't exist.
- **Projects** — a card per project (from your projects vault) with search
  and an active/inactive toggle: paused projects leave the graph and the
  digest scan until you flip them back.

## Requirements

- **macOS** (ScreenCaptureKit and CoreAudio power the call recording — this
  is Mac-only)
- **[Claude Code](https://claude.com/claude-code)** with your own account —
  Jarvis's brain; the CLI must be on your PATH (`claude --version`)
- Node 20+ and pnpm
- ffmpeg + whisper.cpp (`brew install ffmpeg whisper-cpp`)

## Quickstart

Homebrew (recommended):

```bash
# optional but recommended: Obsidian — the best UI for your Jarvis vault
# (Jarvis writes plain markdown either way; jarvis setup links Obsidian's CLI
# for fast indexed search when the app is installed)
brew install --cask obsidian

brew tap upendrasengar/jarvis
brew trust upendrasengar/jarvis   # newer Homebrew requires trusting third-party taps once
brew install jarvis
jarvis init && jarvis start     # → http://localhost:4321 · data in ~/.jarvis
```

From source:

```bash
git clone https://github.com/upendrasengar/jarvis && cd jarvis
./install.sh          # checks deps, builds audio helpers, downloads a whisper model
./jarvis init         # a short interview: who you are, which repos to watch
./jarvis start        # server + call watcher → http://localhost:4321
```

`jarvis init` writes `memory/` from your answers (edit `memory/*.md` anytime
— it's all plain markdown). Or skip it and just open the dashboard and talk.

`./jarvis doctor` diagnoses a broken setup; `./jarvis` opens a terminal
session; `./jarvis digest` runs the morning brief on demand.

## Upgrading and uninstalling

`jarvis upgrade` updates to the latest release and restarts (brew or git,
it figures it out). `jarvis uninstall` removes everything honestly: stops
services, removes the login agent, asks before touching your data, and
finishes with the package itself.

## Consent, privacy, and recording laws

Call recording is **off by default**. When you enable it, recording is *not*
announced to other participants the way native Meet/Teams recording is —
obtaining consent is **your** responsibility, and recording laws vary by
jurisdiction (some require all-party consent). Audio never leaves your
machine and is purged after a configurable retention window (default 7
days); transcripts and notes are yours, in plain markdown.

## Architecture

pnpm monorepo: React dashboard (`apps/web`) + Fastify server (`apps/server`)
sharing zod contracts (`packages/shared`), over a set of deliberately plain
shell tools (`tools/`) that do the deterministic work — detection, recording,
scanning — with LLM calls reserved for judgement and prose. Markdown files
are the source of truth; SQLite is just a rebuildable index. The Claude
integration is embedded in the server (it spawns your local `claude` CLI —
no API keys, no gateway service). See `docs/jarvis_architecture.md`.

Config lives in `memory/settings/` as one-value-per-file text files —
readable by both TypeScript and shell. See `memory.example/settings/README.md`.

## License

MIT · Built by [Upendra Sengar](https://github.com/Upendrasengar)
