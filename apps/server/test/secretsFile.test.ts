import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { updateEnvFile } from "../src/services/secretsFile.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("updateEnvFile", () => {
  it("adds calendar settings without disturbing existing secrets or comments", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-secrets-"));
    dirs.push(dir);
    const file = path.join(dir, ".env");
    fs.writeFileSync(file, "# existing\nELEVENLABS_API_KEY=keep-me\n");

    updateEnvFile(file, {
      CALENDAR_FEED_URL: "https://calendar.example/private.ics",
      CALENDAR_FEED_KEY: "optional-key",
    });

    expect(fs.readFileSync(file, "utf8")).toBe(
      "# existing\nELEVENLABS_API_KEY=keep-me\nCALENDAR_FEED_URL=https://calendar.example/private.ics\nCALENDAR_FEED_KEY=optional-key\n",
    );
  });

  it("replaces matching settings once and safely quotes special values", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-secrets-"));
    dirs.push(dir);
    const file = path.join(dir, ".env");
    fs.writeFileSync(file, "CALENDAR_FEED_URL=old\nCALENDAR_FEED_URL=duplicate\nCALENDAR_FEED_KEY=old\n");

    updateEnvFile(file, {
      CALENDAR_FEED_URL: "https://calendar.example/feed?name=My Calendar",
      CALENDAR_FEED_KEY: "key#part",
    });

    expect(fs.readFileSync(file, "utf8")).toBe(
      'CALENDAR_FEED_URL="https://calendar.example/feed?name=My Calendar"\nCALENDAR_FEED_KEY="key#part"\n',
    );
  });
});
