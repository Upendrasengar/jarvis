// Jarvis API server (Fastify). Phase 1 of the platform migration: file-based
// endpoints ported 1:1 from the legacy ui/server.js. Chat/agents/TTS (the
// warm claude-session manager) stay on the legacy server until Phase 4.
// Runs on :4322 alongside the legacy server on :4321 during the migration.
import fs from "node:fs";
import path from "node:path";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import { PORT, JARVIS_DIR, WEB_DIST } from "./config.js";
import { callRoutes } from "./routes/calls.js";
import { contentRoutes } from "./routes/content.js";
import { actionRoutes } from "./routes/actions.js";
import { chatRoutes } from "./routes/chat.js";
import { settingsRoutes } from "./routes/settings.js";
import { logRoutes } from "./routes/logs.js";
import { noteRoutes } from "./routes/notes.js";
import { addClient, startWatching } from "./live/liveState.js";
import { startWatchdog } from "./integrations/watchdog.js";
import { startTelegram } from "./integrations/telegram.js";

// bodyLimit raised for pasted screenshots (4 × ~7MB data URLs)
const app = Fastify({ logger: { level: "warn" }, bodyLimit: 32 * 1024 * 1024 });

// Legacy parity: no caching of API responses.
app.addHook("onSend", async (_req, reply) => {
  reply.header("Cache-Control", "no-store");
});

await app.register(websocket);
app.get("/api/live", { websocket: true }, (socket) => addClient(socket));
startWatching();
startWatchdog();
startTelegram();

callRoutes(app);
contentRoutes(app);
actionRoutes(app);
chatRoutes(app);
settingsRoutes(app);
logRoutes(app);
noteRoutes(app);

// Serve the built React app when it exists (production). SPA fallback: any
// non-API GET renders index.html and the client router takes over.
if (fs.existsSync(WEB_DIST)) {
  await app.register(fastifyStatic, { root: WEB_DIST, index: ["index.html"] });
  app.setNotFoundHandler((req, reply) => {
    if (req.method === "GET" && !req.url.startsWith("/api/"))
      return reply.type("text/html").send(fs.readFileSync(path.join(WEB_DIST, "index.html")));
    reply.code(404).send({ error: "not found" });
  });
}

app.listen({ port: PORT, host: "127.0.0.1" }).then(() => {
  console.log(`\n  🤖  Jarvis API →  http://localhost:${PORT}`);
  console.log(`      repo: ${JARVIS_DIR}\n`);
});
