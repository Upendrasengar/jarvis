// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// macOS recording permissions for the onboarding flow (plan Task 14).
//
// The states are asked of JarvisAudio.app itself rather than inferred, because
// this is precisely where inference failed before: TCC reported "granted"
// while AVAudioEngine delivered silence, and nothing compared the two.
//
// One honest limitation is reported rather than papered over. The microphone
// API distinguishes granted, denied and never-asked; the screen-capture
// preflight returns a bool, so a false means "denied or never asked" and
// claiming otherwise would be a guess.
import { spawn } from "node:child_process";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { JARVIS_DIR } from "../config.js";
import { localOnly } from "../plugins/localOnly.js";

const APP = () => path.join(JARVIS_DIR, "tools", "call-capture", "JarvisAudio.app");

// The pane each permission lives in. Opening the right one saves the owner
// hunting through System Settings while a prompt they already dismissed is the
// only thing standing between them and a working recording.
const PANES: Record<string, string> = {
  microphone: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
  screen: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
  notifications: "x-apple.systempreferences:com.apple.Notifications-Settings.extension",
};

type State = "granted" | "denied" | "not-determined" | "unknown";

function probe(): Promise<{ microphone: State; screen: State; appBuilt: boolean }> {
  return new Promise((resolve) => {
    const app = APP();
    const out = path.join(JARVIS_DIR, "data", `perm-${Date.now()}.txt`);
    const child = spawn("/usr/bin/open", ["-n", "-g", "-a", app, "--args", "--check", out],
      { stdio: "ignore" });
    const done = (r: { microphone: State; screen: State; appBuilt: boolean }) => resolve(r);
    child.on("error", () => done({ microphone: "unknown", screen: "unknown", appBuilt: false }));
    child.on("close", async () => {
      const fs = await import("node:fs");
      // the app writes the file asynchronously after launching
      for (let i = 0; i < 20; i++) {
        try {
          const t = fs.readFileSync(out, "utf8");
          if (t.trim()) {
            fs.rmSync(out, { force: true });
            const pick = (k: string): State => {
              const m = t.match(new RegExp(`^${k}:\\s*(\\S+)`, "m"));
              const v = m?.[1];
              return v === "granted" || v === "denied" || v === "not-determined" ? v : "unknown";
            };
            return done({ microphone: pick("microphone"), screen: pick("screen-recording"), appBuilt: true });
          }
        } catch { /* not written yet */ }
        await new Promise((r) => setTimeout(r, 250));
      }
      try { (await import("node:fs")).rmSync(out, { force: true }); } catch { /* nothing to clean */ }
      done({ microphone: "unknown", screen: "unknown", appBuilt: true });
    });
  });
}

export function permissionRoutes(app: FastifyInstance) {
  app.get("/api/permissions", async () => {
    const p = await probe();
    return {
      ...p,
      // screen capture cannot tell "denied" from "never asked" — say so
      // A sentence, because it is appended to one. It also has to earn its
      // place beside a status pill that already says DENIED: what it adds is
      // that macOS cannot tell the two apart, so "denied" here may only mean
      // nobody has asked yet.
      screenNote: p.screen === "denied"
        ? "macOS reports \"denied\" and \"never requested\" identically, so it may simply not have been asked for yet."
        : "",
    };
  });

  // Opening a Settings pane is a local action with no argument the caller
  // controls beyond a key from this map, so no path or URL is ever built from
  // user input.
  app.post("/api/permissions/open", { preHandler: localOnly }, async (req, reply) => {
    const b = z.object({ pane: z.enum(["microphone", "screen", "notifications"]) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "pane must be microphone, screen or notifications" });
    spawn("/usr/bin/open", [PANES[b.data.pane]], { stdio: "ignore" }).unref();
    return { ok: true };
  });
}
