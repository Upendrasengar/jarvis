import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tool = path.join(repo, "tools/onboarding-state.mjs");
const temporaryRoots = [];

function root() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-onboarding-state-"));
  temporaryRoots.push(directory);
  return directory;
}

function run(jarvisRoot, ...args) {
  const result = spawnSync(process.execPath, [tool, ...args], {
    encoding: "utf8",
    env: { ...process.env, JARVIS_DIR: jarvisRoot },
  });
  return { ...result, json: result.stdout ? JSON.parse(result.stdout) : undefined };
}

try {
  const clean = root();
  const initial = run(clean, "status");
  assert.equal(initial.status, 0);
  assert.equal(initial.json.nextStep, "system");
  assert.equal(initial.json.adoptedExistingInstall, false);
  assert.equal(fs.existsSync(path.join(clean, "memory/settings/onboarding.json")), false,
    "status must be read-only");

  const systemDone = run(clean, "complete", "system");
  assert.equal(systemDone.status, 0);
  assert.equal(systemDone.json.nextStep, "claude");
  const stateFile = path.join(clean, "memory/settings/onboarding.json");
  assert.equal(fs.statSync(stateFile).mode & 0o777, 0o600);
  const stateAfterSystem = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  assert.deepEqual(Object.keys(stateAfterSystem).sort(),
    ["adoptedExistingInstall", "createdAt", "steps", "updatedAt", "version"]);
  assert.equal(JSON.stringify(stateAfterSystem).includes("secret"), false);

  for (const step of ["claude", "profile", "vault", "calendar", "meetings", "service", "complete"]) {
    assert.equal(run(clean, "complete", step).status, 0);
  }
  assert.equal(run(clean, "status").json.nextStep, null);

  const revisited = run(clean, "revisit", "vault");
  assert.equal(revisited.status, 0);
  assert.equal(revisited.json.nextStep, "vault");
  assert.equal(revisited.json.steps.calendar.status, "complete",
    "revisiting one step must retain later progress");

  const beforeUpgrade = fs.readFileSync(stateFile, "utf8");
  assert.equal(run(clean, "status").status, 0);
  assert.equal(fs.readFileSync(stateFile, "utf8"), beforeUpgrade,
    "reading state during an upgrade must not rewrite it");

  const existing = root();
  fs.mkdirSync(path.join(existing, "memory"), { recursive: true });
  fs.mkdirSync(path.join(existing, "node_modules"));
  fs.mkdirSync(path.join(existing, "apps/web/dist"), { recursive: true });
  fs.writeFileSync(path.join(existing, "memory/about-me.md"), "# Existing profile\n");
  const adopted = run(existing, "status");
  assert.equal(adopted.status, 0);
  assert.equal(adopted.json.adoptedExistingInstall, true);
  assert.equal(adopted.json.nextStep, null);
  assert.equal(fs.existsSync(path.join(existing, "memory/settings/onboarding.json")), false);

  const seededOnly = root();
  fs.mkdirSync(path.join(seededOnly, "memory"), { recursive: true });
  fs.mkdirSync(path.join(seededOnly, "memory.example"));
  fs.mkdirSync(path.join(seededOnly, "node_modules"));
  fs.mkdirSync(path.join(seededOnly, "apps/web/dist"), { recursive: true });
  fs.writeFileSync(path.join(seededOnly, "memory/about-me.md"), "# Unconfigured template\n");
  fs.writeFileSync(path.join(seededOnly, "memory.example/about-me.md"), "# Unconfigured template\n");
  assert.equal(run(seededOnly, "status").json.adoptedExistingInstall, false,
    "a copied first-run template is not a configured profile");

  const rejected = run(clean, "complete", "apiToken");
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /Unknown onboarding step/);

  const corrupted = root();
  const corruptedSettings = path.join(corrupted, "memory/settings");
  fs.mkdirSync(corruptedSettings, { recursive: true });
  const forbiddenValue = "do-not-echo-this-credential";
  fs.writeFileSync(path.join(corruptedSettings, "onboarding.json"), JSON.stringify({
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    adoptedExistingInstall: false,
    steps: {},
    apiToken: forbiddenValue,
  }));
  const corruptResult = run(corrupted, "status");
  assert.notEqual(corruptResult.status, 0);
  assert.doesNotMatch(corruptResult.stderr, new RegExp(forbiddenValue));

  console.log("onboarding state contract: ok");
} finally {
  for (const directory of temporaryRoots) fs.rmSync(directory, { recursive: true, force: true });
}
