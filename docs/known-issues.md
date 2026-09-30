# Known issues

Observed, not yet fixed. One entry per issue: what was seen, where it comes
from, and what a fix would have to touch. Delete an entry when it ships.

_2026-09-19 entries shipped 2026-09-22; Mac-app bugs 2026-09-23 and 2026-09-30._

## Fixed

### 2026-09-22 — "One sentence:" leaked onto the screen on delegate turns

Three prompts described the SHAPE of the opening line ("ONE sentence that
orients the reader"), so the model sometimes emitted the description as a
label. Fixed on both sides:

- Wording no longer reads as a prefix —
  `packages/shared/src/replyFormat.ts`, `apps/server/src/services/chatSessions.ts`.
- `stripLeadingLabel()` (`packages/shared/src/actionJson.ts`) cuts a leaked
  label anyway, applied where the other channel markers already are:
  `splitChannels()` in `agents.ts`, the web transport's `visible()`, and
  Telegram's `onDone`. Wording is a request; the stripper is the guarantee.

### 2026-09-22 — "busy — finishing previous turn" repeated and ate the message

The original note guessed the composer needed to refuse the send. It already
did (`useChatStream` gates on `streaming`). The real trigger was a SECOND
caller on the same session — the header voice bar and `workerDelivery`, which
retries — racing the chat page. `streamChatTurn` returned the error string as
its reply, and `workerDelivery` appended that string as a Jarvis bubble, once
per retry.

- Messages now QUEUE server-side (`MAX_QUEUE = 3`) instead of being dropped;
  the SSE stream stays open and the real reply arrives on it. A queued turn's
  round budget starts when it starts, not when it joined the queue.
- Callers opt in. A scheduled heartbeat (`reminders.ts`) deliberately does
  NOT: a nudge that arrives mid-turn is better skipped than delivered stale.
- `queued` is an SSE event, surfaced as composer text ("queued · finishing the
  current turn") — never a bubble.
- `workerDelivery` drops a `⚠️` reply instead of posting it: an invisible turn
  has no business putting its failures in the transcript.

### 2026-09-22 — frontmatter rendered as prose when a note had a preamble

`call-notes-2026-09-22-0903.md` opened with a model aside before the `---`, so
every reader's byte-0 test missed the block and dumped the YAML header on
screen. Generator now strips any preamble (`tools/process-call.sh`, kept at
`<session>/notes-preamble.md`) and rejects a note that does not open with
`---`. Readers route through one tolerant parser, `parseFrontmatter()` in
`packages/shared/src/frontmatter.ts` — previously five byte-0 tests in five
files. No-speech stubs now carry real frontmatter too.

Covered by `apps/server/test/noteFormat.test.ts`.

### 2026-09-23 — ⌘V did nothing in the Mac app

`jarvisbar.swift` never set `NSApp.mainMenu`. macOS dispatches the standard
editing shortcuts as MENU key equivalents, so with no Edit menu ⌘V/⌘C/⌘X/⌘A
had nothing to route to and never reached the WKWebView. Browsers have their
own paste path, which is why it only failed in the app.

Fixed by installing a real App/Edit/Window menu (items target nil → responder
chain → the web view). ⌘Q is wired to the existing `quit()` so it still stops
services rather than plain-terminating.

Also set `isInspectable = true` on the WKWebView. Since macOS 13.3 a WKWebView
is invisible to Safari's Web Inspector unless it opts in — which is why an
app-only bug could not be looked at. Safari → Develop → your Mac → Jarvis.

### 2026-09-23 — the ✕ on a pasted image did nothing in the Mac app

The "Channel open" empty-state splash (`ChatPage.tsx`) is an absolutely
positioned overlay at `z-10` spanning `top-0` to `bottom-[120px]`, with no
`pointer-events-none`. A pending image preview sits inside that band, so its
remove button painted above the splash but hit-tested below it.

App-only for a reason worth remembering: `jarvisbar.swift` sets
`cfg.websiteDataStore = .nonPersistent()`, so localStorage is discarded every
launch and `loadTranscript()` always returns empty. The app therefore ALWAYS
renders the empty state, while a browser with history never does. **Any bug
that only reproduces in the app is worth checking against this first** — the
app is permanently in a first-run state the browser rarely sees.

Fixed with `pointer-events-none` on the splash and `pointer-events-auto` on
the quick-prompt buttons.

### 2026-09-30 — the app lost your conversation on every launch

`jarvisbar.swift` used `WKWebsiteDataStore.nonPersistent()`, so localStorage
was thrown away at every launch. `loadTranscript()` reads localStorage, so the
app opened with an empty chat every time while a browser on the same machine
kept its history. It also made the app permanently first-run, which is what
hid the pointer-events bug above.

It was non-persistent because a cached bundle once kept the dashboard hours
out of date. That is the server's job and the server does it — every response
carries `cache-control: no-store`, index.html and hashed assets alike — so
there was nothing cacheable left to go stale, and the workaround was pure
cost. Now `.default()`, shared by the dashboard and the ask-bar.

## Open

### 2026-09-30 — a recording auto-started again right after a manual stop

**Seen:** a Firefox call auto-recorded. Mic muted mid-call, call ended, mic
unmuted, recording stopped by hand — and a new recording started immediately
with no call in progress.

**Where it comes from:** `tools/call-watch.sh:399`. Firefox has no tab URL to
read, so a sustained mic hold IS the signal on its own:

```bash
elif ! voice_listening && [ -n "$(firefox_mic_pid)" ]; then
  firefox_hits=$((firefox_hits + 1))
  if [ "$firefox_hits" -ge 2 ]; then start_recording "Firefox (browser)" firefox
```

Leaving a meeting does not reliably make Firefox release the mic — a "you left
the meeting" page, a tab still open with the permission live, or a slow
teardown all keep the handle. After the manual stop the watcher returns to
idle, sees the mic still held for two consecutive polls (30s), and concludes a
new call has begun. The rule is working as written; the rule is too weak.

Every other detector has a corroborating signal — Teams desktop checks that
Teams holds the mic, Teams web needs a Teams tab AND a mic hold. Firefox has
only the mic, so anything holding it for 30s looks like a meeting.

**The mute is a red herring.** `mic_muted()` is consulted in exactly two
places, the silence check (`:426`) and the device probe (`:302`). It does not
gate detection, so muting cannot start a recording. It may have mattered only
for timing: mute expires after an hour and the Firefox stop rule has a 60s
grace, so the sequence lands in the window where the watcher re-arms.

**A fix would have to:** refuse to auto-start within N seconds of a MANUAL
stop — stopping by hand is an explicit "no", and restarting seconds later
contradicts it — and/or require a longer sustained hold before re-arming after
any recording ends. Owner asked to leave it until it recurs.

## Notes for whoever reads this next

- `apps/server/test` has 19 failing tests that need a server on :4321. They
  fail identically on a clean checkout — they are integration tests without a
  fixture, not a regression.
