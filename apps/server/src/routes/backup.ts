// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// Backup & migrate — one zip carrying everything personal: memory/, reports/
// (notes, digests, transcripts — raw call AUDIO is excluded, it's heavy and
// re-purged anyway), data/ (reminders, triage, calendar cache, db), the
// brain vault when it lives inside the repo, and secrets/.env (the zip is
// labeled loudly — it contains API keys). Import merges the same dirs back
// via rsync: zip contents win on conflicts, extra local files survive.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { FastifyInstance } from "fastify";
import { localOnly } from "../plugins/localOnly.js";
import { BRAIN_DIR, JARVIS_DIR, VAULT_DIR } from "../config.js";

const DIRS = ["memory", "reports", "data", "secrets"];
const EXCLUDES = [
  "*.wav", "*.m4a", "*.mp3", "*.flac",     // raw call audio
  "*.log", "*.tmp",
  "jarvis.db-shm", "jarvis.db-wal",        // live sqlite side files
];

export function backupRoutes(app: FastifyInstance) {
  // raw zip uploads for import
  app.addContentTypeParser("application/zip", { parseAs: "buffer", bodyLimit: 1024 * 1024 * 1024 },
    (_req, body, done) => done(null, body));

  app.get("/api/backup/export", { preHandler: localOnly }, async (_req, reply) => {
    const stamp = new Date().toLocaleDateString("sv-SE");
    const out = path.join(os.tmpdir(), `jarvis-backup-${stamp}-${Date.now()}.zip`);
    const include = DIRS.filter((d) => fs.existsSync(path.join(JARVIS_DIR, d)));
    // the brain vault rides along only when it lives inside the repo —
    // an external Obsidian vault is the owner's own synced property
    const brainInside = BRAIN_DIR.startsWith(JARVIS_DIR + path.sep);
    if (brainInside && fs.existsSync(BRAIN_DIR)) include.push(path.relative(JARVIS_DIR, BRAIN_DIR));

    const r = spawnSync("zip", ["-r", "-q", out, ...include, ...EXCLUDES.flatMap((e) => ["-x", `*/${e}`, e])],
      { cwd: JARVIS_DIR, timeout: 120_000 });
    if (r.status !== 0 || !fs.existsSync(out))
      return reply.code(500).send({ error: `zip failed: ${String(r.stderr).slice(0, 200)}` });
    // vault mode: the knowledge tree lives outside JARVIS_DIR — append it
    if (VAULT_DIR && fs.existsSync(VAULT_DIR)) {
      const vdirs = ["Calls", "Notes", "Digests", "Topics", "Memory"].filter((d) => fs.existsSync(path.join(VAULT_DIR!, d)));
      const r2 = spawnSync("zip", ["-r", "-q", out, ...vdirs], { cwd: VAULT_DIR, timeout: 120_000 });
      if (r2.status !== 0)
        return reply.code(500).send({ error: "zip failed on vault tree" });
    }

    reply.header("Content-Type", "application/zip");
    reply.header("Content-Disposition", `attachment; filename="jarvis-backup-${stamp}.zip"`);
    const stream = fs.createReadStream(out);
    stream.on("close", () => { try { fs.rmSync(out, { force: true }); } catch {} });
    return reply.send(stream);
  });

  app.post("/api/backup/import", { preHandler: localOnly }, async (req, reply) => {
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || body.length < 100)
      return reply.code(400).send({ error: "send the backup zip as the request body (application/zip)" });

    const staging = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-import-"));
    const zipPath = path.join(staging, "backup.zip");
    fs.writeFileSync(zipPath, body);
    try {
      const un = spawnSync("unzip", ["-o", "-q", zipPath, "-d", staging], { timeout: 120_000 });
      if (un.status !== 0) return reply.code(400).send({ error: "not a readable zip" });

      const merged: Record<string, number> = {};
      for (const d of fs.readdirSync(staging)) {
        if (d === "backup.zip") continue;
        const src = path.join(staging, d);
        if (!fs.statSync(src).isDirectory()) continue;
        // only known top-level dirs are merged — a hostile zip can't write
        // outside them, and rsync keeps extra local files
        const VDIRS = ["Calls", "Notes", "Digests", "Topics", "Memory"];
        if (![...DIRS, "brain", ...VDIRS].includes(d)) continue;
        if (VDIRS.includes(d) && !VAULT_DIR)
          return reply.code(400).send({ error: "this backup uses the vault layout — run `jarvis vault` here first, then import again" });
        const dst = VDIRS.includes(d) ? path.join(VAULT_DIR!, d) : path.join(JARVIS_DIR, d);
        fs.mkdirSync(dst, { recursive: true });
        const rs = spawnSync("rsync", ["-a", src + "/", dst + "/"], { timeout: 120_000 });
        if (rs.status === 0) {
          let count = 0;
          const walk = (p: string) => { for (const f of fs.readdirSync(p, { withFileTypes: true })) f.isDirectory() ? walk(path.join(p, f.name)) : count++; };
          try { walk(src); } catch {}
          merged[d] = count;
        }
      }
      return { ok: true, merged, note: "restart Jarvis to pick everything up: jarvis restart" };
    } finally {
      try { fs.rmSync(staging, { recursive: true, force: true }); } catch {}
    }
  });
}
