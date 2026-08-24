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
  { id: "reminders", label: "Reminders" },
  { id: "memory", label: "Memory" },
  { id: "diagnostics", label: "Diagnostics" },
  { id: "backup", label: "Backup & migrate" },
  { id: "tokens", label: "Token usage" },
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
  // same rules as the server's badName: topics become vault filenames
  const badChar = /[/\\[\]#|]/.test(newName);
  const nameOk = newName.trim().length > 0 && newName.trim().length <= 60 && !badChar;
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
          onKeyDown={(e) => { if (e.key === "Enter" && nameOk) { post("/api/topics", { name: newName.trim() }); setNewName(""); } }}
          placeholder="New topic (Title Case, 1-3 words)…"
          className="w-[260px] rounded-full border border-[var(--line)] bg-[var(--field)] px-3 py-1 font-sans text-[12px] text-[var(--text)] outline-none placeholder:text-[var(--dim)] focus:border-[var(--indigo-3)]"
        />
        <button
          onClick={() => { if (nameOk) { post("/api/topics", { name: newName.trim() }); setNewName(""); } }}
          disabled={!nameOk}
          className="rounded-full border border-[var(--indigo-3)] bg-[var(--indigo-2)] px-3 py-1 font-sans text-[12px] text-[var(--indigo)] hover:bg-[var(--indigo-3)] disabled:cursor-default disabled:opacity-40"
        >＋ Add</button>
      </div>
      {newName && !nameOk && (
        <p className="mb-3 -mt-1 font-sans text-[10.5px] text-[var(--amber)]">
          {badChar
            ? <>Topic names can't contain <code>/ \ [ ] # |</code> — they become vault filenames.</>
            : "Topic names max out at 60 characters."}
        </p>
      )}
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


// scheduled jobs from the reminders engine — the file data/reminders.json
// rendered honestly: pause/resume and delete, creation happens in chat
// ("Jarvis, remind me…") or via the API
function RemindersSection() {
  const qc = useQueryClient();
  const { data: jobs = [] } = useQuery<any[]>({
    queryKey: ["reminders"],
    queryFn: async () => (await fetch("/api/reminders")).json(),
    refetchInterval: 30_000,
  });
  const post = async (url: string) => {
    await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => {});
    qc.invalidateQueries({ queryKey: ["reminders"] });
  };
  const when = (j: any): string => {
    if (j.schedule.kind === "at") return `once at ${j.schedule.at}`;
    if (j.schedule.kind === "cron") return `cron ${j.schedule.expr} (local)`;
    const m = Math.round(j.schedule.everyMs / 60_000);
    return m >= 60 && m % 60 === 0 ? `every ${m / 60}h` : `every ${m}m`;
  };
  return (
    <section className="mb-12">
      <Heading
        id="reminders"
        title="Reminders"
        desc={'Scheduled nudges and the heartbeat pulse. Create them by asking — "Jarvis, remind me Monday 9am to…" — from chat, voice, or Telegram. Delivery is a notification here plus a Telegram message.'}
      />
      {jobs.length === 0 && (
        <p className="font-sans text-[11.5px] text-[var(--dim)]">Nothing scheduled yet.</p>
      )}
      <div className="flex flex-col gap-2">
        {jobs.map((j) => (
          <div key={j.id} className="group flex items-center gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surf)] px-4 py-3 [box-shadow:var(--shadow)]">
            <span className={`h-[8px] w-[8px] shrink-0 rounded-full ${
              j.enabled
                ? j.state?.lastStatus === "error" ? "bg-[var(--red)]" : "bg-[var(--green)]"
                : "bg-[var(--dim)] opacity-50"}`} />
            <span className="min-w-0 flex-1">
              <span className={`block truncate text-[13px] font-semibold ${j.enabled ? "text-[var(--bright)]" : "text-[var(--dim)]"}`}>
                {j.name}
              </span>
              <span className="block text-[10px] text-[var(--dim)]">
                {when(j)}
                {j.state?.lastRunAt && ` · last ${new Date(j.state.lastRunAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`}
                {j.state?.lastStatus && ` · ${j.state.lastStatus === "quiet" ? "quiet (nothing to flag)" : j.state.lastStatus}`}
              </span>
            </span>
            <button
              onClick={() => post(`/api/reminders/${j.id}/toggle`)}
              className={`shrink-0 rounded-full border px-3 py-[3px] text-[9.5px] tracking-[1px] ${
                j.enabled
                  ? "border-[var(--line)] text-[var(--dim)] hover:border-[var(--amber)] hover:text-[var(--amber)]"
                  : "border-[var(--cyan-3)] bg-[var(--cyan-2)] text-[var(--cyan)]"}`}
            >
              {j.enabled ? "PAUSE" : "RESUME"}
            </button>
            <button
              onClick={() => post(`/api/reminders/${j.id}/delete`)}
              title="Delete this reminder"
              className="invisible shrink-0 rounded-full border border-[var(--line)] px-2 py-[3px] text-[10px] text-[var(--dim)] hover:border-[var(--red)] hover:text-[var(--red)] group-hover:visible"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <p className="mt-2 font-sans text-[10.5px] text-[var(--dim)]">
        The heartbeat's checklist lives in memory/HEARTBEAT.md; cadence and quiet hours in
        memory/settings/heartbeat-minutes.txt and heartbeat-quiet.txt.
      </p>
    </section>
  );
}


// token accounting from ~/.claude transcripts — read-side, estimates only
function TokensSection() {
  const { data } = useQuery<any>({
    queryKey: ["tokens"],
    queryFn: async () => (await fetch("/api/tokens")).json(),
    staleTime: 60_000,
  });
  const fmt = (n: number) => (n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "k" : String(n));
  const today = new Date().toLocaleDateString("sv-SE");
  const t = data?.totals;
  const d0 = data?.days?.find((d: any) => d.date === today);
  const week = (data?.days ?? []).slice(0, 7).reduce((a: number, d: any) => a + d.cost, 0);
  const tiles: Array<[string, string, string]> = t ? [
    ["TODAY", `$${(d0?.cost ?? 0).toFixed(2)}`, d0 ? `${fmt(d0.in + d0.cacheWrite)} in · ${fmt(d0.out)} out` : "no usage yet"],
    ["LAST 7 DAYS", `$${week.toFixed(2)}`, `${(data.days ?? []).slice(0, 7).length} active days`],
    ["ALL TRACKED", `$${t.cost.toFixed(2)}`, `${fmt(t.out)} out · ${t.turns} turns`],
  ] : [];
  return (
    <section className="mb-12">
      <Heading
        id="tokens"
        title="Token usage"
        desc="Aggregated from the local Claude Code transcripts every Jarvis run writes — chat, workers (including code workers inside your project folders), digest, transcription notes, heartbeat. Costs are estimates from list prices; cache reads are the cheap ones."
      />
      <div className="mb-3 grid grid-cols-3 gap-3">
        {tiles.map(([l, v, sub]) => (
          <div key={l} className="rounded-2xl border border-[var(--line)] bg-[var(--surf)] p-4 [box-shadow:var(--shadow)]">
            <div className="text-[9px] tracking-[2px] text-[var(--dim)]">{l}</div>
            <div className="mt-1 text-[24px] font-semibold text-[var(--bright)] [font-family:var(--display)]">{v}</div>
            <div className="text-[10px] text-[var(--dim)]">{sub}</div>
          </div>
        ))}
      </div>
      {data?.byModel && (
        <div className="mb-3 flex flex-wrap gap-2">
          {Object.entries(data.byModel).map(([m, b]: [string, any]) => (
            <span key={m} className="rounded-full border border-[var(--line)] bg-[var(--surf-2)] px-3 py-[3px] text-[10px] text-[var(--dim)]">
              <b className="text-[var(--text)]">{m.replace("claude-", "").replace(/-\d{8}$/, "")}</b>
              {"  "}{b.turns} turns · {fmt(b.out)} out · ${b.cost.toFixed(2)}
            </span>
          ))}
        </div>
      )}
      {data?.bySource && Object.keys(data.bySource).length > 1 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {Object.entries(data.bySource)
            .sort(([, a]: any, [, b]: any) => b.cost - a.cost)
            .map(([src, b]: [string, any]) => (
              <span key={src} className={`rounded-full border px-3 py-[3px] text-[10px] ${
                src === "jarvis core"
                  ? "border-[var(--cyan-3)] bg-[var(--cyan-2)] text-[var(--cyan)]"
                  : "border-[var(--line)] bg-[var(--surf-2)] text-[var(--dim)]"}`}>
                <b className={src === "jarvis core" ? "" : "text-[var(--text)]"}>{src.length > 28 ? "…" + src.slice(-28) : src}</b>
                {"  "}{b.turns} turns · ${b.cost.toFixed(2)}
              </span>
            ))}
        </div>
      )}
      {(data?.days ?? []).length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surf)] [box-shadow:var(--shadow)]">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-left text-[8.5px] tracking-[1.5px] text-[var(--dim)]">
                {["DAY", "IN", "OUT", "CACHE WRITE", "CACHE READ", "TURNS", "EST COST"].map((h, i) => (
                  <th key={h} className={`px-3 py-2 font-normal ${i > 0 ? "text-right" : ""}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="font-sans">
              {(data.days as any[]).slice(0, 14).map((d) => (
                <tr key={d.date} className="border-t border-[var(--line)] text-[var(--text)]">
                  <td className="px-3 py-[7px] font-mono text-[10.5px] text-[var(--dim)]">{d.date}</td>
                  <td className="px-3 py-[7px] text-right">{fmt(d.in)}</td>
                  <td className="px-3 py-[7px] text-right">{fmt(d.out)}</td>
                  <td className="px-3 py-[7px] text-right text-[var(--dim)]">{fmt(d.cacheWrite)}</td>
                  <td className="px-3 py-[7px] text-right text-[var(--dim)]">{fmt(d.cacheRead)}</td>
                  <td className="px-3 py-[7px] text-right text-[var(--dim)]">{d.turns}</td>
                  <td className="px-3 py-[7px] text-right font-semibold text-[var(--bright)]">${d.cost.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}


// core-memory editor: the .md files in memory/ that ride in every chat's
// system prompt. Canonical stubs offered when missing; freeform files too.
function MemorySection() {
  const qc = useQueryClient();
  const { data: files = [] } = useQuery<Array<{ name: string; missing: boolean; updated: number }>>({
    queryKey: ["memoryFiles"],
    queryFn: async () => (await fetch("/api/memory")).json(),
  });
  const [active, setActive] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [savedTick, setSavedTick] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const openFile = async (name: string) => {
    const r = await (await fetch(`/api/memory/file?name=${encodeURIComponent(name)}`)).json();
    setActive(name);
    setDraft(r.md ?? "");
  };
  const save = async () => {
    if (!active) return;
    await fetch("/api/memory/file", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: active, md: draft }),
    }).catch(() => {});
    qc.invalidateQueries({ queryKey: ["memoryFiles"] });
    setSavedTick(true);
    setTimeout(() => setSavedTick(false), 1800);
  };
  return (
    <section className="mb-12">
      <Heading
        id="memory"
        title="Memory"
        desc="Jarvis's core memory — every markdown file here is loaded into the start of every conversation. about-me tells it who you are; active-projects drives the daily digest; HEARTBEAT.md is the background pulse's checklist. Add any file for facts that should persist."
      />
      <div className="mb-3 flex flex-wrap gap-1.5">
        {files.map((f) => (
          <button
            key={f.name}
            onClick={() => openFile(f.name)}
            className={`rounded-full border px-3 py-[4px] font-sans text-[11.5px] transition ${
              active === f.name
                ? "border-[var(--cyan-3)] bg-[var(--cyan-2)] text-[var(--cyan)]"
                : f.missing
                  ? "border-dashed border-[var(--line-2)] text-[var(--dim)] hover:text-[var(--bright)]"
                  : "border-[var(--line)] bg-[var(--surf-2)] text-[var(--text)] hover:border-[var(--cyan-3)]"}`}
          >
            {f.name}{f.missing ? " · create" : ""}
          </button>
        ))}
        <button
          onClick={() => setShowNew(true)}
          className="rounded-full border border-[var(--line)] px-3 py-[4px] font-sans text-[11.5px] text-[var(--dim)] hover:border-[var(--cyan)] hover:text-[var(--cyan)]"
        >＋ new file</button>
      </div>
      {active && (
        <div>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
            className="h-[300px] w-full resize-y rounded-xl border border-[var(--line)] bg-[var(--field)] p-4 font-mono text-[12.5px] leading-relaxed text-[var(--text)] outline-none focus:border-[var(--cyan-3)]"
          />
          <div className="mt-2 flex items-center gap-3">
            <button
              onClick={save}
              className="rounded-lg border border-[var(--cyan-3)] bg-[var(--cyan-2)] px-4 py-1.5 text-[10px] tracking-wider text-[var(--cyan)] hover:bg-[var(--cyan-3)]"
            >
              SAVE {active}
            </button>
            {savedTick && <span className="text-xs text-[var(--green)]">✓ Saved — next conversation picks it up</span>}
          </div>
        </div>
      )}
      <PromptDialog
        open={showNew}
        title="New memory file"
        placeholder="file-name.md"
        onSubmit={(v) => {
          const name = v.trim().endsWith(".md") ? v.trim() : v.trim() + ".md";
          fetch("/api/memory/file", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, md: `# ${name.replace(/\.md$/, "")}\n\n` }),
          }).then(() => { qc.invalidateQueries({ queryKey: ["memoryFiles"] }); openFile(name); });
        }}
        onClose={() => setShowNew(false)}
      />
    </section>
  );
}

// export/import the whole personal state as one zip
function BackupSection() {
  const [importing, setImporting] = useState<string | null>(null);
  const onImport = async (file: File) => {
    setImporting("importing…");
    try {
      const r = await fetch("/api/backup/import", {
        method: "POST",
        headers: { "Content-Type": "application/zip" },
        body: file,
      });
      const j = await r.json();
      setImporting(j.ok
        ? `✓ merged ${Object.entries(j.merged).map(([k, v]) => `${k}: ${v}`).join(", ")} — run jarvis restart`
        : `✕ ${j.error ?? "import failed"}`);
    } catch (e) {
      setImporting(`✕ ${String(e).slice(0, 80)}`);
    }
  };
  return (
    <section className="mb-12">
      <Heading
        id="backup"
        title="Backup & migrate"
        desc="One zip carries everything personal — memory, call notes and transcripts, digests, reminders, the brain vault (when it lives inside Jarvis), and your API keys. Raw call audio is excluded. Import it on another Jarvis to move in."
      />
      <div className="flex flex-wrap items-center gap-3">
        <a
          href="/api/backup/export"
          className="rounded-lg border border-[var(--cyan-3)] bg-[var(--cyan-2)] px-4 py-2 font-sans text-[12px] text-[var(--cyan)] no-underline hover:bg-[var(--cyan-3)]"
        >
          ⬇ Export backup zip
        </a>
        <label className="cursor-pointer rounded-lg border border-[var(--line)] px-4 py-2 font-sans text-[12px] text-[var(--text)] hover:border-[var(--cyan-3)]">
          ⬆ Import backup zip
          <input
            type="file"
            accept=".zip,application/zip"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onImport(f); e.target.value = ""; }}
          />
        </label>
        {importing && <span className="font-sans text-[11.5px] text-[var(--dim)]">{importing}</span>}
      </div>
      <p className="mt-2 font-sans text-[10.5px] text-[var(--amber)]">
        The export contains secrets/.env (Telegram / calendar keys) — treat the zip like a password.
      </p>
      <p className="mt-1 font-sans text-[10.5px] text-[var(--dim)]">
        Import merges: backup contents win on conflicts, existing extra files survive.
      </p>
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

          <RemindersSection />

          <MemorySection />

          <TokensSection />

          <BackupSection />

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
