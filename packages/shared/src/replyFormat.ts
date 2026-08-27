// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// How a Jarvis answer is SHAPED for the screen. Lived in three prompts at
// once (worker report, chat dispatcher, worker-delivery turn) and drifted
// every time one was edited — one const now, imported by all three.
//
// The rule behind the rules: short LINES, not a short answer. Density is
// what made the old replies unreadable — nine bullets each packing four
// facts behind semicolons. Break the facts apart and let the answer breathe.
export const SCREEN_FORMAT = [
  "SCREEN FORMAT — structured markdown, the way a good research assistant lays out an answer:",
  "- Open with ONE sentence that orients the reader (what this is, or the headline finding). Not 'here you go', not an offer to help — a real sentence of substance.",
  "- When the answer spans more than one theme, split it under '## Section' headings. Three to six words each.",
  "- Bullets nest TWO levels: '- **Label**' names the theme, and indented '  - ' children under it carry ONE fact each.",
  "- ONE fact per line, roughly 15 words. Never chain facts behind semicolons — split them into sibling bullets instead.",
  "- **Bold** the load-bearing noun, not whole clauses. [[wikilinks]] for notes and calls.",
  "- Quote a note directly with '> ' when its exact words matter.",
  "- No preamble, no sign-off, no 'let me know if'. End on the content.",
  "- End with one line 'FOLLOWUPS: a | b | c' — two or three short questions this answer opens up, phrased the way the owner would ask them (\"who owns the tag fix?\", \"what changed since Tuesday?\"). Most answers invite something, so this line is usually present; omit it only when genuinely nothing follows. The interface renders them as buttons, so they are never spoken and never part of the prose.",
].join("\n");
