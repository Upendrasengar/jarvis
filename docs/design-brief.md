# Jarvis UI Redesign Brief

You are redesigning the UI of **Jarvis** — a personal AI agent dashboard
(React + Tailwind v4 + Fastify, in this repo) — toward a more premium,
aesthetic feel **without breaking any functionality**. Reference screenshots
of the current app are provided alongside this brief.

## What this product is (design from the subject, not a template)

Jarvis is a personal AI *operator console*: it records and transcribes the
owner's work calls locally, distills daily digests with a triaged
"needs attention" ledger, maintains a 3D knowledge graph of topics/calls/
notes ("KRONOS · Second Brain"), shows today's meetings, and hosts a chat
with a voice wake-word surface. The emotional register: a calm, competent
chief-of-staff with an Iron-Man-adjacent soul — **precision instrument, not
sci-fi cosplay**. The existing identity to respect and refine, not erase:

- Dual theme via a single `html.light` class flip; dark is the hero theme
- The Overview's central "neural core" (photographic eye + HUD rings) is the
  signature element — elevate it, don't replace it
- Monospace chrome labels (`A-01 · TODAY'S FOCUS`) give it its console
  character; content is proportional type

## Hard functional invariants — breaking any of these fails the task

1. **No behavior changes.** Every route, click, toggle, checkbox, editable
   line, and keyboard interaction works exactly as before. You are changing
   presentation only. If a refactor is needed for styling, the rendered DOM
   behavior must be equivalent.
2. **Design tokens live in `apps/web/src/styles.css`** as CSS variables
   (`--bg`, `--panel`, `--cyan`, `--text`, `--dim`, `--node-*` etc.), with a
   dark block (`:root`) and a light block (`html.light`). Components use
   Tailwind arbitrary values (`bg-[var(--panel)]`). Extend/refine the token
   set; do not inline theme colors in components.
3. **The 3D brain graph and voice waveform cannot read CSS variables** —
   their palettes are mirrored in JS (`BrainPage.tsx` `palette()`,
   `HeaderVoice.tsx` canvas colors, `NeuralCore/ArcReactorCore`). If you
   change the palette, update BOTH sides and keep the light/dark mirror.
4. **Rendering is XSS-safe by construction**: markdown renderers build React
   elements (`Markdown.tsx`, `NotesView.tsx`) — never introduce
   `dangerouslySetInnerHTML` or innerHTML with data.
5. **Keep these functional components' contracts intact** (restyle freely):
   live ledger checkboxes + attention panel in `DigestPage`, contentEditable
   line editing in `NotesView`, source-citation chips in chat, prep-me rows
   on the Today board, project active/inactive toggles, the graph control
   panel, Settings (voice modes, topics manager).
6. **No heavy new dependencies.** Fonts are self-hosted via fontsource
   (currently Roboto + Roboto Mono); if you propose a different pairing it
   must also be fontsource-installable and license-clean. No CDN calls —
   this app promises "nothing leaves the machine."
7. `pnpm exec tsc --noEmit` and `pnpm exec vite build` (in `apps/web`) must
   pass after every page you touch. Verify BOTH themes for every screen.
8. Respect `localStorage` keys and query hooks as-is.

## Design lessons already learned in this codebase (do not regress)

- **Chrome ≠ content.** Small tracked mono caps for labels/nav; sentences
  (digest items, notes, chat) in proportional type ≥12.5px with relaxed
  leading and real contrast. Never render reading material in 10px mono gray.
- **One accent per row.** We removed "chip soup" (multiple bordered pills +
  emoji per fact) in favor of a single colored urgency word plus one quiet
  metadata line. Status through visual weight, not labels ("over" → faded).
- **Light theme is a first-class citizen** — hardcoded dark-neon alphas made
  panels invisible on white before; use tokens with per-theme values.

## What "premium" should mean here (direction, not prescription)

- **Depth and materials**: current panels are flat translucent rectangles.
  Consider a consistent elevation system (subtle layered blur, hairline
  borders, a restrained glow reserved for live/recording states only).
- **Typographic hierarchy** doing more work than boxes: fewer borders, more
  space, deliberate scale contrast between KPI numerals, titles, and meta.
- **Motion with intent**: state changes (recording start, item checked,
  meeting going live) deserve one crisp orchestrated transition each;
  ambient motion stays in the neural core. Respect `prefers-reduced-motion`.
- **The signature moment**: the Overview core + KPI band is the first
  impression — make it feel like a mission console powering on, not a grid
  of cards. Spend your boldness there; keep data pages disciplined.
- Consider refining the accent system: the single cyan works, but a premium
  feel may come from a narrower, deeper palette (e.g., cyan reserved for
  interactive/live, a warmer neutral scale for structure) — your call, but
  commit to a system and apply it everywhere.

## Process

1. Audit the provided screenshots + run the app (`bash tools/services.sh
   start`, port from `memory/settings/port.txt`) and click through every
   page in both themes before changing anything.
2. Write your token system first (colors, type scale, spacing, elevation,
   motion) as a short proposal in `docs/design-notes.md`; then apply it
   page by page: Overview → Digest → Calls → Chat → Brain → Actions →
   Notes → Projects → Settings.
3. Screenshot-compare each page in both themes as you go; typecheck + build
   after each page; commit per page with a message describing the intent.
4. Anything ambiguous: prefer the smaller change. This is a refinement of a
   loved tool, not a rebrand.
