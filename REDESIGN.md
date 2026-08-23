# Redesign execution plan — branch `redesign`

Working copy: this worktree (`jarvis-redesign/`, port **4500**) with a
snapshot of real data — production (`jarvis/`, port 4400) stays on `main`
and is never touched until final merge. Review = both dashboards side by
side in the browser.

Source of truth for direction: `docs/design-brief.md` + the approved
"Jarvis Redesign v2" mockup (claude.ai design project). No new features
during the redesign — visual/structural only; feature ideas from the
mockup go to the backlog at the bottom.

## Ground rules

- Tokens land first (one foundation commit), then one commit per screen.
- After every screen: `tsc --noEmit` + `vite build` pass, BOTH themes
  eyeballed at :4500, screenshot pair saved to `docs/redesign-shots/`.
- Owner reviews each screen before the next begins. ~~Strikethrough~~ =
  decided; unchecked = awaiting owner decision.
- Merge to `main` only when every adopted screen is approved. Then one
  release (brew) ships the whole redesign atomically.

## Open decisions (owner)

- [x] **D1 · Core**: DECIDED — keep the photographic eye core EXACTLY as
      is. New tokens may recolor its surroundings; the core component
      itself is untouched.
- [x] **D2 · Navigation**: DECIDED — adopt the left icon rail.
- [x] **D3 · Digest ledger grouping**: DECIDED — adopt the age buckets
      (render-time grouping; markdown files unchanged).

## Screen-by-screen matrix (recommendation → owner call)

| # | Screen | Recommendation | Required changes |
|---|--------|----------------|------------------|
| 0 | **Foundation** | ADOPT (mandatory first) | New tokens in `styles.css` (two accents: cyan=live/interactive, indigo=knowledge; surf/surf-2/elevation; both themes), Space Grotesk via fontsource (NOT the mockup's Google CDN), JS palette mirrors updated (BrainPage, HeaderVoice canvas, NeuralCore/ArcReactor) |
| 1 | **Overview** | ADOPT | Depends on D1 + D2. KPI tiles → left column instrument stack, Needs Attention with left-border accent cards, Activity feed, status footer ("LOCAL ONLY — NOTHING LEAVES THE MACHINE"), core-as-instrument |
| 2 | **Digest** | PARTIAL | New typography/surfaces + attention panel restyle; ledger structure per D3. Live checkboxes, links, titles, comments unchanged |
| 3 | **Calls** | ADOPT | Approved sidebar selection pattern (border+fill active), detail page typography on new tokens; rerun/edit/copy buttons restyled, logic untouched |
| 4 | **Chat** | PARTIAL | Bubbles, citation chips, input bar on new tokens; typewriter + delegation untouched |
| 5 | **Brain** | PARTIAL | Panel/controls restyle + indigo knowledge accent; WebGL palette mirror update. Mockup's "Selected Node inspector" = backlog, not now |
| 6 | **Actions** | PARTIAL | Rows/chips/strip on new tokens, one-accent rule holds; grouping and toggle logic untouched |
| 7 | **Notes** | ADOPT | Sidebar selection pattern + editor typography; contentEditable behavior untouched |
| 8 | **Projects** | ADOPT | Cards on new surfaces, status toggle restyled |
| 9 | **Settings** | PARTIAL | Section rhythm, topics chips on new tokens |
| 10 | **Header/voice bar** | ADOPT | Follows D2; wake-word/waveform behavior + canvas colors mirrored, functionality untouched |

## Backlog (mockup ideas that are FEATURES, not restyling — post-merge)

- "Draft the agenda" action on meeting rows
- Brain "Selected Node" inspector panel
- Ledger-load number fed live into the core (needs a small API aggregate)
- Global search bar in header

## Status log

- [x] 0 Foundation (644dac1)
- [x] 1 Overview + rail shell — APPROVED (58223c2)
- [x] 2 Digest — APPROVED (f128de8)
- [x] 3 Calls — APPROVED (35fff81)
- [x] 4 Chat — APPROVED (514fc41)
- [x] 5 Brain — APPROVED (2e1c352)
- [x] 6 Actions — APPROVED (feb0194..2616feb + mock-match iterations)
- [x] 7 Notes — AWAITING OWNER REVIEW
- [ ] 8 Projects
- [ ] 9 Settings
- [ ] 10 Header/voice
