#!/usr/bin/env node
// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// Persistent, non-secret progress for the resumable onboarding flows.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ONBOARDING_STEPS = [
  "system",
  "claude",
  "profile",
  "vault",
  "calendar",
  "meetings",
  "service",
  "complete",
];

const ROOT_KEYS = ["version", "createdAt", "updatedAt", "adoptedExistingInstall", "steps"];
const STEP_KEYS = ["status", "completedAt"];
const here = path.dirname(fileURLToPath(import.meta.url));
const jarvisRoot = process.env.JARVIS_DIR || path.resolve(here, "..");
const stateFile = path.join(jarvisRoot, "memory", "settings", "onboarding.json");

function exactKeys(value, allowed, label) {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new Error(`${label} contains unsupported fields: ${unknown.join(", ")}`);
}

function timestamp(value, label) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${label} must be an ISO timestamp`);
  }
}

export function validateState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Onboarding state must be an object");
  exactKeys(value, ROOT_KEYS, "Onboarding state");
  if (value.version !== 1) throw new Error("Unsupported onboarding state version");
  if (typeof value.adoptedExistingInstall !== "boolean") throw new Error("adoptedExistingInstall must be boolean");
  timestamp(value.createdAt, "createdAt");
  timestamp(value.updatedAt, "updatedAt");
  if (!value.steps || typeof value.steps !== "object" || Array.isArray(value.steps)) throw new Error("steps must be an object");
  exactKeys(value.steps, ONBOARDING_STEPS, "steps");
  for (const step of ONBOARDING_STEPS) {
    const progress = value.steps[step];
    if (!progress || typeof progress !== "object" || Array.isArray(progress)) throw new Error(`Missing onboarding step: ${step}`);
    exactKeys(progress, STEP_KEYS, `Step ${step}`);
    if (progress.status !== "complete" && progress.status !== "incomplete") throw new Error(`Invalid status for step: ${step}`);
    if (progress.completedAt !== undefined) timestamp(progress.completedAt, `${step}.completedAt`);
    if (progress.status === "complete" && progress.completedAt === undefined) throw new Error(`Completed step lacks timestamp: ${step}`);
    if (progress.status === "incomplete" && progress.completedAt !== undefined) throw new Error(`Incomplete step has completion timestamp: ${step}`);
  }
  return value;
}

function isExistingInstall() {
  const profile = path.join(jarvisRoot, "memory", "about-me.md");
  const profileTemplate = path.join(jarvisRoot, "memory.example", "about-me.md");
  const vaultPointer = path.join(jarvisRoot, "memory", "settings", "vault-dir.txt");
  const dependencies = path.join(jarvisRoot, "node_modules");
  const webAssets = path.join(jarvisRoot, "apps", "web", "dist");
  const legacyProfileConfigured = fs.existsSync(profile) && (
    !fs.existsSync(profileTemplate)
    || fs.readFileSync(profile, "utf8") !== fs.readFileSync(profileTemplate, "utf8")
  );
  const vaultConfigured = Boolean(process.env.JARVIS_VAULT)
    || (fs.existsSync(vaultPointer) && fs.readFileSync(vaultPointer, "utf8").trim().length > 0);
  return (legacyProfileConfigured || vaultConfigured)
    && fs.existsSync(dependencies)
    && fs.existsSync(webAssets);
}

function initialState(now = new Date().toISOString()) {
  const adoptedExistingInstall = isExistingInstall();
  return {
    version: 1,
    createdAt: now,
    updatedAt: now,
    adoptedExistingInstall,
    steps: Object.fromEntries(ONBOARDING_STEPS.map((step) => [step,
      adoptedExistingInstall ? { status: "complete", completedAt: now } : { status: "incomplete" },
    ])),
  };
}

export function readState() {
  if (!fs.existsSync(stateFile)) return initialState();
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read onboarding state: ${error.message}`);
  }
  return validateState(parsed);
}

function saveState(state) {
  validateState(state);
  const directory = path.dirname(stateFile);
  fs.mkdirSync(directory, { recursive: true });
  const temporary = `${stateFile}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, stateFile);
  } finally {
    try { fs.unlinkSync(temporary); } catch {}
  }
}

function assertStep(step) {
  if (!ONBOARDING_STEPS.includes(step)) throw new Error(`Unknown onboarding step: ${step || "(missing)"}`);
}

export function updateStep(step, status) {
  assertStep(step);
  if (status !== "complete" && status !== "incomplete") throw new Error(`Invalid onboarding status: ${status}`);
  const state = readState();
  const now = new Date().toISOString();
  state.updatedAt = now;
  state.steps[step] = status === "complete"
    ? { status: "complete", completedAt: now }
    : { status: "incomplete" };
  saveState(state);
  return state;
}

export function status(state = readState()) {
  return {
    ...state,
    nextStep: ONBOARDING_STEPS.find((step) => state.steps[step].status === "incomplete") ?? null,
  };
}

function main() {
  const [command = "status", step] = process.argv.slice(2);
  let state;
  if (command === "status") state = readState();
  else if (command === "complete") state = updateStep(step, "complete");
  else if (command === "revisit") state = updateStep(step, "incomplete");
  else throw new Error(`Unknown onboarding state command: ${command}`);
  process.stdout.write(`${JSON.stringify(status(state), null, 2)}\n`);
}

// Compare REAL paths, not the strings each side happens to carry.
//
// Homebrew installs the engine read-only in the cellar and symlinks it into
// ~/.jarvis, so this file is invoked as ~/.jarvis/tools/onboarding-state.mjs
// while import.meta.url reports the resolved cellar path — Node resolves
// symlinks, argv does not. The two never matched, so main() never ran: exit 0,
// no output, no error. onboard.sh then piped that empty stdout into JSON.parse
// and every Homebrew user got "Unexpected end of JSON input" from a tool that
// had politely done nothing.
function isDirectlyInvoked() {
  if (!process.argv[1]) return false;
  const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
  return real(process.argv[1]) === real(fileURLToPath(import.meta.url));
}

if (isDirectlyInvoked()) {
  try { main(); }
  catch (error) { process.stderr.write(`jarvis onboarding state: ${error.message}\n`); process.exitCode = 1; }
}
