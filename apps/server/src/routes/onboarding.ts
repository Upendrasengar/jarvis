// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// Onboarding API (plan Task 6) — the browser flow's view of setup progress.
//
// Reads are open to the dashboard; every mutation is localOnly and Zod-checked,
// and every mutation is safe to repeat. Marking a completed step complete again
// is a no-op, which is what makes the flow resumable rather than fragile.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { InstallationProfile } from "@jarvis/shared";
import { localOnly } from "../plugins/localOnly.js";
import {
  onboardingStatus, onboardingSteps, setStep, writeProfile,
} from "../services/onboarding.js";

export function onboardingRoutes(app: FastifyInstance) {
  app.get("/api/onboarding", async () => onboardingStatus());

  app.post("/api/onboarding/step", { preHandler: localOnly }, async (req, reply) => {
    const steps = await onboardingSteps();
    const body = z.object({
      // validated against the CLI's own list rather than a copy of it
      step: z.enum(steps as [string, ...string[]]),
      status: z.enum(["complete", "incomplete"]).default("complete"),
    }).safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: `step must be one of: ${steps.join(", ")}` });
    }
    try {
      return await setStep(body.data.step, body.data.status);
    } catch (e) {
      return reply.code(400).send({ error: String(e instanceof Error ? e.message : e).slice(0, 160) });
    }
  });

  app.post("/api/onboarding/profile", { preHandler: localOnly }, async (req, reply) => {
    const body = z.object({ profile: InstallationProfile }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "profile must be core, meetings or full" });
    writeProfile(body.data.profile);
    return onboardingStatus();
  });
}
