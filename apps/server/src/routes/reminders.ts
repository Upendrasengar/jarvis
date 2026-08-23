// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { localOnly } from "../plugins/localOnly.js";
import { createReminder, deleteReminder, listReminders, toggleReminder } from "../integrations/reminders.js";

const Schedule = z.union([
  z.object({ kind: z.literal("at"), at: z.string().min(10) }),
  z.object({ kind: z.literal("cron"), expr: z.string().min(9) }),
  z.object({ kind: z.literal("every"), everyMs: z.number().int().min(60_000) }),
]);
const Payload = z.union([
  z.object({ kind: z.literal("message"), text: z.string().min(1).max(2000) }),
  z.object({ kind: z.literal("agentTurn"), prompt: z.string().min(1).max(8000) }),
]);
const CreateBody = z.object({
  name: z.string().min(1).max(120),
  schedule: Schedule,
  payload: Payload.optional(),
  // shorthand the chat ACTION uses: message instead of payload
  message: z.string().min(1).max(2000).optional(),
});

export function reminderRoutes(app: FastifyInstance) {
  app.get("/api/reminders", async () => listReminders());

  app.post("/api/reminders", { preHandler: localOnly }, async (req, reply) => {
    const b = CreateBody.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "bad request" });
    const payload = b.data.payload ?? (b.data.message ? { kind: "message" as const, text: b.data.message } : null);
    if (!payload) return reply.code(400).send({ error: "payload or message required" });
    try {
      return createReminder({ name: b.data.name, schedule: b.data.schedule, payload });
    } catch (e: any) {
      return reply.code(400).send({ error: e?.message ?? "create failed" });
    }
  });

  app.post("/api/reminders/:id/delete", { preHandler: localOnly }, async (req) => {
    const { id } = req.params as { id: string };
    return { ok: deleteReminder(id) };
  });

  app.post("/api/reminders/:id/toggle", { preHandler: localOnly }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const j = toggleReminder(id);
    return j ?? reply.code(404).send({ error: "no such reminder" });
  });
}
