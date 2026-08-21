// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// API tests against the running Jarvis server (post-cutover: API + web on
// :4321). Every response must validate against the shared zod contract, and
// state-changing routes must enforce the CSRF guard.
//   JARVIS_API_URL=http://localhost:4322 pnpm server:test   # to target dev
import { describe, expect, it } from "vitest";
import * as S from "@jarvis/shared";

const BASE = process.env.JARVIS_API_URL ?? "http://localhost:4321";

const get = async (path: string) => (await fetch(BASE + path)).json();

describe("api contract", () => {
  it("/api/calls validates", async () => {
    expect(S.Call.array().parse(await get("/api/calls"))).toBeTruthy();
  });

  it("/api/recstate validates", async () => {
    expect(S.RecState.parse(await get("/api/recstate"))).toBeTruthy();
  });

  it("/api/autorecord validates", async () => {
    expect(S.Autorecord.parse(await get("/api/autorecord"))).toBeTruthy();
  });

  it("/api/digests + /api/digest validate", async () => {
    const dates = S.DigestEntry.array().parse(await get("/api/digests"));
    expect(S.Digest.parse(await get("/api/digest"))).toBeTruthy();
    if (dates.length) {
      expect(S.Digest.parse(await get(`/api/digest?date=${dates[dates.length - 1].date}`))).toBeTruthy();
    }
  });

  it("/api/projects validates", async () => {
    expect(S.Project.array().parse(await get("/api/projects"))).toBeTruthy();
  });

  it("/api/graph validates", async () => {
    expect(S.Graph.parse(await get("/api/graph"))).toBeTruthy();
  });

  it("/api/stats validates", async () => {
    expect(S.Stats.parse(await get("/api/stats"))).toBeTruthy();
  });

  it("/api/actions validates", async () => {
    expect(S.ActionItem.array().parse(await get("/api/actions"))).toBeTruthy();
  });

  it("POST guards reject cross-origin", async () => {
    const r = await fetch(BASE + "/api/calls/toggle", {
      method: "POST",
      headers: { Origin: "https://evil.example", "Content-Type": "application/json" },
      body: JSON.stringify({ id: "x", index: 0 }),
    });
    expect(r.status).toBe(403);
  });

  it("toggle round-trips on a call with action items", async () => {
    const calls = S.Call.array().parse(await get("/api/calls"));
    const target = calls.find((c) => /- \[ \]/.test(c.notes));
    if (!target) return;
    const post = (body: object) => fetch(BASE + "/api/calls/toggle", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    expect((await post({ id: target.id, index: 0 })).status).toBe(200);
    expect((await post({ id: target.id, index: 0 })).status).toBe(200); // revert
  });

  it("serves the web app with SPA fallback", async () => {
    for (const p of ["/", "/calls", "/digest/2026-08-06"]) {
      const r = await fetch(BASE + p);
      expect(r.status).toBe(200);
      expect(r.headers.get("content-type")).toContain("text/html");
    }
  });
});
