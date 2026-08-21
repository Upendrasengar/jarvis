// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// Typed API client — every response is validated against the shared zod
// contract, so a server drift fails here loudly instead of rendering garbage.
import * as S from "@jarvis/shared";

async function get<T>(path: string, schema: { parse: (x: unknown) => T }): Promise<T> {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return schema.parse(await r.json());
}

async function post(path: string, body: object): Promise<void> {
  const r = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
}

export const api = {
  calls: () => get("/api/calls", S.Call.array()),
  recState: () => get("/api/recstate", S.RecState),
  autorecord: () => get("/api/autorecord", S.Autorecord),
  setAutorecord: (on: boolean) => post("/api/autorecord", { on }),
  toggleCallItem: (id: string, index: number) => post("/api/calls/toggle", { id, index }),
  deleteCall: (id: string) => post("/api/calls/delete", { id }),
  stopRecording: () => post("/api/calls/stoprec", {}),
  startRecording: () => post("/api/calls/startrec", {}),
};
