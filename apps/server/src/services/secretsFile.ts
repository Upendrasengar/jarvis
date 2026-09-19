// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
import fs from "node:fs";
import path from "node:path";

function encodeEnvValue(value: string): string {
  return /\s|#/.test(value) ? `"${value}"` : value;
}

/** Update named values while preserving every unrelated line in the secrets file. */
export function updateEnvFile(file: string, values: Record<string, string>): void {
  const pending = new Map(Object.entries(values));
  const managed = new Set(pending.keys());
  let source = "";
  try { source = fs.readFileSync(file, "utf8"); } catch {}

  const output: string[] = [];
  for (const line of source.replace(/\n$/, "").split("\n")) {
    if (!line && !source) continue;
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=/);
    const key = match?.[1];
    if (!key || !managed.has(key)) {
      output.push(line);
      continue;
    }
    if (pending.get(key) !== undefined) {
      output.push(`${key}=${encodeEnvValue(pending.get(key)!)}`);
      pending.delete(key);
    }
  }
  for (const [key, value] of pending) output.push(`${key}=${encodeEnvValue(value)}`);

  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, output.join("\n") + "\n", { mode: 0o600 });
  fs.renameSync(temp, file);
  fs.chmodSync(file, 0o600);
}
