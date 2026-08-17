// ⚙ Settings — voice listening modes, call recording, transcription, speech
// voice. Non-secret preferences only; changes auto-save with a saved tick.
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as S from "@jarvis/shared";
import { useSettings } from "../voice/HeaderVoice";

function useVoices() {
  return useQuery({
    queryKey: ["voices"],
    queryFn: async () => S.VoicesInfo.parse(await (await fetch("/api/voices")).json()),
  });
}

const VOICE_MODES: Array<{ key: S.VoiceMode; title: string; desc: string; warn?: string }> = [
  {
    key: "on-demand",
    title: "On-demand",
    desc: "Click the mic, say one thing, it stops. Nothing is captured unless you ask.",
  },
  {
    key: "wake-word",
    title: "Wake word — “Jarvis”",
    desc: "The mic stays open, but only sentences starting with “Jarvis …” are sent — everything else is discarded locally. After Jarvis replies, it keeps listening ~8s so you can continue without re-waking.",
  },
  {
    key: "conversation",
    title: "Conversation",
    desc: "The mic stays open and everything you say goes to Jarvis. Best for a focused back-and-forth session.",
    warn: "Careful in meetings — every spoken sentence becomes a query.",
  },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 border-b border-[var(--line)] pb-1 text-[11px] uppercase tracking-[1.5px] text-[var(--cyan)]">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function SettingsPage() {
  const { data: settings } = useSettings();
  const { data: voices } = useVoices();
  const qc = useQueryClient();
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const patch = useMutation({
    mutationFn: async (p: Partial<S.Settings>) => {
      const r = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(p),
      });
      if (!r.ok) throw new Error(`settings → ${r.status}`);
      return S.Settings.parse(await r.json());
    },
    onSuccess: (data) => {
      qc.setQueryData(["settings"], data);
      qc.invalidateQueries({ queryKey: ["autorecord"] });
      qc.invalidateQueries({ queryKey: ["voices"] });
      setSaved(true);
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaved(false), 2000);
    },
  });

  if (!settings)
    return <div className="mt-20 text-center text-xs text-[var(--dim)]">loading…</div>;

  return (
    <div className="mx-auto h-full max-w-[680px] overflow-auto px-6 py-8 font-sans">
      <div className="mb-6 flex items-baseline justify-between">
        <h1 className="text-2xl text-[var(--bright)]">Settings</h1>
        <span
          className={`flex items-center gap-1 text-xs text-[var(--green)] transition-opacity ${saved ? "opacity-100" : "opacity-0"}`}
        >
          ✓ Saved
        </span>
      </div>

      <Section title="Voice listening">
        <div className="flex flex-col gap-2">
          {VOICE_MODES.map((m) => (
            <button
              key={m.key}
              onClick={() => patch.mutate({ voiceMode: m.key })}
              className={`rounded-xl border p-4 text-left transition ${
                settings.voiceMode === m.key
                  ? "border-[rgba(57,215,255,.5)] bg-[rgba(57,215,255,.07)]"
                  : "border-[var(--line)] hover:border-[rgba(57,215,255,.3)]"
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`h-3 w-3 rounded-full border ${
                    settings.voiceMode === m.key
                      ? "border-[var(--cyan)] bg-[var(--cyan)] shadow-[0_0_8px_var(--cyan)]"
                      : "border-[var(--dim)]"
                  }`}
                />
                <span className="text-[13px] font-semibold text-[var(--bright)]">{m.title}</span>
              </div>
              <div className="mt-1 pl-5 text-xs leading-relaxed text-[var(--dim)]">{m.desc}</div>
              {m.warn && (
                <div className="mt-1 pl-5 text-xs text-[var(--amber)]">{m.warn}</div>
              )}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-[var(--dim)]">
          In the open-mic modes Jarvis keeps listening through silence, mutes itself while
          speaking, and tells the call recorder the hot mic is voice control — so it can't be
          mistaken for a Teams call.
        </p>
      </Section>

      <Section title="Call recording">
        <label className="flex items-center justify-between rounded-xl border border-[var(--line)] p-4">
          <span>
            <span className="block text-[13px] font-semibold text-[var(--bright)]">
              Auto-record calls
            </span>
            <span className="text-xs text-[var(--dim)]">
              Detect meetings (browser tabs, Teams desktop, Teams web) and record automatically.
              The Record button always works regardless.
            </span>
          </span>
          <button
            onClick={() => patch.mutate({ autorecord: !settings.autorecord })}
            className={`relative h-[22px] w-[42px] shrink-0 rounded-full border transition ${
              settings.autorecord
                ? "border-[rgba(57,215,255,.5)] bg-[rgba(57,215,255,.25)]"
                : "border-[var(--line)] bg-[rgba(95,137,173,.2)]"
            }`}
          >
            <span
              className={`absolute top-[2px] h-4 w-4 rounded-full transition-all ${
                settings.autorecord
                  ? "left-[22px] bg-[var(--cyan)] shadow-[0_0_8px_var(--cyan)]"
                  : "left-[2px] bg-[var(--dim)]"
              }`}
            />
          </button>
        </label>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="rounded-xl border border-[var(--line)] p-4">
            <span className="block text-[13px] font-semibold text-[var(--bright)]">
              Transcription model
            </span>
            <span className="text-xs text-[var(--dim)]">medium = better names, ~3× slower</span>
            <select
              value={settings.whisperModel}
              onChange={(e) => patch.mutate({ whisperModel: e.target.value as "base" | "small" | "medium" })}
              className="mt-2 w-full rounded-lg border border-[var(--line)] bg-[var(--field)] px-3 py-2 text-[12px] text-[var(--text)] outline-none focus:border-[var(--cyan)]"
            >
              <option value="medium">medium (recommended)</option>
              <option value="base">base (fastest)</option>
              <option value="small">small (faster)</option>
            </select>
          </label>
          <label className="rounded-xl border border-[var(--line)] p-4">
            <span className="block text-[13px] font-semibold text-[var(--bright)]">
              Keep call audio
            </span>
            <span className="text-xs text-[var(--dim)]">days before recordings are purged</span>
            <input
              type="number"
              min={1}
              max={90}
              defaultValue={settings.retentionDays}
              onBlur={(e) => {
                const v = Math.min(90, Math.max(1, parseInt(e.target.value, 10) || 7));
                if (v !== settings.retentionDays) patch.mutate({ retentionDays: v });
              }}
              className="mt-2 w-full rounded-lg border border-[var(--line)] bg-[var(--field)] px-3 py-2 text-[12px] text-[var(--text)] outline-none focus:border-[var(--cyan)]"
            />
          </label>
        </div>
      </Section>

      <Section title="Speaking voice">
        <label className="block rounded-xl border border-[var(--line)] p-4">
          <span className="block text-[13px] font-semibold text-[var(--bright)]">
            Jarvis's voice
          </span>
          <span className="text-xs text-[var(--dim)]">
            ElevenLabs presets from memory/settings/voices.txt — applies immediately
          </span>
          <select
            value={settings.voice}
            onChange={(e) => patch.mutate({ voice: e.target.value })}
            className="mt-2 w-full rounded-lg border border-[var(--line)] bg-[var(--field)] px-3 py-2 text-[12px] text-[var(--text)] outline-none focus:border-[var(--cyan)]"
          >
            {!voices?.presets.includes(settings.voice) && (
              <option value={settings.voice}>{settings.voice}</option>
            )}
            {voices?.presets.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </label>
      </Section>

      <Section title="Diagnostics">
        <a
          href="/logs"
          className="block rounded-xl border border-[var(--line)] p-4 transition hover:border-[rgba(57,215,255,.4)]"
        >
          <span className="block text-[13px] font-semibold text-[var(--bright)]">
            Activity &amp; logs →
          </span>
          <span className="text-xs text-[var(--dim)]">
            Live view of what's running — recording, transcription, workers — with tailing logs,
            so "transcribing…" is never a mystery.
          </span>
        </a>
      </Section>

      <p className="text-[11px] text-[var(--dim)]">
        Model provider settings (OpenAI / Google for summarization) are planned — API keys will
        live only in the gitignored <code>secrets/.env</code>, never in the repo.
      </p>
    </div>
  );
}
