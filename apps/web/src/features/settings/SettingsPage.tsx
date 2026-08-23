// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// ⚙ Settings — voice listening modes, call recording, transcription, speech
// voice. Non-secret preferences only; changes auto-save with a saved tick.
// v2 layout: a SETTINGS section rail on the left scrolls the single content
// column; each section is a display-face heading + cards.
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as S from "@jarvis/shared";
import { useSettings } from "../voice/HeaderVoice";
import { PromptDialog } from "../../components/PromptDialog";

function useVoices() {
  return useQuery({
    queryKey: ["voices"],
    queryFn: async () => S.VoicesInfo.parse(await (await fetch("/api/voices")).json()),
  });
}

const VOICE_MODES: Array<{ key: S.VoiceMode; title: string; desc: string; warn?: string; icon: string }> = [
  {
    key: "on-demand",
    title: "On-demand",
    desc: "Click the mic, say one thing, it stops. Nothing is captured unless you ask.",
    icon: "M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z M6 11a6 6 0 0 0 12 0 M12 17v4",
  },
  {
    key: "wake-word",
    title: "Wake word",
    desc: "Mic stays open, but only sentences starting with “Jarvis …” are sent — everything else is discarded locally. Keeps listening ~8s after a reply.",
    icon: "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
  },
  {
    key: "conversation",
    title: "Conversation",
    desc: "Mic stays open and everything you say goes to Jarvis. Best for a focused back-and-forth session.",
    warn: "Careful in meetings — every spoken sentence becomes a query.",
    icon: "M4 5h16v11H10l-5 4v-4H4z",
  },
];

const SECTIONS: Array<{ id: string; label: string }> = [
  { id: "voice", label: "Voice" },
  { id: "recording", label: "Call recording" },
  { id: "speaking", label: "Speaking voice" },
  { id: "diagnostics", label: "Diagnostics" },
  { id: "topics", label: "Topics" },
];

function Heading({ id, title, desc, right }: { id: string; title: string; desc?: string; right?: React.ReactNode }) {
  return (
    <div id={id} className="mb-4 scroll-mt-6 pt-2">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[22px] font-semibold text-[var(--bright)] [font-family:var(--display)]">{title}</h2>
        {right}
      </div>
      {desc && <p className="mt-1 max-w-[640px] font-sans text-[12.5px] leading-relaxed text-[var(--dim)]">{desc}</p>}
    </div>
  );
}

function TopicsSection() {
  const qc = useQueryClient();
  const { data: topics = [] } = useQuery<{ name: string; created: string }[]>({
    queryKey: ["topics"],
    queryFn: async () => (await fetch("/api/topics")).json(),
  });
  // usage counts from the same graph the Brain page renders
  const { data: graph } = useQuery<any>({
    queryKey: ["graph"],
    queryFn: async () => (await fetch("/api/graph")).json(),
    staleTime: 60_000,
  });
  const counts = new Map<string, number>();
  for (const l of graph?.links ?? []) {
    const t = typeof l.target === "object" ? l.target?.id : l.target;
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const post = async (url: string, body: object) => {
    await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => {});
    qc.invalidateQueries({ queryKey: ["topics"] });
    qc.invalidateQueries({ queryKey: ["graph"] });
  };
  const sorted = [...topics].sort((a, b) => (counts.get(b.name) ?? 0) - (counts.get(a.name) ?? 0));
  return (
    <section className="mb-12">
      <Heading
        id="topics"
        title="Topics"
        desc="The knowledge-graph vocabulary. Calls and notes are tagged with these topics ([[wikilinks]] in your brain vault); the summarizer strongly prefers this list, so curating it keeps the graph tidy. Renaming a topic MERGES it — every link across your calls and notes is rewritten."
      />
      <div className="mb-3 flex gap-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && newName.trim()) { post("/api/topics", { name: newName.trim() }); setNewName(""); } }}
          placeholder="New topic (Title Case, 1-3 words)…"
          className="w-[260px] rounded-full border border-[var(--line)] bg-[var(--field)] px-3 py-1 font-sans text-[12px] text-[var(--text)] outline-none placeholder:text-[var(--dim)] focus:border-[var(--indigo-3)]"
        />
        <button
          onClick={() => { if (newName.trim()) { post("/api/topics", { name: newName.trim() }); setNewName(""); } }}
          className="rounded-full border border-[var(--indigo-3)] bg-[var(--indigo-2)] px-3 py-1 font-sans text-[12px] text-[var(--indigo)] hover:bg-[var(--indigo-3)]"
        >＋ Add</button>
      </div>
      <div className="flex max-w-[680px] flex-wrap gap-1.5">
        {sorted.map((t) => (
          <span key={t.name} className="group flex items-center gap-1.5 rounded-full border border-[var(--indigo-3)] bg-[var(--indigo-2)] px-2.5 py-[3px] font-sans text-[11.5px] text-[var(--text)]">
            {t.name}
            <span className="text-[10px] text-[var(--dim)]">{counts.get(t.name) ?? 0}</span>
            <button title="Rename / merge into another topic" onClick={() => setRenaming(t.name)}
              className="invisible cursor-pointer text-[10px] text-[var(--dim)] hover:text-[var(--cyan)] group-hover:visible">✎</button>
            <button title="Delete the hub page (links elsewhere become plain references)"
              onClick={() => post("/api/topics/delete", { name: t.name })}
              className="invisible cursor-pointer text-[10px] text-[var(--dim)] hover:text-[var(--red)] group-hover:visible">✕</button>
          </span>
        ))}
        {!sorted.length && <span className="font-sans text-[11.5px] text-[var(--dim)]">No topics yet — they appear as calls are processed, or add one above.</span>}
      </div>
      <PromptDialog
        open={renaming !== null}
        title={`Rename "${renaming}" — merges every [[${renaming}]] link`}
        placeholder="New name (existing topic name = merge into it)"
        onSubmit={(v: string) => { if (renaming && v.trim()) post("/api/topics/rename", { from: renaming, to: v.trim() }); setRenaming(null); }}
        onClose={() => setRenaming(null)}
      />
    </section>
  );
}

export function SettingsPage() {
  const { data: settings } = useSettings();
  const { data: voices } = useVoices();
  const qc = useQueryClient();
  const [saved, setSaved] = useState(false);
  const [section, setSection] = useState("voice");
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

  const jump = (id: string) => {
    setSection(id);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="flex h-full font-sans">
      {/* section rail */}
      <aside className="flex w-[200px] shrink-0 flex-col overflow-auto border-r border-[var(--line)] bg-[var(--surf)] px-4 py-8">
        <div className="mb-2 text-[9px] tracking-[2px] text-[var(--dim)]">SETTINGS</div>
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            onClick={() => jump(s.id)}
            className={`mb-1 w-full rounded-lg border px-3 py-[7px] text-left text-[12px] ${
              section === s.id
                ? "border-[var(--cyan-3)] bg-[var(--cyan-2)] text-[var(--cyan)]"
                : "border-transparent text-[var(--dim)] hover:bg-[var(--surf-2)] hover:text-[var(--bright)]"}`}
          >
            {s.label}
          </button>
        ))}
        <p className="mt-6 px-1 text-[11px] leading-relaxed text-[var(--dim)]">
          Non-secret preferences only. Changes auto-save.
        </p>
      </aside>

      {/* content */}
      <div className="min-w-0 flex-1 overflow-auto px-10 py-8">
        <div className="mx-auto max-w-[820px]">
          <section className="mb-12">
            <Heading
              id="voice"
              title="Voice"
              desc="How Jarvis listens. In the open-mic modes it keeps listening through silence, mutes itself while speaking, and tells the call recorder the hot mic is voice control."
              right={
                <span className={`flex items-center gap-1 text-xs text-[var(--green)] transition-opacity ${saved ? "opacity-100" : "opacity-0"}`}>
                  ✓ SAVED
                </span>
              }
            />
            <div className="grid gap-3 md:grid-cols-3">
              {VOICE_MODES.map((m) => {
                const active = settings.voiceMode === m.key;
                return (
                  <button
                    key={m.key}
                    onClick={() => patch.mutate({ voiceMode: m.key })}
                    className={`rounded-2xl border p-4 text-left transition ${
                      active
                        ? "border-[var(--cyan-3)] bg-[var(--cyan-2)]"
                        : "border-[var(--line)] bg-[var(--surf)] [box-shadow:var(--shadow)] hover:border-[var(--cyan-3)]"}`}
                  >
                    <div className="mb-3 flex items-start justify-between">
                      <span className={`flex h-[34px] w-[34px] items-center justify-center rounded-lg ${active ? "bg-[var(--cyan-3)] text-[var(--cyan)]" : "bg-[var(--surf-2)] text-[var(--dim)]"}`}>
                        <svg viewBox="0 0 24 24" className="h-[15px] w-[15px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
                          <path d={m.icon} />
                        </svg>
                      </span>
                      <span
                        className={`mt-1 h-3 w-3 rounded-full border ${
                          active
                            ? "border-[var(--cyan)] bg-[var(--cyan)] shadow-[0_0_8px_var(--cyan)]"
                            : "border-[var(--dim)]"}`}
                      />
                    </div>
                    <div className="text-[13.5px] font-semibold text-[var(--bright)]">{m.title}</div>
                    <div className="mt-1 text-xs leading-relaxed text-[var(--dim)]">{m.desc}</div>
                    {m.warn && <div className="mt-2 text-xs leading-relaxed text-[var(--amber)]">{m.warn}</div>}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="mb-12">
            <Heading id="recording" title="Call recording" />
            <label className="flex items-center justify-between rounded-2xl border border-[var(--line)] bg-[var(--surf)] p-4 [box-shadow:var(--shadow)]">
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
                    ? "border-[var(--cyan-3)] bg-[var(--cyan-2)]"
                    : "border-[var(--line)] bg-[var(--surf-2)]"
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
              <label className="rounded-2xl border border-[var(--line)] bg-[var(--surf)] p-4 [box-shadow:var(--shadow)]">
                <span className="block text-[13px] font-semibold text-[var(--bright)]">
                  Transcription model
                </span>
                <span className="text-[10.5px] text-[var(--dim)]">medium = better names, ~3× slower</span>
                <select
                  value={settings.whisperModel}
                  onChange={(e) => patch.mutate({ whisperModel: e.target.value as "base" | "small" | "medium" })}
                  className="mt-3 w-full rounded-lg border border-[var(--line)] bg-[var(--field)] px-3 py-2 font-sans text-[12px] text-[var(--text)] outline-none focus:border-[var(--cyan)]"
                >
                  <option value="medium">medium (recommended)</option>
                  <option value="base">base (fastest)</option>
                  <option value="small">small (faster)</option>
                </select>
              </label>
              <label className="rounded-2xl border border-[var(--line)] bg-[var(--surf)] p-4 [box-shadow:var(--shadow)]">
                <span className="block text-[13px] font-semibold text-[var(--bright)]">
                  Keep call audio
                </span>
                <span className="text-[10.5px] text-[var(--dim)]">days before recordings are purged · 1–90</span>
                <span className="mt-2 flex items-baseline gap-2">
                  <input
                    type="number"
                    min={1}
                    max={90}
                    defaultValue={settings.retentionDays}
                    onBlur={(e) => {
                      const v = Math.min(90, Math.max(1, parseInt(e.target.value, 10) || 7));
                      if (v !== settings.retentionDays) patch.mutate({ retentionDays: v });
                    }}
                    className="w-[84px] rounded-lg border border-[var(--line)] bg-[var(--field)] px-3 py-1 text-[26px] font-semibold text-[var(--bright)] outline-none [font-family:var(--display)] focus:border-[var(--cyan)]"
                  />
                  <span className="text-[11px] text-[var(--dim)]">days</span>
                </span>
              </label>
            </div>
          </section>

          <section className="mb-12">
            <Heading id="speaking" title="Speaking voice" />
            <label className="block rounded-2xl border border-[var(--line)] bg-[var(--surf)] p-4 [box-shadow:var(--shadow)]">
              <span className="block text-[13px] font-semibold text-[var(--bright)]">
                Jarvis's voice
              </span>
              <span className="text-[10.5px] text-[var(--dim)]">
                ElevenLabs presets from memory/settings/voices.txt — applies immediately
              </span>
              <select
                value={settings.voice}
                onChange={(e) => patch.mutate({ voice: e.target.value })}
                className="mt-3 w-full rounded-lg border border-[var(--line)] bg-[var(--field)] px-3 py-2 font-sans text-[12px] text-[var(--text)] outline-none focus:border-[var(--cyan)]"
              >
                {!voices?.presets.includes(settings.voice) && (
                  <option value={settings.voice}>{settings.voice}</option>
                )}
                {voices?.presets.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </label>
          </section>

          <section className="mb-12">
            <Heading id="diagnostics" title="Diagnostics" />
            <a
              href="/logs"
              className="block rounded-2xl border border-[var(--line)] bg-[var(--surf)] p-4 transition [box-shadow:var(--shadow)] hover:border-[var(--cyan-3)]"
            >
              <span className="block text-[13px] font-semibold text-[var(--bright)]">
                Activity &amp; logs →
              </span>
              <span className="text-xs text-[var(--dim)]">
                Live view of what's running — recording, transcription, workers — with tailing logs,
                so "transcribing…" is never a mystery.
              </span>
            </a>
          </section>

          <TopicsSection />

          <p className="text-[11px] text-[var(--dim)]">
            Model provider settings (OpenAI / Google for summarization) are planned — API keys will
            live only in the gitignored <code>secrets/.env</code>, never in the repo.
          </p>
        </div>
      </div>
    </div>
  );
}
