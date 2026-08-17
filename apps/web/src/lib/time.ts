// Time helpers — relative "ago" strings and parsing the [YYYY-MM-DD HH:MM]
// stamps the server prefixes onto action-item comments.
export function ago(ms: number): string {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function parseStamp(text: string): { when: number | null; stamp: string; text: string } {
  const m = text.match(/^\[(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})\]\s*(.*)$/);
  if (!m) return { when: null, stamp: "", text };
  const when = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime();
  return { when, stamp: `[${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}] `, text: m[6] };
}
