// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createNote, deleteNote, listNotes, readNote, updateNote } from "../services/notes.js";
import { localOnly } from "../plugins/localOnly.js";

export function noteRoutes(app: FastifyInstance) {
  app.get("/api/notes", async () => listNotes());

  app.get("/api/notes/:id", async (req, reply) => {
    const r = readNote((req.params as { id: string }).id);
    if ("error" in r) return reply.code(404).send(r);
    return r;
  });

  app.post("/api/notes", { preHandler: localOnly }, async (req, reply) => {
    const b = z.object({ title: z.string().min(1).max(120), call: z.string().optional() })
      .safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "bad request" });
    const r = createNote(b.data.title, b.data.call);
    if ("error" in r) return reply.code(400).send(r);
    return r;
  });

  app.post("/api/notes/:id", { preHandler: localOnly }, async (req, reply) => {
    const b = z.object({ md: z.string().min(1).max(400_000) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "bad request" });
    const r = updateNote((req.params as { id: string }).id, b.data.md);
    if ("error" in r) return reply.code(400).send(r);
    return r;
  });

  app.post("/api/notes/:id/delete", { preHandler: localOnly }, async (req, reply) => {
    const r = deleteNote((req.params as { id: string }).id);
    if ("error" in r) return reply.code(400).send(r);
    return r;
  });
}
