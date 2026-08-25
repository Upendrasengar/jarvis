// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { SettingsPatch } from "@jarvis/shared";
import { patchSettings, readSettings, setVoiceListening, voicesInfo } from "../services/settings.js";
import { localOnly } from "../plugins/localOnly.js";
import { voiceActive } from "../live/liveState.js";
import { calendarState, fetchDay, refreshCalendar } from "../integrations/calendar.js";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { JARVIS_DIR, VAULT_DIR } from "../config.js";
import { tokenStats } from "../services/tokens.js";

export function settingsRoutes(app: FastifyInstance) {
  app.get("/api/settings", async () => readSettings());

  app.post("/api/settings", { preHandler: localOnly }, async (req, reply) => {
    const body = SettingsPatch.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "bad request" });
    return patchSettings(body.data);
  });

  app.get("/api/voices", async () => voicesInfo());

  // the call watcher polls this: live socket presence OR recent heartbeat
  app.get("/api/voicestate", async () => ({ listening: voiceActive() }));

  // optional calendar adapter — { enabled:false } when not configured
  app.get("/api/tokens", async () => tokenStats());
  app.get("/api/vault", async () => ({
    dir: VAULT_DIR,
    default: path.join(os.homedir(), "Jarvis"),
  }));

  // set the vault path. Legacy install → run the migrator. Already on the
  // vault → accept a new pointer ONLY when the tree already exists there
  // (i.e. the user moved the folder themselves; we never move it under a
  // running server). Server restarts itself to pick the new path up.
  app.post("/api/vault", { preHandler: localOnly }, async (req, reply) => {
    const b = z.object({ path: z.string().min(2).max(500) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "bad request" });
    const target = b.data.path.replace(/^~(?=$|\/)/, os.homedir());
    if (VAULT_DIR) {
      if (path.resolve(target) === path.resolve(VAULT_DIR))
        return { ok: true, note: "already the active vault" };
      if (!fs.existsSync(path.join(target, "Calls")))
        return reply.code(400).send({
          error: "that folder doesn't contain a Jarvis vault (no Calls/) — move your current vault folder there first, then set the path",
        });
      fs.writeFileSync(path.join(JARVIS_DIR, "memory", "settings", "vault-dir.txt"), target + "\n");
    } else {
      const r = await new Promise<number>((resolve) => {
        const c = spawn("/bin/bash", [path.join(JARVIS_DIR, "tools", "migrate-vault.sh"), target],
          { cwd: JARVIS_DIR, stdio: "ignore" });
        c.on("exit", (code) => resolve(code ?? 1));
        c.on("error", () => resolve(1));
      });
      if (r !== 0) return reply.code(500).send({ error: "migration failed — run `jarvis vault` in a terminal to see why" });
    }
    // restart AFTER the response flushes so the new path takes effect
    setTimeout(() => {
      spawn("/bin/bash", [path.join(JARVIS_DIR, "tools", "services.sh"), "restart"],
        { cwd: JARVIS_DIR, detached: true, stdio: "ignore" }).unref();
    }, 1500);
    return { ok: true, note: "vault set — Jarvis is restarting to pick it up (a few seconds)" };
  });

  app.get("/api/calendar", async () => calendarState());
  app.post("/api/calendar/refresh", { preHandler: localOnly }, async () => refreshCalendar());
  // workers' calendar tool: any single day, fetched live from the feed
  app.get("/api/calendar/day", async (req, reply) => {
    const { date } = req.query as { date?: string };
    const r = await fetchDay(date ?? "");
    return r.ok ? r : reply.code(400).send(r);
  });

  app.post("/api/voicestate", { preHandler: localOnly }, async (req, reply) => {
    const body = z.object({ listening: z.boolean() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "bad request" });
    return setVoiceListening(body.data.listening);
  });
}
