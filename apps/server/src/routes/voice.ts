// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
import type { FastifyInstance } from "fastify";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { JARVIS_DIR } from "../config.js";
import { localOnly } from "../plugins/localOnly.js";

const run = promisify(execFile);
const binary = (name: string) => ["/opt/homebrew/bin", "/usr/local/bin"].map(dir => path.join(dir, name)).find(existsSync) || name;

export async function transcribeVoice(audio: Buffer): Promise<string> {
  // Short interactive utterances use a small model, independent of call-note quality settings.
  const model = ["small.en", "small", "base.en", "base", "medium", "large-v3"]
    .map(name => path.join(JARVIS_DIR, "models", `ggml-${name}.bin`)).find(existsSync);
  if (!model) throw new Error("No local speech model installed. Run jarvis setup first.");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "jarvis-voice-"));
  try {
    const input = path.join(dir, "input.audio");
    const wav = path.join(dir, "input.wav");
    const output = path.join(dir, "transcript");
    await fs.writeFile(input, audio);
    await run(binary("ffmpeg"), ["-nostdin", "-y", "-hide_banner", "-loglevel", "error", "-protocol_whitelist", "file,pipe", "-format_whitelist", "matroska,webm,mov,wav,ogg,mp3", "-i", input, "-t", "30", "-vn", "-ac", "1", "-ar", "16000", wav], { timeout: 30_000, maxBuffer: 1024 * 1024 });
    await run(binary("whisper-cli"), ["-m", model, "-f", wav, "-l", "en", "-np", "-nt", "-otxt", "-of", output], { timeout: 120_000, maxBuffer: 2 * 1024 * 1024 });
    return (await fs.readFile(`${output}.txt`, "utf8")).trim();
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

export function voiceRoutes(app: FastifyInstance, transcribe = transcribeVoice) {
  let busy = false;
  app.register(async scope => {
    scope.addContentTypeParser("application/octet-stream", { parseAs: "buffer", bodyLimit: 8 * 1024 * 1024 }, (_req, body, done) => done(null, body));
    scope.post("/api/voice/transcribe", { onRequest: localOnly, bodyLimit: 8 * 1024 * 1024 }, async (req, reply) => {
      if (!Buffer.isBuffer(req.body) || !req.body.length) return reply.code(400).send({ error: "Expected a non-empty audio recording." });
      if (busy) return reply.code(429).send({ error: "Jarvis is transcribing another utterance. Please try again." });
      busy = true;
      try {
        return { text: await transcribe(req.body) };
      } catch (error) {
        req.log.warn({ err: error }, "Voice transcription failed");
        return reply.code(503).send({ error: "Local transcription failed. Check that ffmpeg, whisper-cli, and a speech model are installed." });
      } finally {
        busy = false;
      }
    });
  });
}
