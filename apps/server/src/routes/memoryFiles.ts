// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// Memory file editor — the markdown files in memory/ ARE Jarvis's core
// memory (the chat dispatcher loads every one of them into its system
// prompt). This gives the UI a safe read/write window onto them: flat .md
// names only, no traversal, no settings/ (that's the Settings page's job).
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { localOnly } from "../plugins/localOnly.js";
import { MEMORY_MD_DIR } from "../config.js";

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._ -]*\.md$/;

// the canonical files every install should have — offered as stubs when absent
const CANON: Record<string, string> = {
  "about-me.md":
    "# About me\n\nWho you are — name, role, team, what you work on. Jarvis reads this\nfile (and every other .md here) at the start of every conversation.\n",
  "active-projects.md":
    "# Active projects\n\nOne line per project the daily digest should scan:\n\n- ~/path/to/repo — what it is\n",
  "HEARTBEAT.md":
    "# Jarvis heartbeat\n\nChecklist the background pulse runs. Message ONLY when something\nneeds attention right now; otherwise reply HEARTBEAT_OK.\n",
};

function safePath(name: string): string | null {
  if (!NAME_RE.test(name) || name.includes("..")) return null;
  const p = path.join(MEMORY_MD_DIR, name);
  return path.dirname(p) === MEMORY_MD_DIR ? p : null;
}

export function memoryFileRoutes(app: FastifyInstance) {
  app.get("/api/memory", async () => {
    let files: string[] = [];
    try { files = fs.readdirSync(MEMORY_MD_DIR).filter((f) => f.endsWith(".md")); } catch {}
    const existing = files.sort().map((name) => {
      const st = fs.statSync(path.join(MEMORY_MD_DIR, name));
      return { name, size: st.size, updated: st.mtimeMs, missing: false };
    });
    const missing = Object.keys(CANON)
      .filter((n) => !files.includes(n))
      .map((name) => ({ name, size: 0, updated: 0, missing: true }));
    return [...existing, ...missing];
  });

  app.get("/api/memory/file", async (req, reply) => {
    const { name } = req.query as { name?: string };
    const p = name && safePath(name);
    if (!p) return reply.code(400).send({ error: "bad name" });
    try { return { md: fs.readFileSync(p, "utf8") }; }
    catch { return { md: CANON[name!] ?? "" }; }
  });

  app.post("/api/memory/file", { preHandler: localOnly }, async (req, reply) => {
    const b = z.object({ name: z.string(), md: z.string().max(200_000) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "bad request" });
    const p = safePath(b.data.name);
    if (!p) return reply.code(400).send({ error: "bad name" });
    fs.mkdirSync(MEMORY_MD_DIR, { recursive: true });
    fs.writeFileSync(p, b.data.md);
    return { ok: true };
  });
}
