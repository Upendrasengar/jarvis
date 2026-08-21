// Attention ranking — deterministic scoring over open action items, fed by
// two signal sources: code-computed facts (age, comment recency, token-level
// duplicate clusters) and the nightly Sonnet triage annotations (paraphrase
// clusters, resolved deadlines, blocked flags, reasons). The LLM annotates;
// this module ranks — same order on every render of a given day.
// Priority per the owner's rule: overdue beats everything, then MY items,
// then everyone else's.
import { buildClusters, idKey, type ActionLike, type Cluster } from "./actionClusters";
import { parseStamp } from "./time";

export type Triage = {
  generatedAt: string | null;
  clusters: string[][];
  deadlines: Record<string, string>;
  blocked: Record<string, string>;
  reasons: Record<string, string>;
};

export type Chip = { kind: "overdue" | "due" | "age" | "recur" | "blocked" | "me"; label: string };
export type Ranked = {
  item: ActionLike;
  cluster: ActionLike[];       // all instances (>=1; >1 means duplicates)
  score: number;
  chips: Chip[];
  reason?: string;
};

const DAY = 86_400_000;
const isMe = (owner: string) => /^me$/i.test(owner.trim());

function daysBetween(fromISO: string, to: Date): number {
  const [y, m, d] = fromISO.slice(0, 10).split("-").map(Number);
  if (!y) return 0;
  return Math.floor((to.getTime() - new Date(y, m - 1, d, 12).getTime()) / DAY);
}

// merge token-level clusters (verbatim dupes) with triage clusters
// (paraphrases) via union-find over both edge sets
function mergedClusters(actions: ActionLike[], triage: Triage | undefined) {
  const open = actions.filter((a) => !a.done && a.text);
  const byKey = new Map(open.map((a) => [idKey(a), a]));
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    let r = k;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let c = k;
    while (parent.get(c) !== c) { const n = parent.get(c)!; parent.set(c, r); c = n; }
    return r;
  };
  for (const a of open) parent.set(idKey(a), idKey(a));
  const union = (a: string, b: string) => {
    if (parent.has(a) && parent.has(b)) parent.set(find(a), find(b));
  };
  for (const c of buildClusters(actions).clusters)
    for (let i = 1; i < c.items.length; i++) union(idKey(c.items[0]), idKey(c.items[i]));
  for (const ids of triage?.clusters ?? [])
    for (let i = 1; i < ids.length; i++) union(ids[0], ids[i]);

  const groups = new Map<string, ActionLike[]>();
  for (const a of open) {
    const r = find(idKey(a));
    (groups.get(r) ?? groups.set(r, []).get(r)!).push(a);
  }
  const byId = new Map<string, ActionLike[]>();
  for (const items of groups.values())
    if (items.length >= 2) for (const a of items) byId.set(idKey(a), items);
  return { open, byId, byKey };
}

export function rankAttention(
  actions: ActionLike[],
  triage: Triage | undefined,
  now = new Date(),
): { ranked: Ranked[]; dupeIds: Set<string>; clusterOf: (a: ActionLike) => ActionLike[] | undefined } {
  const { open, byId } = mergedClusters(actions, triage);
  const seen = new Set<string>();
  const ranked: Ranked[] = [];

  for (const a of open) {
    const key = idKey(a);
    if (seen.has(key)) continue;
    const cluster = byId.get(key) ?? [a];
    for (const c of cluster) seen.add(idKey(c));
    // canonical = newest phrasing
    const item = [...cluster].sort((x, y) => y.callStarted.localeCompare(x.callStarted))[0];

    const chips: Chip[] = [];
    let score = 0;
    const deadline = cluster.map((c) => triage?.deadlines[idKey(c)]).find(Boolean);
    if (deadline) {
      const over = daysBetween(deadline, now);
      if (over > 0) { score += 1000 + Math.min(over, 14) * 12; chips.push({ kind: "overdue", label: `overdue ${over}d (was ${deadline.slice(5)})` }); }
      else if (over >= -2) { score += 320; chips.push({ kind: "due", label: over === 0 ? "due today" : `due ${deadline.slice(5)}` }); }
      else chips.push({ kind: "due", label: `due ${deadline.slice(5)}` });
    }
    if (isMe(item.owner)) { score += 220; chips.push({ kind: "me", label: "yours" }); }
    const blocked = cluster.map((c) => triage?.blocked[idKey(c)]).find(Boolean);
    if (blocked) { score += 160; chips.push({ kind: "blocked", label: blocked }); }
    if (cluster.length > 1) {
      score += 60 * cluster.length;
      chips.push({ kind: "recur", label: `raised ${cluster.length}×` });
    }
    const age = Math.max(...cluster.map((c) => daysBetween(c.callStarted, now)));
    if (age >= 2) { score += Math.min(age, 14) * 9; chips.push({ kind: "age", label: `open ${age}d` }); }
    // actively-worked items (fresh comment) need less attention
    const lastComment = cluster
      .flatMap((c) => (c.comments ?? []).map((t: string) => parseStamp(t).when ?? 0))
      .reduce((m, w) => Math.max(m, w), 0);
    if (lastComment && now.getTime() - lastComment < 2 * DAY) score -= 60;

    const reason = cluster.map((c) => triage?.reasons[idKey(c)]).find(Boolean);
    if (reason) score += 40;
    ranked.push({ item, cluster, score, chips, reason });
  }

  ranked.sort((x, y) => y.score - x.score);
  const dupeIds = new Set(byId.keys());
  return {
    ranked,
    dupeIds,
    clusterOf: (a) => byId.get(idKey(a)),
  };
}

// the bucket shown in the digest: scarce by design
export function attentionBucket(ranked: Ranked[], cap = 6): Ranked[] {
  return ranked.filter((r) => r.score >= 220).slice(0, cap);
}
