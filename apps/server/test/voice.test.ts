// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import { voiceRoutes } from "../src/routes/voice.js";

describe("local voice transcription", () => {
  it("passes recorded audio to the transcriber and returns text", async () => {
    const app = Fastify();
    voiceRoutes(app, async audio => { expect(audio.toString()).toBe("recorded audio"); return "hello Jarvis"; });
    const response = await app.inject({ method: "POST", url: "/api/voice/transcribe", headers: { "content-type": "application/octet-stream" }, payload: Buffer.from("recorded audio") });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ text: "hello Jarvis" });
    await app.close();
  });
  it("rejects cross-origin and empty uploads before transcription", async () => {
    const app = Fastify();
    voiceRoutes(app, async () => { throw new Error("must not transcribe"); });
    const forbidden = await app.inject({ method: "POST", url: "/api/voice/transcribe", headers: { origin: "https://example.com", "content-type": "application/octet-stream" }, payload: Buffer.from("audio") });
    expect(forbidden.statusCode).toBe(403);
    const empty = await app.inject({ method: "POST", url: "/api/voice/transcribe", headers: { "content-type": "application/octet-stream" }, payload: Buffer.alloc(0) });
    expect(empty.statusCode).toBe(400);
    await app.close();
  });
  it("limits concurrent work and releases the lock after failure", async () => {
    const app = Fastify();
    let reject!: (error: Error) => void;
    let started!: () => void;
    const pending = new Promise<string>((_resolve, rejectPromise) => { reject = rejectPromise; });
    const called = new Promise<void>(resolve => { started = resolve; });
    let calls = 0;
    voiceRoutes(app, async () => { if (calls++ === 0) { started(); return pending; } return "next utterance"; });
    const request = { method: "POST" as const, url: "/api/voice/transcribe", headers: { "content-type": "application/octet-stream" }, payload: Buffer.from("audio") };
    const first = app.inject(request).then(response => response);
    await called;
    expect((await app.inject(request)).statusCode).toBe(429);
    reject(new Error("transcriber unavailable"));
    expect((await first).statusCode).toBe(503);
    expect((await app.inject(request)).json()).toEqual({ text: "next utterance" });
    await app.close();
  });
});
