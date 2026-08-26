# AGENTS.md — engineering handbook for agents working on Jarvis

You are working on the Jarvis engine. `CLAUDE.md` is the *product's* runtime
manual (instructions for Jarvis-the-assistant); THIS file is how the
*engineering agent* builds, tests, and ships it. Read both. Everything below
was learned the hard way in real sessions — follow it before improvising.

## The lay of the land

- pnpm monorepo: `apps/server` (Fastify + tsx, no build step — runs TS
  directly), `apps/web` (React 18 + Vite + Tailwind v4), `packages/shared`
  (zod schemas), `tools/` (plain bash — deterministic work never uses an LLM).
- The Homebrew tap lives in the SIBLING repo `../homebrew-jarvis`
  (`Formula/jarvis.rb` + `release.sh`).
- **Production runs from this repo on the owner's machine.** The server
  serves `apps/web/dist` statically — frontend changes are invisible until
  `vite build`. Port comes from `memory/settings/port.txt` (else 4321).
- Knowledge lives in the **unified Obsidian vault** — pointer in
  `memory/settings/vault-dir.txt`, env `JARVIS_VAULT` overrides. Layout:
  `Calls/ Notes/ Digests/ Topics/ Memory/`. Runtime state (audio, sqlite,
  logs, secrets, settings) NEVER moves into the vault — it stays under the
  repo. Path resolution is duplicated in `apps/server/src/config.ts` and
  `tools/paths.sh`; change both or they disagree.
- Legacy mode (no vault pointer) must keep working — unmigrated installs
  use `reports/` + `brain/`.

## The vault file format (native Obsidian)

Calls are `Calls/call-<YYYY-MM-DD-HHMM>.md` (older: `call-notes-<stamp>.md`
— every reader/writer must accept BOTH; see `notesFileFor()` in
`services/calls.ts`). Files carry YAML frontmatter (title/type/date/time/
duration/platform/participants/topics as `"[[X]]"`/tags), a `> [!summary]`
callout, `## sections`, `- [ ]` action items, and a `## Related` list of
`[[wikilinks]]`. Generators (`tools/process-call.sh`, `tools/run-digest.sh`)
EMIT this format; the UI (`components/Markdown.tsx`, calls `NotesView.tsx`)
renders it — frontmatter → tag chips, callouts → colored rails, wikilinks →
links. NotesView maps each rendered element to exactly one source line so
inline edits and checkbox toggles hit the right line — any new rendering
branch MUST preserve line indexes (render `null` for hidden lines, never
splice the array).

## How to make a change (the loop)

1. Edit. For the server: `cd apps/server && npx tsc --noEmit`. For the web:
   `cd apps/web && npx tsc --noEmit && pnpm exec vite build` (prod serves
   dist — no build, no change).
2. **Hard-restart** the server when server code changed. `services.sh
   restart` is unreliable (races with the menu-bar app resurrecting it):
   `lsof -ti tcp:<port> | xargs kill; pkill -f "tsx.*src/index"; sleep 2;
   bash tools/services.sh start` — then `curl /api/health` until `ok`.
3. **Verify live, never assume.** curl the actual API; open the real page in
   the browser and screenshot it; for file-mutating features, run the
   round-trip against a real vault file and diff (e.g. toggle a checkbox
   twice → file must be byte-identical; tag add+remove → identical).
   For risky changes, boot a sandbox: `JARVIS_DIR=<tmp> JARVIS_VAULT=<vault>
   JARVIS_API_PORT=4499 node node_modules/tsx/dist/cli.mjs src/index.ts`.
4. Commit with a story-telling message (what + why, like the existing log).
5. Release (below) when the owner expects it shipped — this session's
   convention: every user-visible fix ships immediately as a patch version.

## Releasing (where most past mistakes happened)

`cd ../homebrew-jarvis && bash release.sh <version>` tags the engine HEAD,
computes the tarball sha, updates the formula; then `git push` the tap AND
`git push` the engine.

Hard-won rules:
- **Never chain `cd` in the commit command.** The recurring bug: `cd
  apps/web && … && cd ..` lands in `apps/`, `git add apps/web/...` fails,
  yet release.sh happily tags the previous commit. Three releases shipped
  wrong this way. Always commit from the repo root in its own command.
- release.sh refuses a dirty tree and a non-main branch. **Do not defeat the
  guard by stashing files you just edited** — stash is only for the OWNER's
  unrelated WIP (check `git status` and read the diff first; if it isn't
  yours, stash → release → pop).
- If a tag must move: delete local + remote, retag, re-push — then **verify
  the tarball CONTENT** (download, grep for a marker from the new commit)
  before trusting any checksum. GitHub caches tag tarballs for a long time
  after a tag moves; when the cache is stale, pin the formula `url` to the
  immutable commit-hash archive (`archive/<full-sha>.tar.gz` + `version`
  line) instead of fighting it.
- After releasing, verify the running server has the change (it serves from
  the working tree, not the tag — restart if server code changed).

## Git & safety rules (standing, non-negotiable)

- Never commit with a Claude co-author trailer. Git email: noreply address.
- Secrets exist ONLY in gitignored `secrets/.env`. Workers may grep key
  NAMES (`grep -o '^[A-Z_]*=' secrets/.env`), never values. Nothing under
  the vault or repo ever holds a secret.
- Audit `git ls-files` before any public push of a new repo.
- Code workers spawned by Jarvis work on `agent/<slug>` branches, never
  main, and run `git checkout -` when done (a leftover checkout once got an
  unreviewed branch tagged into a public release).
- **No internal work names** (the owner's employer's project codenames) in
  app UI text, code, comments, prompts, or placeholders. They may appear in
  the owner's DATA (call notes render whatever the calls contain) — the
  boundary is app-authored text vs user content.
- Ask before any outward write (email, posting, pushing new repos). Digest
  and notes surface locally only.

## Design system (the console)

- Dark cyan operator-console aesthetic; light theme + system toggle exist —
  **check both themes** before calling UI done (several "fixed" screens
  broke only in light).
- Everything themes through CSS vars in `apps/web/src/styles.css`:
  `--bg --surf --surf-2 --line --line-2 --dim --text --bright --cyan
  --indigo --green --amber --red` (+ `-2`/`-3` tints). Never hardcode a
  color that has a var.
- Vocabulary: topics = indigo pills; tags = quiet mono green tokens with
  dimmed `#`; section labels = 9-10px uppercase tracking-[2px] dim; cards =
  rounded-2xl border line bg-surf.
- Hover-revealed controls must RESERVE their space (opacity swap, never
  hidden→inline) — a chip that grows on hover can wrap, lose the hover, and
  flicker forever.
- Buttons get the hand cursor globally (Tailwind v4 preflight doesn't).
- 3D graph (`BrainPage`): size from the container + ResizeObserver (never
  window); selection highlight is a pure restyle via refs — re-filtering
  re-layouts, restyling doesn't; synthetic browser clicks can't hit 3D
  nodes reliably, so click-interactions there need the owner to confirm.

## Worker doctrine (prompts in `services/agents.ts`)

- Model routing: workers run Sonnet; heartbeat runs Haiku; never burn the
  big model on mechanical work.
- The Obsidian CLI block (`OBSIDIAN_CLI_LINES`) is shared by ask + code
  workers: CLI first (`obsidian vault=<name> search/backlinks/tags/read`),
  ONE fallback to grep/`tools/vault-search.sh`, no retry loops. It needs
  the Obsidian app open. Keep it a shared const — duplicated prompt text
  drifts.
- Never let a model compute weekdays — inject the precomputed 8-day
  DATE REFERENCE map (an off-by-one here shipped a wrong meeting day).
- SELF-KNOWLEDGE rule: capability questions are answered from the LIVE
  system (data/*.json, local API, env key names), never from vault notes.
- Workers' final-stdout is the only thing in the agent log — to audit what
  a worker actually DID, read its transcript jsonl under
  `~/.claude/projects/<cwd-slug>/` and extract the tool_use entries.
- Heartbeat keeps a sent-log so fresh sessions don't re-nag (max twice/day).

## Known traps (each cost a debugging session)

- `better-sqlite3` must stay ≥12 — v11 crashes node 24 at GC.
- JarvisBar (menu-bar app) mirrors `services.sh` port precedence (port.txt
  else 4321) — a hardcoded port there caused 4 distinct symptoms. Status
  item icons need SymbolConfiguration paletteColors; contentTintColor is
  unreliable.
- Vault-mode file writes: any function writing "both copies" of a note must
  dedupe paths — in vault mode both resolve to the same file and a toggle
  applied twice is a visible no-op.
- The digest ledger's checkbox index = Nth `- [ ]` in the FILE; UI and
  server must count identically (frontmatter can't contain checkboxes).
- `/api/graph` drops singleton tags (deg<2) as noise; the brain search ANDs
  space-separated terms (`tag:x tag:y text`), and with 2+ tags neighbor
  expansion skips tag nodes or the union floods the intersection.
- GET params: `?focus=` on /brain seeds the graph search (topic chips and
  tag chips deep-link there).

## Definition of done

A change is done when: tsc clean (server AND web), vite build ran, server
hard-restarted and healthy, the feature verified against real data (curl +
browser screenshot; file round-trips diffed), both themes checked for UI,
committed from repo root with a real message, released via release.sh with
the guard passing honestly, tap + engine pushed, and — if anything odd
happened during release — the tarball content verified. If the owner
reported the bug from a screenshot, reproduce their exact view before
declaring it fixed.
