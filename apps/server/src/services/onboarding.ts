// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// Onboarding status for the browser flow (plan Task 6).
//
// The CLI wizard already owns this state in tools/onboarding-state.mjs. That
// module is IMPORTED rather than reimplemented here: two copies of the same
// rules drift, and this repo has paid for that more than once — the ACTION
// payload regex that diverged between the dashboard and Telegram, the two
// delivery prompts that ended up completely different strings, and a manual
// that documented pre-vault paths the code had stopped using. One writer, one
// validator, one definition of "which step is next".
//
// Nothing here reports a secret VALUE. Integration readiness is answered as a
// boolean — configured or not — which is all a setup screen needs in order to
// decide what to show.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { JARVIS_DIR, MEMORY_DIR } from "../config.js";
import { readSecrets } from "./env.js";

export const PROFILES = ["core", "meetings", "full"] as const;
export type Profile = (typeof PROFILES)[number];

const PROFILE_FILE = path.join(MEMORY_DIR, "settings", "installation-profile.txt");

type StepStatus = { status: "complete" | "incomplete"; completedAt?: string };
type StateModule = {
  ONBOARDING_STEPS: string[];
  readState: () => { steps: Record<string, StepStatus>; [k: string]: unknown };
  updateStep: (step: string, status: "complete" | "incomplete") => unknown;
  status: (state?: unknown) => { nextStep: string | null; [k: string]: unknown };
};

// Loaded lazily and cached: the module reads JARVIS_DIR at import time, and a
// top-level await here would make every route file depend on it resolving.
let cached: Promise<StateModule> | null = null;
function stateModule(): Promise<StateModule> {
  if (!cached) {
    const url = createRequire(import.meta.url)
      .resolve(path.join(JARVIS_DIR, "tools", "onboarding-state.mjs"));
    cached = import(`file://${url}`) as Promise<StateModule>;
  }
  return cached;
}

export function readProfile(): Profile | null {
  try {
    const v = fs.readFileSync(PROFILE_FILE, "utf8").trim().toLowerCase();
    return (PROFILES as readonly string[]).includes(v) ? (v as Profile) : null;
  } catch { return null; }
}

export function writeProfile(p: Profile): Profile {
  fs.mkdirSync(path.dirname(PROFILE_FILE), { recursive: true });
  fs.writeFileSync(PROFILE_FILE, `${p}\n`);
  return p;
}

/** Whether an integration is configured — never what it is configured WITH. */
function integrations() {
  const s = readSecrets();
  const has = (k: string) => Boolean((s as Record<string, string | undefined>)[k]?.trim());
  return {
    calendar: { configured: has("CALENDAR_FEED_URL") },
    telegram: { configured: has("TELEGRAM_BOT_TOKEN") && has("TELEGRAM_CHAT_ID") },
    voice: { configured: has("ELEVENLABS_API_KEY") },
  };
}

export async function onboardingStatus() {
  const m = await stateModule();
  const s = m.status(m.readState()) as {
    version: number; createdAt: string; updatedAt: string;
    adoptedExistingInstall: boolean; steps: Record<string, StepStatus>;
    nextStep: string | null;
  };
  return {
    version: s.version,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    adoptedExistingInstall: s.adoptedExistingInstall,
    steps: m.ONBOARDING_STEPS.map((id) => ({
      id,
      status: s.steps[id]?.status ?? "incomplete",
      completedAt: s.steps[id]?.completedAt ?? null,
    })),
    // The screen needs to know where to resume; null means nothing is left.
    nextStep: s.nextStep,
    profile: readProfile(),
    integrations: integrations(),
  };
}

export async function setStep(step: string, status: "complete" | "incomplete") {
  const m = await stateModule();
  m.updateStep(step, status);        // throws on an unknown step — the CLI's own rule
  return onboardingStatus();
}

export async function onboardingSteps(): Promise<string[]> {
  return (await stateModule()).ONBOARDING_STEPS;
}
