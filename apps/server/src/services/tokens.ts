// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// Token accounting — read-side only. Every claude CLI invocation Jarvis makes
// (chat, workers, digest, triage, call notes, heartbeat, telegram) writes a
// transcript JSONL under ~/.claude/projects/<dir-slug>/ with per-message
// usage. This service aggregates those files into per-day / per-model
// numbers with an estimated cost. Incremental: a file is re-parsed only when
// its size or mtime changes. Caveat: the transcripts are Claude Code's
// files — a format change there means a touch-up here.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { JARVIS_DIR } from "../config.js";

// $/1M tokens: [input, output, cacheWrite, cacheRead] — estimates, matched
// by substring so minor model-id changes keep working
const PRICES: Array<[RegExp, [number, number, number, number]]> = [
  [/opus/i, [15, 75, 18.75, 1.5]],
  [/sonnet/i, [3, 15, 3.75, 0.3]],
  [/haiku/i, [1, 5, 1.25, 0.1]],
];

type Bucket = { in: number; out: number; cacheWrite: number; cacheRead: number; turns: number; cost: number };
const zero = (): Bucket => ({ in: 0, out: 0, cacheWrite: 0, cacheRead: 0, turns: 0, cost: 0 });

type FileAgg = { mtimeMs: number; size: number; days: Record<string, Record<string, Bucket>> };
const fileCache = new Map<string, FileAgg>();

function slug(dir: string): string {
  return dir.replace(/[/.]/g, "-");
}

function costOf(model: string, b: { in: number; out: number; cacheWrite: number; cacheRead: number }): number {
  const p = PRICES.find(([re]) => re.test(model))?.[1] ?? [3, 15, 3.75, 0.3];
  return (b.in * p[0] + b.out * p[1] + b.cacheWrite * p[2] + b.cacheRead * p[3]) / 1_000_000;
}

function parseFile(file: string): Record<string, Record<string, Bucket>> {
  const days: Record<string, Record<string, Bucket>> = {};
  let txt = "";
  try { txt = fs.readFileSync(file, "utf8"); } catch { return days; }
  for (const line of txt.split("\n")) {
    if (!line.includes('"usage"')) continue;
    let j: any;
    try { j = JSON.parse(line); } catch { continue; }
    const u = j?.message?.usage;
    if (!u || typeof u.output_tokens !== "number") continue;
    const model = j.message.model ?? "unknown";
    // local calendar day
    const ts = j.timestamp ? new Date(j.timestamp) : new Date();
    const day = ts.toLocaleDateString("sv-SE");
    const byModel = (days[day] ??= {});
    const b = (byModel[model] ??= zero());
    const inc = {
      in: u.input_tokens ?? 0,
      out: u.output_tokens ?? 0,
      cacheWrite: u.cache_creation_input_tokens ?? 0,
      cacheRead: u.cache_read_input_tokens ?? 0,
    };
    b.in += inc.in; b.out += inc.out; b.cacheWrite += inc.cacheWrite; b.cacheRead += inc.cacheRead;
    b.turns += 1;
    b.cost += costOf(model, inc);
  }
  return days;
}

export function tokenStats() {
  const dir = path.join(os.homedir(), ".claude", "projects", slug(JARVIS_DIR));
  let files: string[] = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl")).map((f) => path.join(dir, f)); }
  catch { return { days: [], totals: zero(), byModel: {}, note: "no transcripts found" }; }

  const merged: Record<string, Record<string, Bucket>> = {};
  for (const f of files) {
    let st: fs.Stats;
    try { st = fs.statSync(f); } catch { continue; }
    let agg = fileCache.get(f);
    if (!agg || agg.mtimeMs !== st.mtimeMs || agg.size !== st.size) {
      agg = { mtimeMs: st.mtimeMs, size: st.size, days: parseFile(f) };
      fileCache.set(f, agg);
    }
    for (const [day, models] of Object.entries(agg.days))
      for (const [model, b] of Object.entries(models)) {
        const t = ((merged[day] ??= {})[model] ??= zero());
        t.in += b.in; t.out += b.out; t.cacheWrite += b.cacheWrite; t.cacheRead += b.cacheRead;
        t.turns += b.turns; t.cost += b.cost;
      }
  }

  const totals = zero();
  const byModel: Record<string, Bucket> = {};
  const days = Object.entries(merged)
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, models]) => {
      const d = zero();
      for (const [model, b] of Object.entries(models)) {
        d.in += b.in; d.out += b.out; d.cacheWrite += b.cacheWrite; d.cacheRead += b.cacheRead;
        d.turns += b.turns; d.cost += b.cost;
        const m = (byModel[model] ??= zero());
        m.in += b.in; m.out += b.out; m.cacheWrite += b.cacheWrite; m.cacheRead += b.cacheRead;
        m.turns += b.turns; m.cost += b.cost;
      }
      totals.in += d.in; totals.out += d.out; totals.cacheWrite += d.cacheWrite;
      totals.cacheRead += d.cacheRead; totals.turns += d.turns; totals.cost += d.cost;
      return { date, ...d };
    });

  return { days, totals, byModel };
}
