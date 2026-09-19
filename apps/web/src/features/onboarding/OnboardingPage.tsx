// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// Guided setup in the browser (plan Task 7).
//
// The CLI wizard already does this; the browser flow exists because most of
// what remains after `brew install` is not typing — it is granting macOS
// permissions, signing into Claude, and deciding which optional pieces you
// want. Those are easier to explain next to a button than in a terminal.
//
// Two rules shape the whole screen. Required and optional are visually
// distinct, because a skipped integration must never read as a failure. And no
// credential is ever collected or redisplayed here: fields that hold secrets
// live in Settings, and this page only ever reports whether one is configured.
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

type Step = { id: string; status: "complete" | "incomplete"; completedAt: string | null; required: boolean };
type Status = {
  steps: Step[];
  nextStep: string | null;
  profile: "core" | "meetings" | "full" | null;
  setupComplete: boolean;
  adoptedExistingInstall: boolean;
  integrations: Record<string, { configured: boolean }>;
};
type Check = { id: string; label: string; section: string; status: string; message: string; remediation: string };

// Presentation only. Which steps are REQUIRED is decided by the server, since
// the redirect depends on it — a second opinion here could send someone into
// setup the gate thinks they have finished.
const PLAN: Record<string, { title: string; blurb: string }> = {
  system:   { title: "System check",      blurb: "Confirm the tools Jarvis needs are installed and healthy.", },
  claude:   { title: "Claude Code",       blurb: "Jarvis thinks with Claude Code. It needs to be installed and signed in.", },
  profile:  { title: "Who you are",       blurb: "Your name and role, so Jarvis writes notes about the right person.", },
  vault:    { title: "Your vault",        blurb: "Where notes, calls and memory are stored on disk.", },
  calendar: { title: "Calendar",          blurb: "Lets Jarvis see meetings and prepare for them. Configured in Settings.", },
  meetings: { title: "Meeting recording", blurb: "Record calls and transcribe them locally. Needs microphone and screen permissions.", },
  service:  { title: "Start at login",    blurb: "Keep Jarvis running in the background so calls are captured.", },
  complete: { title: "Ready",             blurb: "Everything is set up.", },
};

export function OnboardingPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [active, setActive] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { data: status } = useQuery<Status>({
    queryKey: ["onboarding"],
    queryFn: async () => (await fetch("/api/onboarding")).json(),
    refetchInterval: 10_000,
  });

  const setStep = useMutation({
    mutationFn: async (v: { step: string; status: "complete" | "incomplete" }) => {
      const r = await fetch("/api/onboarding/step", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(v),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? "could not update the step");
      return r.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["onboarding"] }),
  });

  const steps = status?.steps ?? [];
  // land on the first thing that still needs attention
  useEffect(() => {
    if (!active && status) setActive(status.nextStep ?? steps[0]?.id ?? null);
  }, [active, status, steps]);

  // Arrow keys move between steps without reaching for the mouse; the list is
  // the focusable thing rather than each row, so tab order stays short.
  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!steps.length || !active) return;
    const i = steps.findIndex((s) => s.id === active);
    if (e.key === "ArrowDown" || e.key === "ArrowRight") {
      e.preventDefault(); setActive(steps[Math.min(steps.length - 1, i + 1)].id);
    } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
      e.preventDefault(); setActive(steps[Math.max(0, i - 1)].id);
    }
  }, [steps, active]);

  if (!status) {
    return <div className="p-10 text-[13px] text-[var(--dim)]">Loading setup…</div>;
  }

  const done = steps.filter((s) => s.status === "complete").length;
  const current = steps.find((s) => s.id === active) ?? steps[0];
  const plan = PLAN[current?.id ?? ""] ?? { title: current?.id ?? "", blurb: "" };
  const required = current?.required ?? true;

  return (
    <div className="mx-auto flex h-full w-full max-w-[1040px] gap-6 px-6 py-8 font-sans">
      {/* ── step list ─────────────────────────────────────────────────── */}
      <div
        ref={listRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        aria-label="Setup steps"
        className="w-[260px] shrink-0 rounded-2xl border border-[var(--line)] bg-[var(--surf)] p-3 outline-none [box-shadow:var(--shadow)] focus:border-[var(--cyan-3)]"
      >
        <div className="px-2 pb-2 text-[9.5px] tracking-[2px] text-[var(--dim)]">
          SETUP · {done}/{steps.length}
        </div>
        {steps.map((s) => {
          const p = PLAN[s.id] ?? { title: s.id };
          const on = s.id === active;
          return (
            <button
              key={s.id}
              onClick={() => setActive(s.id)}
              aria-current={on}
              className={`mb-1 flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-[12.5px] transition ${
                on ? "bg-[var(--cyan-2)] text-[var(--text)]" : "text-[var(--dim)] hover:bg-[var(--surf-2)]"
              }`}
            >
              <span
                className={`h-[7px] w-[7px] shrink-0 rounded-full ${
                  s.status === "complete" ? "bg-[var(--green)]" : "border border-[var(--dim)]"
                }`}
              />
              <span className="min-w-0 flex-1 truncate">{p.title}</span>
              {!s.required && s.id !== "complete" && (
                <span className="shrink-0 font-mono text-[8.5px] uppercase tracking-[1px] opacity-60">
                  optional
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── the active step ───────────────────────────────────────────── */}
      <div className="min-w-0 flex-1 rounded-2xl border border-[var(--line)] bg-[var(--surf)] p-6 [box-shadow:var(--shadow)]">
        <div className="flex items-baseline gap-3">
          <h1 className="text-[19px] font-semibold text-[var(--bright)] [font-family:var(--display)]">
            {plan.title}
          </h1>
          {current?.id !== "complete" && (
          <span className={`rounded-full border px-2 py-[1px] text-[9.5px] uppercase tracking-[1px] ${
            required
              ? "border-[var(--line)] text-[var(--dim)]"
              : "border-[var(--indigo-3)] bg-[var(--indigo-2)] text-[var(--indigo)]"
          }`}>
            {required ? "required" : "optional"}
          </span>
          )}
        </div>
        <p className="mt-2 text-[13px] leading-relaxed text-[var(--dim)]">{plan.blurb}</p>

        <div className="mt-5">
          {current?.id === "system" && <SystemCheck />}
          {current?.id === "claude" && <ClaudeStep />}
          {current?.id === "profile" && <ProfileStep />}
          {current?.id === "vault" && <VaultStep />}
          {current?.id === "calendar" && <CalendarStep configured={status.integrations.calendar?.configured} />}
          {current?.id === "meetings" && <MeetingsStep />}
          {current?.id === "service" && <ServiceStep />}
          {current?.id === "complete" && (
            <button
              onClick={() => navigate("/overview")}
              className="rounded-full bg-[var(--cyan)] px-5 py-2 text-[13px] font-semibold text-[#02121a]"
            >
              Open Jarvis →
            </button>
          )}
        </div>

        {current && current.id !== "complete" && (
          <div className="mt-6 flex items-center gap-3 border-t border-[var(--line)] pt-4">
            <button
              onClick={() => setStep.mutate({
                step: current.id,
                status: current.status === "complete" ? "incomplete" : "complete",
              })}
              className={`rounded-full border px-4 py-1.5 text-[12px] ${
                current.status === "complete"
                  ? "border-[var(--line)] text-[var(--dim)]"
                  : "border-[var(--cyan)] text-[var(--cyan)] hover:bg-[var(--cyan-2)]"
              }`}
            >
              {current.status === "complete" ? "Mark not done" : "Mark done"}
            </button>
            {!required && (
              <span className="text-[11px] text-[var(--dim)]">
                Skipping is fine — Jarvis works without this, and Doctor will list it as optional.
              </span>
            )}
            {setStep.isError && (
              <span className="text-[11px] text-[var(--red)]">{String(setStep.error)}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── steps ──────────────────────────────────────────────────────────────────

function SystemCheck() {
  const [run, setRun] = useState(false);
  const { data, isFetching } = useQuery<{ ok: boolean; checks: Check[]; error?: string }>({
    queryKey: ["doctor"],
    queryFn: async () => (await fetch("/api/doctor")).json(),
    enabled: run,
    // doctor takes ~8s; never on a timer, only when asked
    refetchOnWindowFocus: false,
  });

  if (!run) {
    return (
      <button
        onClick={() => setRun(true)}
        className="rounded-full border border-[var(--cyan)] px-4 py-1.5 text-[12px] text-[var(--cyan)] hover:bg-[var(--cyan-2)]"
      >
        Run system check
      </button>
    );
  }
  if (isFetching || !data) return <div className="text-[12px] text-[var(--dim)]">Checking… (about 8 seconds)</div>;
  if (data.error) return <div className="text-[12px] text-[var(--red)]">{data.error}</div>;

  // Only problems are listed. A wall of green tells you nothing you can act on.
  const bad = data.checks.filter((c) => c.status === "blocked" || c.status === "warning");
  return (
    <div>
      <div className="text-[12.5px] text-[var(--text)]">
        {data.checks.length} checks · {data.checks.filter((c) => c.status === "pass").length} passing
        {bad.length ? ` · ${bad.length} need attention` : " · nothing blocking"}
      </div>
      {bad.map((c) => (
        <div key={c.id} className="mt-2 rounded-xl border border-[var(--line)] bg-[var(--surf-2)] p-3">
          <div className="flex items-baseline gap-2">
            <span className={`font-mono text-[9px] uppercase tracking-[1px] ${
              c.status === "blocked" ? "text-[var(--red)]" : "text-[var(--amber)]"
            }`}>{c.status}</span>
            <span className="text-[12.5px] text-[var(--text)]">{c.label}</span>
          </div>
          <div className="mt-1 text-[11.5px] text-[var(--dim)]">{c.message}</div>
          {c.remediation && (
            <code className="mt-2 block rounded-lg bg-[var(--field)] px-2 py-1 font-mono text-[11px] text-[var(--cyan)]">
              {c.remediation}
            </code>
          )}
        </div>
      ))}
    </div>
  );
}

function ClaudeStep() {
  return (
    <div className="text-[12.5px] leading-relaxed text-[var(--dim)]">
      Jarvis runs on the Claude Code CLI. If the system check flagged it, install and sign in:
      <code className="mt-2 block rounded-lg bg-[var(--field)] px-2 py-1 font-mono text-[11px] text-[var(--cyan)]">
        claude   # then /login
      </code>
      <span className="mt-2 block">
        Signing in happens in the terminal — Jarvis never sees or stores those credentials.
      </span>
    </div>
  );
}

function ProfileStep() {
  const qc = useQueryClient();
  const { data } = useQuery<{ md: string }>({
    queryKey: ["memory-file", "about-me.md"],
    queryFn: async () => (await fetch("/api/memory/file?name=about-me.md")).json(),
  });
  const [text, setText] = useState<string | null>(null);
  const value = text ?? data?.md ?? "";
  const save = useMutation({
    mutationFn: async () => fetch("/api/memory/file", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "about-me.md", md: value }),
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["memory-file", "about-me.md"] }),
  });
  return (
    <div>
      <textarea
        value={value}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        rows={10}
        className="w-full rounded-xl border border-[var(--line)] bg-[var(--field)] p-3 font-mono text-[12px] text-[var(--text)] outline-none focus:border-[var(--cyan)]"
      />
      <button
        onClick={() => save.mutate()}
        className="mt-3 rounded-full border border-[var(--cyan)] px-4 py-1.5 text-[12px] text-[var(--cyan)] hover:bg-[var(--cyan-2)]"
      >
        {save.isPending ? "Saving…" : "Save"}
      </button>
    </div>
  );
}

function VaultStep() {
  const { data } = useQuery<{ dir?: string; default?: string }>({
    queryKey: ["vault"],
    queryFn: async () => (await fetch("/api/vault")).json(),
  });
  return (
    <div className="text-[12.5px] text-[var(--dim)]">
      {data?.dir
        ? <>Notes, calls and memory live in <code className="text-[var(--cyan)]">{data.dir}</code>. Change it in Settings.</>
        : <>No vault configured yet — Settings can point Jarvis at one (default <code className="text-[var(--cyan)]">{data?.default}</code>).</>}
    </div>
  );
}

function CalendarStep({ configured }: { configured?: boolean }) {
  // "Proves the connection using safe status information": event COUNT and
  // last-fetch time, never the feed URL and never event contents.
  const { data } = useQuery<{ enabled?: boolean; fetchedAt?: number; events?: unknown[] }>({
    queryKey: ["calendar"],
    queryFn: async () => (await fetch("/api/calendar")).json(),
    enabled: Boolean(configured),
  });
  if (!configured) {
    return (
      <div className="text-[12.5px] text-[var(--dim)]">
        Not connected. Add the feed in <b className="text-[var(--text)]">Settings → Calendar</b> — the URL is a
        credential, so it is entered there and never shown back here.
      </div>
    );
  }
  const n = data?.events?.length ?? 0;
  return (
    <div className="text-[12.5px] text-[var(--dim)]">
      Connected. Last fetch {data?.fetchedAt ? new Date(data.fetchedAt).toLocaleString() : "pending"} ·{" "}
      <b className="text-[var(--text)]">{n}</b> event{n === 1 ? "" : "s"} visible.
      <span className="mt-1 block text-[11px]">Counts only — Jarvis does not display the feed address here.</span>
    </div>
  );
}

type Perms = { microphone: string; screen: string; appBuilt: boolean; screenNote: string };

function MeetingsStep() {
  const { data } = useQuery<{ whisperModel?: string }>({
    queryKey: ["settings"],
    queryFn: async () => (await fetch("/api/settings")).json(),
  });

  // Permissions are asked of JarvisAudio itself, not inferred. They are also
  // re-read when the window regains focus: granting happens in System
  // Settings, so the moment the owner comes back is exactly when the answer
  // has changed and a stale "denied" would be actively misleading.
  const { data: perms, refetch, isFetching } = useQuery<Perms>({
    queryKey: ["permissions"],
    queryFn: async () => (await fetch("/api/permissions")).json(),
    refetchOnWindowFocus: true,
    staleTime: 0,
  });

  const openPane = (pane: "microphone" | "screen") =>
    fetch("/api/permissions/open", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pane }),
    });

  const row = (label: string, state: string | undefined, pane: "microphone" | "screen", why: string) => {
    const granted = state === "granted";
    return (
      <div className="mt-2 flex items-start gap-2.5 rounded-xl border border-[var(--line)] bg-[var(--surf-2)] p-3">
        <span className={`mt-[5px] h-[7px] w-[7px] shrink-0 rounded-full ${
          granted ? "bg-[var(--green)]" : "bg-[var(--amber)]"
        }`} />
        <span className="min-w-0 flex-1">
          <span className="text-[12.5px] text-[var(--text)]">{label}</span>
          <span className="ml-2 font-mono text-[9.5px] uppercase tracking-[1px] text-[var(--dim)]">
            {state ?? "checking"}
          </span>
          {/* the explanation comes BEFORE the prompt, not after it */}
          <span className="mt-1 block text-[11px] text-[var(--dim)]">{why}</span>
        </span>
        {!granted && (
          <button
            onClick={() => openPane(pane)}
            className="shrink-0 rounded-full border border-[var(--cyan)] px-3 py-1 text-[11px] text-[var(--cyan)] hover:bg-[var(--cyan-2)]"
          >
            Open Settings
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="text-[12.5px] leading-relaxed text-[var(--dim)]">
      Recording needs a transcription model and two macOS permissions. Nothing is requested
      unless you turn recording on.
      <code className="mt-2 block rounded-lg bg-[var(--field)] px-2 py-1 font-mono text-[11px] text-[var(--cyan)]">
        jarvis model medium
      </code>
      <span className="mt-2 block">
        Model in use: <b className="text-[var(--text)]">{data?.whisperModel ?? "none"}</b>
      </span>

      {perms?.appBuilt === false ? (
        <div className="mt-3 text-[11.5px]">
          Jarvis Audio is not built yet — run <code className="text-[var(--cyan)]">jarvis setup</code> first.
        </div>
      ) : (
        <>
          {row("Microphone", perms?.microphone, "microphone",
               "Records your side of a call. Without it, notes capture only the other person.")}
          {/* A plain string, not JSX text — HTML entities are not parsed here,
              so "&amp;" rendered literally as "&amp;" on screen. */}
          {row("Screen & System Audio", perms?.screen, "screen",
               `How Jarvis hears the other side.${perms?.screenNote ? ` ${perms.screenNote}` : ""}`)}
          <button
            onClick={() => void refetch()}
            className="mt-3 rounded-full border border-[var(--line)] px-3 py-1 text-[11px] text-[var(--dim)] hover:border-[var(--cyan)] hover:text-[var(--cyan)]"
          >
            {isFetching ? "Checking…" : "Re-check"}
          </button>
        </>
      )}
    </div>
  );
}

function ServiceStep() {
  return (
    <div className="text-[12.5px] leading-relaxed text-[var(--dim)]">
      Without this, Jarvis only runs while you have it open — and calls are missed.
      <code className="mt-2 block rounded-lg bg-[var(--field)] px-2 py-1 font-mono text-[11px] text-[var(--cyan)]">
        jarvis service install
      </code>
    </div>
  );
}
