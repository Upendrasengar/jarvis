// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { SettingsPatch } from "@jarvis/shared";
import { patchSettings, readSettings, setVoiceListening, voicesInfo } from "../services/settings.js";
import { localOnly } from "../plugins/localOnly.js";
import { voiceActive } from "../live/liveState.js";
import { calendarState } from "../integrations/calendar.js";

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
  app.get("/api/calendar", async () => calendarState());

  app.post("/api/voicestate", { preHandler: localOnly }, async (req, reply) => {
    const body = z.object({ listening: z.boolean() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "bad request" });
    return setVoiceListening(body.data.listening);
  });
}
