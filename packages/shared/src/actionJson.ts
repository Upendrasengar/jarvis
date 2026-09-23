// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// Locating the JSON payload of an ACTION: line.
//
// This was a non-greedy regex — /ACTION:DELEGATE\s*(\{[\s\S]*?\})/ — which
// stops at the FIRST closing brace. The moment a task quoted text containing
// "}" (a message about which characters a form rejects, say) the object was
// truncated: JSON.parse threw, the delegation was silently dropped, and the
// unstripped remainder of the payload was shown to the owner as prose.
//
// Braces have to be counted, and counted outside of JSON strings, because a
// brace inside a quoted value is data, not structure.
export type FoundAction = { json: string; start: number; end: number };

export function findAction(text: string, marker: string): FoundAction | null {
  const start = text.indexOf(marker);
  if (start < 0) return null;
  let i = start + marker.length;
  while (i < text.length && /\s/.test(text[i])) i++;
  if (text[i] !== "{") return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let k = i; k < text.length; k++) {
    const c = text[k];
    if (escaped) { escaped = false; continue; }
    if (c === "\\") { if (inString) escaped = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return { json: text.slice(i, k + 1), start, end: k + 1 };
  }
  return null;   // not balanced yet — mid-stream, or malformed
}

/**
 * The text with every ACTION payload removed. A marker whose object has not
 * closed yet takes everything after it too, so a half-streamed directive is
 * never flashed at the owner as prose.
 */
// The reply prompts describe the SHAPE of the opening line ("ONE sentence
// that orients the reader", "ONE short spoken sentence"), and a model asked
// for a shape will sometimes emit the description as a label instead:
//   One sentence: pulling next steps from that workshop note now.
// The wording is phrased to avoid this now, but wording is not a guarantee —
// so the label is also cut here, where SPOKEN:/SOURCES: are already handled.
// Anchored to the very start and to a known set of labels: a real answer that
// happens to open "Screen: ..." is not a shape a note or a reply ever takes.
const LEAKED_LABEL = /^\s*(one |a )?(short |plain |spoken |single )*(sentence|line|screen|answer|reply)\s*:[ \t]*/i;

export function stripLeadingLabel(text: string): string {
  return text.replace(LEAKED_LABEL, "");
}

export function stripActions(text: string, markers: string[]): string {
  let out = text;
  for (const marker of markers) {
    for (;;) {
      const found = findAction(out, marker);
      if (found) { out = out.slice(0, found.start) + out.slice(found.end); continue; }
      const i = out.indexOf(marker);
      if (i >= 0) { out = out.slice(0, i); }
      break;
    }
  }
  return out.trimEnd();
}
