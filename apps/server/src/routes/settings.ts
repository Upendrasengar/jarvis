// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { SettingsPatch } from "@jarvis/shared";
import { patchSettings, readSettings, setVoiceListening, voicesInfo } from "../services/settings.js";
import { localOnly } from "../plugins/localOnly.js";
import { voiceActive } from "../live/liveState.js";
import { calendarState, fetchDay, refreshCalendar } from "../integrations/calendar.js";
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
