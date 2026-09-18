// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// Onboarding API tests (plan Task 6) against the running server.
//   JARVIS_API_URL=http://localhost:4400 pnpm server:test
//
// The acceptance criterion that actually matters here is the last one: this
// endpoint sits next to secrets and must never return their values. Everything
// else is shape and idempotence.
import { describe, expect, it } from "vitest";
import * as S from "@jarvis/shared";

const BASE = process.env.JARVIS_API_URL ?? "http://localhost:4321";
const get = async (p: string) => (await fetch(BASE + p)).json();
const post = async (p: string, body: unknown) =>
  fetch(BASE + p, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

describe("onboarding api", () => {
  it("status validates against the shared contract", async () => {
    const s = S.OnboardingStatus.parse(await get("/api/onboarding"));
    expect(s.steps.length).toBeGreaterThan(0);
    // nextStep must be a real step or null — a screen resumes on it
    expect(s.nextStep === null || s.steps.some((x) => x.id === s.nextStep)).toBe(true);
  });

  it("never returns a secret value", async () => {
    const raw = await (await fetch(BASE + "/api/onboarding")).text();
    // whatever is configured locally, none of it may appear in the payload
    for (const k of ["sk-", "xoxb-", "BEGIN PRIVATE KEY", "api_key", "token="]) {
      expect(raw.toLowerCase()).not.toContain(k.toLowerCase());
    }
    const s = JSON.parse(raw);
    for (const v of Object.values(s.integrations as Record<string, unknown>)) {
      // readiness is a boolean and nothing else
      expect(Object.keys(v as object)).toEqual(["configured"]);
      expect(typeof (v as { configured: unknown }).configured).toBe("boolean");
    }
  });

  it("rejects an unknown step instead of writing it", async () => {
    const r = await post("/api/onboarding/step", { step: "not-a-step", status: "complete" });
    expect(r.status).toBe(400);
    const after = S.OnboardingStatus.parse(await get("/api/onboarding"));
    expect(after.steps.some((x) => x.id === "not-a-step")).toBe(false);
  });

  it("rejects an unknown profile", async () => {
    expect((await post("/api/onboarding/profile", { profile: "enormous" })).status).toBe(400);
  });

  it("setupComplete ignores optional steps, so they cannot trap the user", async () => {
    const before = S.OnboardingStatus.parse(await get("/api/onboarding"));
    const optional = before.steps.find((x) => !x.required);
    expect(optional).toBeTruthy();
    const wasComplete = optional!.status === "complete";

    // leaving an optional step undone must not hold setup open — that is what
    // would bounce someone back into onboarding on every launch
    await post("/api/onboarding/step", { step: optional!.id, status: "incomplete" });
    const withOptionalOpen = S.OnboardingStatus.parse(await get("/api/onboarding"));
    const requiredAllDone = withOptionalOpen.steps
      .filter((x) => x.required).every((x) => x.status === "complete");
    expect(withOptionalOpen.setupComplete).toBe(requiredAllDone);

    if (wasComplete) await post("/api/onboarding/step", { step: optional!.id, status: "complete" });
  });

  it("a required step held open keeps setup incomplete", async () => {
    const before = S.OnboardingStatus.parse(await get("/api/onboarding"));
    const req = before.steps.find((x) => x.required);
    expect(req).toBeTruthy();
    const wasComplete = req!.status === "complete";

    await post("/api/onboarding/step", { step: req!.id, status: "incomplete" });
    expect(S.OnboardingStatus.parse(await get("/api/onboarding")).setupComplete).toBe(false);

    if (wasComplete) await post("/api/onboarding/step", { step: req!.id, status: "complete" });
  });

  it("repeating a mutation is a no-op", async () => {
    const before = S.OnboardingStatus.parse(await get("/api/onboarding"));
    const step = before.steps[0].id;
    const wasComplete = before.steps[0].status === "complete";

    await post("/api/onboarding/step", { step, status: "complete" });
    const once = S.OnboardingStatus.parse(await get("/api/onboarding"));
    await post("/api/onboarding/step", { step, status: "complete" });
    const twice = S.OnboardingStatus.parse(await get("/api/onboarding"));

    expect(twice.steps.find((x) => x.id === step)?.status).toBe("complete");
    // the second write changes nothing beyond a timestamp
    expect(twice.steps.map((x) => x.status)).toEqual(once.steps.map((x) => x.status));

    // leave the install as it was found
    if (!wasComplete) await post("/api/onboarding/step", { step, status: "incomplete" });
  });
});
