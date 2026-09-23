// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// Finding the YAML frontmatter block of a note.
//
// Every reader here used to test `md.startsWith("---\n")` on its own. That is
// correct for a well-formed note and wrong for every note the generator fumbles,
// in two ways it fumbles regularly:
//
//   1. A PREAMBLE before the fence. The model is asked to emit only a note and
//      sometimes opens with an aside anyway ("One flag before the note: …").
//      A byte-0 test then finds no frontmatter, and the whole YAML header is
//      handed to the prose renderer — title:, type:, participants: and all,
//      dumped on screen as body text.
//   2. An UNTERMINATED block — the opening --- with no closing one. Same
//      outcome for the same reason.
//
// Both are recoverable, and recovering them in one place is the point: three
// services and two components read frontmatter, and five copies of the rule
// are five chances to drift.
export type Frontmatter = {
  /** Character offset of the opening `---`, or -1 when there is no frontmatter. */
  start: number;
  /** The YAML text between the fences, without the fences. "" when absent. */
  block: string;
  /** Everything that is not frontmatter — a preamble, if any, stays attached. */
  body: string;
};

/**
 * Offset of the opening fence. Normally 0; greater when a preamble precedes it.
 *
 * The fence is the first bare `---` line IMMEDIATELY followed by a YAML key.
 * A `---` used as a horizontal rule has a blank line or prose under it, so it
 * never qualifies — which is what keeps this from eating a note's real content.
 */
export function frontmatterStart(md: string): number {
  if (md.startsWith("---\n")) return 0;
  const m = md.match(/(^|\n)---\n(?=[A-Za-z][\w-]*:)/);
  return m?.index === undefined ? -1 : m.index + m[1].length;
}

export function parseFrontmatter(md: string): Frontmatter {
  const start = frontmatterStart(md);
  if (start < 0) return { start: -1, block: "", body: md };
  const pre = md.slice(0, start);
  const rest = md.slice(start);

  const closed = rest.match(/^---\n([\s\S]*?)\n---\n?/);
  if (closed) return { start, block: closed[1], body: pre + rest.slice(closed[0].length) };

  // Unterminated: the YAML runs until the note body starts — its H1 or its
  // summary callout. Without this the unclosed block renders as prose.
  const body = rest.search(/^(#|> )/m);
  if (body > 0) return { start, block: rest.slice(4, body).replace(/\n+$/, ""), body: pre + rest.slice(body) };

  return { start: -1, block: "", body: md };
}
