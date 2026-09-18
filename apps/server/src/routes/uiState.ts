// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// Owner-scoped UI state. See services/uiState.ts for why this is not
// localStorage.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { localOnly } from "../plugins/localOnly.js";
import { readUiState, patchUiState } from "../services/uiState.js";

const Patch = z.object({
  theme: z.enum(["dark", "light", "system"]).optional(),
  session: z.string().min(8).max(64).regex(/^[0-9a-zA-Z-]+$/).optional(),
  voice: z.enum(["on", "off"]).optional(),
});

export function uiStateRoutes(app: FastifyInstance) {
  app.get("/api/ui-state", async () => readUiState());

  app.post("/api/ui-state", { preHandler: localOnly }, async (req, reply) => {
    const body = Patch.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "bad request" });
    return patchUiState(body.data);
  });
}
