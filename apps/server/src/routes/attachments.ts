// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// Vault attachments — the images embedded in notes and call notes.
// Obsidian's own default is followed exactly: pasted images land in the VAULT
// ROOT as "Pasted image <YYYYMMDDHHmmss>.png", so a note written here opens
// correctly in Obsidian and vice versa.
import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { BRAIN_DIR } from "../config.js";
import { localOnly } from "../plugins/localOnly.js";

const TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

const UploadBody = z.object({
  // data URL from a clipboard paste, capped at ~12MB encoded
  data: z.string().max(12_000_000),
  name: z.string().max(200).optional(),
});

// Resolve a vault-relative name to an absolute path, refusing anything that
// escapes the vault. An embed name comes out of note text, which is user data
// — "../../.ssh/id_rsa" must not resolve.
function safeVaultPath(name: string): string | null {
  const clean = decodeURIComponent(name).replace(/^\/+/, "");
  if (clean.includes("\0")) return null;
  const abs = path.resolve(BRAIN_DIR, clean);
  const root = path.resolve(BRAIN_DIR) + path.sep;
  if (!abs.startsWith(root)) return null;
  if (!(path.extname(abs).toLowerCase() in TYPES)) return null;
  return abs;
}

// Obsidian's naming, to the second
function stamp(d = new Date()): string {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function attachmentRoutes(app: FastifyInstance) {
  // Embeds resolve by BASENAME the way Obsidian does — a note says
  // ![[Pasted image 123.png]] with no path, wherever the file actually sits.
  app.get("/api/attachment/*", async (req, reply) => {
    const raw = (req.params as Record<string, string>)["*"] ?? "";
    let abs = safeVaultPath(raw);
    if (abs && !fs.existsSync(abs)) abs = null;
    if (!abs) {
      // fall back to a basename search one level deep (Attachments/, assets/…)
      const base = path.basename(decodeURIComponent(raw));
      const found = findByName(base);
      if (!found) return reply.code(404).send({ error: "no such attachment" });
      abs = found;
    }
    const type = TYPES[path.extname(abs).toLowerCase()];
    if (!type) return reply.code(415).send({ error: "unsupported type" });
    return reply
      .header("Content-Type", type)
      .header("Cache-Control", "private, max-age=600")
      .send(fs.createReadStream(abs));
  });

  app.post("/api/attachment", { preHandler: localOnly }, async (req, reply) => {
    const body = UploadBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "bad upload" });
    const m = body.data.data.match(/^data:image\/(png|jpeg|jpg|gif|webp);base64,([A-Za-z0-9+/=]+)$/);
    if (!m) return reply.code(400).send({ error: "expected an image data URL" });
    const ext = m[1] === "jpeg" ? "jpg" : m[1];
    let name = `Pasted image ${stamp()}.${ext}`;
    try {
      fs.mkdirSync(BRAIN_DIR, { recursive: true });
      // same second, two pastes — don't clobber
      for (let n = 2; fs.existsSync(path.join(BRAIN_DIR, name)); n++)
        name = `Pasted image ${stamp()}-${n}.${ext}`;
      fs.writeFileSync(path.join(BRAIN_DIR, name), Buffer.from(m[2], "base64"));
    } catch (e) {
      return reply.code(500).send({ error: String(e).slice(0, 140) });
    }
    return { name, embed: `![[${name}]]` };
  });
}

// one level into the vault is enough for the folders people actually use
function findByName(base: string): string | null {
  const root = path.resolve(BRAIN_DIR);
  const direct = path.join(root, base);
  if (fs.existsSync(direct)) return direct;
  let dirs: string[] = [];
  try {
    dirs = fs.readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name);
  } catch { return null; }
  for (const d of dirs) {
    const p = path.join(root, d, base);
    if (fs.existsSync(p)) return p;
  }
  return null;
}
