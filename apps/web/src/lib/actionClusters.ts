// Recurring-item detection: the same real-world task raised in multiple
// calls produces near-duplicate action items. Deterministic clustering —
// normalized token overlap + union-find — so the grouping is identical on
// every render and never depends on an LLM's mood.
export type ActionLike = {
  callId: string; index: number; owner: string; text: string;
  done: boolean; callTitle: string; callStarted: string;
  comments: string[];
};
export type Cluster = { key: string; canonical: ActionLike; items: ActionLike[] };

export const idKey = (a: ActionLike) => `${a.callId}|${a.index}`;

const STOP = new Set([
  "the","a","an","to","of","and","or","for","with","on","in","re","about",
  "that","this","is","are","be","it","as","at","by","from","up","out","into",
  "if","then","than","so","we","our","my","me","their","them","they","can",
  "will","should","need","needs","once","get","via","per",
]);

function tokens(t: string): Set<string> {
  return new Set(
    t.toLowerCase().replace(/\*\*/g, "").replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)),
  );
}

// similar when most meaningful words overlap (Jaccard) OR one phrasing is
// contained in a longer one (short "push claims branch" vs the full sentence)
function similar(a: Set<string>, b: Set<string>): boolean {
  if (a.size < 2 || b.size < 2) return false;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  const jaccard = inter / (a.size + b.size - inter);
  const containment = inter / Math.min(a.size, b.size);
  return jaccard >= 0.6 || (containment >= 0.75 && inter >= 3);
}

export function buildClusters(actions: ActionLike[]): {
  clusters: Cluster[];
  byId: Map<string, Cluster>;
} {
  const open = actions.filter((a) => !a.done && a.text);
  const tk = open.map((a) => tokens(a.text));
  const parent = open.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));

  for (let i = 0; i < open.length; i++)
    for (let j = i + 1; j < open.length; j++) {
      if (open[i].callId === open[j].callId) continue;   // dupes live across calls
      if (similar(tk[i], tk[j])) parent[find(i)] = find(j);
    }

  const groups = new Map<number, ActionLike[]>();
  open.forEach((a, i) => {
    const r = find(i);
    (groups.get(r) ?? groups.set(r, []).get(r)!).push(a);
  });

  const clusters: Cluster[] = [];
  const byId = new Map<string, Cluster>();
  for (const items of groups.values()) {
    if (items.length < 2 || new Set(items.map((a) => a.callId)).size < 2) continue;
    const canonical = [...items].sort((x, y) => y.callStarted.localeCompare(x.callStarted))[0];
    const cluster: Cluster = { key: idKey(canonical), canonical, items };
    clusters.push(cluster);
    for (const a of items) byId.set(idKey(a), cluster);
  }
  clusters.sort((x, y) => y.items.length - x.items.length);
  return { clusters, byId };
}

export function shortDate(callStarted: string): string {
  const [y, m, d] = callStarted.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return callStarted.slice(0, 10);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
