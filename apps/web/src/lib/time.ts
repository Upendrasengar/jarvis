// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
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

// Call stamps arrive as "YYYY-MM-DD HH:MM" — the ledger used to slice(0, 10)
// and print the raw ISO day, which reads like a database row and throws the
// clock away. These turn one stamp into the two things a human actually
// scans: which day, and what time that day.
export function dayLabel(stamp: string, now = new Date()): string {
  const day = stamp.slice(0, 10);
  const [y, m, d] = day.split("-").map(Number);
  if (!y || !m || !d) return day || "Undated";
  const then = new Date(y, m - 1, d);
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((midnight.getTime() - then.getTime()) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff === -1) return "Tomorrow";
  const base = then.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  return then.getFullYear() === now.getFullYear() ? base : `${base} ${then.getFullYear()}`;
}

// "2026-09-19 14:30" → "14:30"; "" when the stamp carries no clock
export function clock(stamp: string): string {
  const m = stamp.match(/^\d{4}-\d{2}-\d{2}[ T](\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : "";
}

// the unambiguous form, for title= tooltips over a relative label
export function fullStamp(stamp: string): string {
  const day = stamp.slice(0, 10);
  const [y, m, d] = day.split("-").map(Number);
  if (!y || !m || !d) return stamp;
  const long = new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
  const t = clock(stamp);
  return t ? `${long} at ${t}` : long;
}

// "10 days ago" — the context a bare weekday can't carry once the ledger runs
// back weeks. Empty inside two days, where dayLabel already says Today/Yesterday.
export function daysAgo(stamp: string, now = new Date()): string {
  const [y, m, d] = stamp.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return "";
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const n = Math.round((midnight.getTime() - new Date(y, m - 1, d).getTime()) / 86_400_000);
  return n < 2 ? "" : `${n} days ago`;
}
