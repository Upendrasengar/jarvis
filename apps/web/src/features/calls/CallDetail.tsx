// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
import { useEffect, useRef, useState } from "react";
import type { Call } from "@jarvis/shared";
import { NotesView } from "./NotesView";
import {
  callHost, callTitle, useDeleteCall, useRecordingControls, useToggleItem, useUpdateNotes,
} from "./hooks";
import { copyNotes } from "./copyNotes";
import { PromptDialog } from "../../components/PromptDialog";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as SS from "@jarvis/shared";
import { TagChips } from "../../components/TagChips";

const STATE: Record<string, { label: string; cls: string }> = {
  recording: { label: "RECORDING", cls: "text-[var(--red)] blip" },
  processing: { label: "TRANSCRIBING", cls: "text-[var(--amber)] blip" },
  done: { label: "NOTES READY", cls: "text-[var(--green)]" },
  failed: { label: "NEEDS RERUN", cls: "text-[var(--amber)]" },
  empty: { label: "NO AUDIO", cls: "text-[var(--dim)]" },
};

function LinkedNotes({ callId }: { callId: string }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: notes = [] } = useQuery({
    queryKey: ["notes"],
    queryFn: async () => SS.NoteMeta.array().parse(await (await fetch("/api/notes")).json()),
  });
  const linked = notes.filter((n) => n.call === callId);
  const create = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: `Notes — call ${callId}`, call: callId }),
      });
      return (await r.json()) as { id: string };
    },
    onSuccess: ({ id }) => { qc.invalidateQueries({ queryKey: ["notes"] }); navigate(`/notes/${id}`); },
  });
  return (
    <span className="flex flex-wrap items-center gap-2">
      {linked.map((n) => (
        <Link
          key={n.id}
          to={`/notes/${n.id}`}
          className="rounded-full border border-[var(--cyan-3)] bg-[var(--cyan-2)] px-[10px] py-[3px] text-[10px] text-[var(--cyan)] hover:bg-[var(--cyan-3)]"
        >
          ✎ {n.title.slice(0, 28)}
        </Link>
      ))}
      <button
        onClick={() => create.mutate()}
        title="Create a note linked to this call"
        className="rounded-full border border-[var(--line)] px-[10px] py-[3px] text-[10px] text-[var(--dim)] hover:border-[var(--cyan)] hover:text-[var(--cyan)]"
      >
        ＋ note
      </button>
    </span>
  );
}

// Dropdown + freeform input to assign an existing topic or mint a new one.
// Assignment writes a [[wikilink]] into the note's **Topics:** line, so the
// brain graph and topic hubs pick it up through the normal pipeline.
function TopicPicker({ linked, onPick }: { linked: string[]; onPick: (t: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);
  const { data: all = [] } = useQuery<Array<{ name: string }>>({
    queryKey: ["topics"],
    queryFn: async () => (await fetch("/api/topics")).json(),
    enabled: open,
  });
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const names = all.map((t) => t.name);
  const query = q.trim();
  const opts = names.filter((n) => !linked.includes(n) && n.toLowerCase().includes(query.toLowerCase()));
  const badChar = /[/\\[\]#|]/.test(query);
  const validName = query.length > 0 && query.length <= 60 && !badChar;
  const canCreate = validName &&
    !names.some((n) => n.toLowerCase() === query.toLowerCase()) &&
    !linked.some((n) => n.toLowerCase() === query.toLowerCase());
  const pick = (t: string) => { onPick(t); setQ(""); setOpen(false); };
  return (
    <div ref={boxRef} className="relative inline-block">
      <button
        onClick={() => setOpen(!open)}
        className="rounded-full border border-[var(--line)] px-[10px] py-[3px] text-[10px] text-[var(--dim)] hover:border-[var(--indigo)] hover:text-[var(--indigo)]"
      >
        ＋ topic
      </button>
      {open && (
        <div className="mt-1 w-[200px] rounded-xl border border-[var(--line)] bg-[var(--surf-2)] p-2">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
              if (e.key === "Enter") {
                if (canCreate) pick(query);
                else if (opts.length) pick(opts[0]);
              }
            }}
            placeholder="Search or create…"
            className="mb-1 w-full rounded-md border border-[var(--line)] bg-[var(--surf-2)] px-2 py-1 font-sans text-[11.5px] text-[var(--text)] outline-none placeholder:text-[var(--dim)] focus:border-[var(--indigo-3)]"
          />
          <div className="max-h-[180px] overflow-auto">
            {opts.map((n) => (
              <button
                key={n}
                onClick={() => pick(n)}
                className="block w-full rounded-md px-2 py-[5px] text-left font-sans text-[11.5px] text-[var(--text)] hover:bg-[var(--indigo-2)]"
              >
                {n}
              </button>
            ))}
            {canCreate && (
              <button
                onClick={() => pick(query)}
                className="block w-full rounded-md px-2 py-[5px] text-left font-sans text-[11.5px] text-[var(--indigo)] hover:bg-[var(--indigo-2)]"
              >
                ＋ Create "{query}"
              </button>
            )}
            {!opts.length && !canCreate && (
              <div className="px-2 py-1 text-[10.5px] text-[var(--dim)]">
                {query && badChar
                  ? <>Topic names can't contain <code className="text-[var(--amber)]">/ \ [ ] # |</code> — they become vault filenames.</>
                  : query.length > 60
                    ? "Topic names max out at 60 characters."
                    : "Type to create a topic"}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Right analytics rail — everything computed from data we already hold:
// open/overdue counts from the notes + triage, topics from [[wikilinks]].
// (The mock's talking-time bars need speaker diarization we don't have.)
function Rail({ call }: { call: Call }) {
  const openCount = (call.notes.match(/^- \[ \] /gm) ?? []).length;
  const { data: triage } = useQuery<{ deadlines?: Record<string, string> }>({
    queryKey: ["triage"],
    queryFn: async () => (await fetch("/api/triage")).json(),
    staleTime: 60_000,
  });
  const today = new Date().toLocaleDateString("sv-SE");
  const overdue = Object.entries(triage?.deadlines ?? {}).filter(
    ([k, d]) => k.startsWith(`${call.id}|`) && d < today,
  ).length;
  // topic = a [[target]] that isn't a call ref and isn't a dated note slug —
  // labels ([[t|label]]) are display-only, the target is the topic name
  const topics = [...new Set(
    [...call.notes.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)]
      .map((m) => m[1].trim())
      .filter((t) => !/^call(-notes)?-\d/.test(t) && !/\d{4}-\d{2}-\d{2}/.test(t)),
  )];
  const save = useUpdateNotes();
  const qc = useQueryClient();
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const addTopic = (t: string) => {
    if (topics.includes(t)) return;
    let notes = call.notes;
    if (/^topics:\s*$/m.test(notes.split(/^---$/m)[1] ?? "") || /^topics:/m.test(notes.slice(0, notes.indexOf("\n---", 3) + 1)))
      // frontmatter topics list — insert right under the "topics:" key
      notes = notes.replace(/^topics:\s*\n/m, `topics:\n  - "[[${t}]]"\n`);
    else if (/^## Related\s*$/m.test(notes))
      notes = notes.replace(/^(## Related\s*\n)/m, `$1- [[${t}]]\n`);
    else if (/^\*\*Topics:\*\*/m.test(notes))
      notes = notes.replace(/^(\*\*Topics:\*\*.*)$/m, `$1 [[${t}]]`);
    else notes = notes.trimEnd() + `\n\n**Topics:** [[${t}]]\n`;
    save.mutate({ id: call.id, notes });
    fetch("/api/topics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: t }),
    }).then(() => qc.invalidateQueries({ queryKey: ["topics"] })).catch(() => {});
  };
  const removeTopic = (t: string) => {
    const ref = `\\[\\[${esc(t)}(?:\\|[^\\]]*)?\\]\\]`;
    const notes = call.notes
      // whole-line list entries: frontmatter '  - "[[t]]"' and Related '- [[t]]'
      .replace(new RegExp(`^\\s*- "?${ref}"?\\s*\\n`, "gm"), "")
      // inline on a legacy **Topics:** line
      .replace(/^(\*\*Topics:\*\*.*)$/m, (line) => line.replace(new RegExp(`\\s*${ref}`), ""));
    if (notes !== call.notes) save.mutate({ id: call.id, notes });
  };
  return (
    <aside className="hidden w-[260px] shrink-0 overflow-auto border-l border-[var(--line)] bg-[var(--surf)] px-5 py-8 xl:block">
      <div className="mb-2 text-[9px] tracking-[2px] text-[var(--dim)]">OPEN ITEMS RAISED</div>
      <div className="mb-6 grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-[var(--line)] bg-[var(--bg)] p-3 text-center">
          <div className="text-[22px] font-semibold text-[var(--cyan)] [font-family:var(--display)]">{openCount}</div>
          <div className="mt-[2px] text-[8.5px] tracking-[1.5px] text-[var(--dim)]">THIS CALL</div>
        </div>
        <div className="rounded-xl border border-[var(--line)] bg-[var(--bg)] p-3 text-center">
          <div className={`text-[22px] font-semibold [font-family:var(--display)] ${overdue ? "text-[var(--amber)]" : "text-[var(--dim)]"}`}>{overdue}</div>
          <div className="mt-[2px] text-[8.5px] tracking-[1.5px] text-[var(--dim)]">OVERDUE</div>
        </div>
      </div>
      <div className="mb-2 text-[9px] tracking-[2px] text-[var(--dim)]">LINKED TOPICS</div>
      <div className="mb-6 flex flex-wrap gap-2">
        {topics.map((t) => (
          <span
            key={t}
            className="group rounded-full border border-[var(--indigo-3)] bg-[var(--indigo-2)] px-[10px] py-[3px] text-[10px] text-[var(--indigo)]"
          >
            {t}
            <button
              onClick={() => removeTopic(t)}
              title={`Unlink ${t} from this call`}
              className="ml-1 hidden text-[var(--dim)] hover:text-[var(--red)] group-hover:inline"
            >
              ×
            </button>
          </span>
        ))}
        <TopicPicker linked={topics} onPick={addTopic} />
      </div>
      <div className="mb-2 text-[9px] tracking-[2px] text-[var(--dim)]">TAGS</div>
      <div className="mb-6 flex flex-wrap gap-2">
        <TagChips md={call.notes} onChange={(md) => save.mutate({ id: call.id, notes: md })} />
      </div>
      <div className="mb-2 text-[9px] tracking-[2px] text-[var(--dim)]">NOTES</div>
      <LinkedNotes callId={call.id} />
    </aside>
  );
}

// in-progress states get a real scene, not a lonely sentence: animated
// equalizer, staged copy, and ghost cards where the notes will land
function StatusScene({ tone, title, sub, extra }: {
  tone: "red" | "amber"; title: string; sub: string; extra?: React.ReactNode;
}) {
  const color = tone === "red" ? "text-[var(--red)]" : "text-[var(--amber)]";
  return (
    <div className="mt-10">
      <div className="flex flex-col items-center gap-3">
        <div className={`flex h-12 items-center gap-[5px] ${color}`}>
          {[0.9, 1.3, 0.7, 1.1, 1.5, 0.8, 1.2].map((d, i) => (
            <span
              key={i}
              className="eqbar h-full w-[5px] rounded-full bg-current"
              style={{ animationDelay: `${i * 0.12}s`, animationDuration: `${d}s` }}
            />
          ))}
        </div>
        <div className="font-sans text-[14px] font-semibold text-[var(--bright)]">{title}</div>
        <div className="font-sans text-[12px] text-[var(--dim)]">{sub} {extra}</div>
      </div>
      <div className="mt-10 grid gap-4 opacity-50 xl:grid-cols-2">
        {[3, 5].map((rows, k) => (
          <div key={k} className="animate-pulse rounded-2xl border border-[var(--line)] bg-[var(--surf)] p-5">
            <div className="mb-4 h-[13px] w-[130px] rounded bg-[var(--surf-2)]" />
            {Array.from({ length: rows }, (_, i) => (
              <div key={i} className="mb-2.5 h-[10px] rounded bg-[var(--surf-2)]" style={{ width: `${88 - i * 9}%` }} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function CallDetail({ call, onDeleted }: { call: Call | null; onDeleted: () => void }) {
  const toggle = useToggleItem();
  const del = useDeleteCall();
  const save = useUpdateNotes();
  const { stop } = useRecordingControls();
  const [armed, setArmed] = useState(false);
  const [draft, setDraft] = useState<string | null>(null); // non-null = editing
  const [toast, setToast] = useState<null | "ok" | "err">(null);
  const [reprocessing, setReprocessing] = useState(false);
  const qc = useQueryClient();
  const [copied, setCopied] = useState(false);
  const [commentFor, setCommentFor] = useState<number | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flash = (k: "ok" | "err") => {
    setToast(k);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  };

  // Local source of truth for sequential inline edits. Rebuilding the note
  // from the query cache raced refetches and could LOSE an earlier edit when
  // two lines were edited quickly — edits now compose against this ref.
  const notesRef = useRef(call?.notes ?? "");
  useEffect(() => { if (call) notesRef.current = call.notes; }, [call?.id]);
  useEffect(() => {
    if (call && !save.isPending) notesRef.current = call.notes;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call?.notes]);

  if (!call)
    return (
      <div className="mt-20 text-center text-xs text-[var(--dim)]">Select a call</div>
    );

  const startEdit = () => setDraft(notesRef.current);
  const saveEdit = () =>
    draft?.trim() &&
    save.mutate(
      { id: call.id, notes: draft },
      {
        onSuccess: () => { notesRef.current = draft; setDraft(null); flash("ok"); },
        onError: () => flash("err"),
      },
    );

  const st = STATE[call.status];

  return (
    <div className="flex h-full font-sans">
      <div className="min-w-0 flex-1 overflow-auto px-10 py-8">
        <div className="mx-auto max-w-[980px]">
          <div className="mb-1 text-[10px] tracking-[1.5px] text-[var(--dim)]">
            RECORDED {new Date(call.started.slice(0, 10) + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }).toUpperCase()} · {call.started.slice(11, 16)}
            {call.url ? ` · ${callHost(call.url).toUpperCase()}` : ""}
            {st && (
              <>
                {" · "}
                <span className={st.cls}>● {st.label}</span>
              </>
            )}
          </div>
          <div className="flex items-start justify-between gap-4">
            <h1 className="text-[26px] leading-tight text-[var(--bright)] [font-family:var(--display)]">{callTitle(call)}</h1>
            <span className="flex shrink-0 gap-2 pt-1">
              {call.status === "recording" ? (
                <button
                  onClick={() => stop.mutate()}
                  disabled={stop.isPending}
                  className="blip rounded-lg border border-[rgba(255,107,132,.5)] bg-[rgba(255,107,132,.08)] px-3 py-1 text-[10px] tracking-wider text-[var(--red)]"
                >
                  {stop.isPending ? "STOPPING…" : "■ STOP & SAVE"}
                </button>
              ) : draft !== null ? (
                <>
                  <button
                    onClick={saveEdit}
                    disabled={save.isPending}
                    className="rounded-lg border border-[rgba(62,224,138,.5)] bg-[rgba(62,224,138,.08)] px-3 py-1 text-[10px] tracking-wider text-[var(--green)] disabled:opacity-50"
                  >
                    {save.isPending ? "SAVING…" : "SAVE"}
                  </button>
                  <button
                    onClick={() => setDraft(null)}
                    className="rounded-lg border border-[var(--line)] px-3 py-1 text-[10px] tracking-wider text-[var(--dim)] hover:text-[var(--bright)]"
                  >
                    CANCEL
                  </button>
                </>
              ) : (
                <>
                  {call.notes && (
                    <button
                      onClick={async () => {
                        if (await copyNotes(notesRef.current)) {
                          setCopied(true);
                          setTimeout(() => setCopied(false), 2000);
                        }
                      }}
                      title="Copy the full notes — rich formatting for Teams/Outlook, markdown for Slack/editors"
                      className="rounded-lg border border-[var(--line)] px-3 py-1 text-[10px] tracking-wider text-[var(--dim)] hover:border-[var(--cyan)] hover:text-[var(--cyan)]"
                    >
                      {copied ? "✓ COPIED" : "COPY"}
                    </button>
                  )}
                  {call.notes && (
                    <button
                      onClick={startEdit}
                      title="Edit the notes — fixes save to the reports file and your vault"
                      className="rounded-lg border border-[var(--line)] px-3 py-1 text-[10px] tracking-wider text-[var(--dim)] hover:border-[var(--cyan)] hover:text-[var(--cyan)]"
                    >
                      EDIT
                    </button>
                  )}
                  <button
                    onClick={() => {
                      if (!armed) { setArmed(true); setTimeout(() => setArmed(false), 2500); return; }
                      del.mutate(call.id, { onSuccess: onDeleted });
                    }}
                    className="rounded-lg border border-[var(--line)] px-3 py-1 text-[10px] tracking-wider text-[var(--dim)] hover:border-[var(--red)] hover:text-[var(--red)]"
                  >
                    {armed ? "SURE?" : "DELETE"}
                  </button>
                </>
              )}
            </span>
          </div>

          {call.status === "recording" && (
            <StatusScene
              tone="red"
              title="Recording — both sides captured"
              sub="Stop & Save ends it now; otherwise it stops ~30s after the call ends. Audio never leaves this machine."
            />
          )}
          {call.status === "processing" && !call.notes && (
            <StatusScene
              tone="amber"
              title="Transcribing locally, then writing notes"
              sub="Whisper runs on this machine — a long call can take a few minutes."
              extra={
                <a href={`/logs?src=call:${call.id}`} className="text-[var(--cyan)] hover:underline">
                  watch live progress →
                </a>
              }
            />
          )}
          {call.status === "failed" && (
            <div className="mb-4 mt-3 flex items-center gap-3">
              <button
                onClick={async () => {
                  setReprocessing(true);
                  await fetch("/api/calls/reprocess", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ id: call.id }),
                  }).catch(() => {});
                  qc.invalidateQueries({ queryKey: ["calls"] });
                }}
                disabled={reprocessing}
                className={`rounded-full border px-4 py-1.5 font-sans text-[12px] ${
                  reprocessing
                    ? "cursor-default border-[var(--line)] text-[var(--dim)]"
                    : "cursor-pointer border-[rgba(255,201,92,.5)] text-[var(--amber)] hover:bg-[rgba(255,201,92,.08)]"
                }`}
              >
                {reprocessing ? "⟳ reprocessing… (watch the badge above)" : "⟳ Rerun processing"}
              </button>
              <span className="text-xs text-[var(--dim)]">
                Processing failed or stalled — the audio was kept, so nothing is lost.
              </span>
            </div>
          )}

          {draft !== null ? (
            <div className="mt-5">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                spellCheck={false}
                className="h-[60vh] w-full resize-y rounded-xl border border-[var(--cyan-3)] bg-[var(--field)] p-4 font-mono text-[12.5px] leading-relaxed text-[var(--text)] outline-none focus:border-[var(--cyan)]"
              />
              <div className="mt-1 text-[10px] text-[var(--dim)]">
                Markdown — headings, bullets, and <code>- [ ]</code> action items render back into the note.
                Saving updates the reports file and your vault copy together.
              </div>
            </div>
          ) : call.notes ? (
            <div className="mt-6">
              <NotesView
                notes={call.notes}
                onToggle={(index) => toggle.mutate({ id: call.id, index })}
                onComment={setCommentFor}
                onEditLine={(lineIndex, newLine) => {
                  const lines = notesRef.current.split("\n");
                  lines[lineIndex] = newLine;
                  notesRef.current = lines.join("\n");
                  save.mutate(
                    { id: call.id, notes: notesRef.current },
                    { onSuccess: () => flash("ok"), onError: () => flash("err") },
                  );
                }}
              />
              <div className="mt-4 text-[10px] text-[var(--dim)]">
                Click any line to fix it — changes save to the notes file and your vault.
              </div>
            </div>
          ) : null}

          {call.transcript.trim() && (
            <details className="mt-7">
              <summary className="cursor-pointer text-[10px] uppercase tracking-[1.5px] text-[var(--dim)]">
                full transcript
              </summary>
              <pre className="mt-2 max-h-[340px] overflow-auto whitespace-pre-wrap rounded-lg border border-[var(--line)] bg-[var(--field)] p-4 text-xs text-[var(--dim)]">
                {call.transcript}
              </pre>
            </details>
          )}
        </div>
      </div>

      {call.status !== "recording" && <Rail call={call} />}

      <PromptDialog
        open={commentFor !== null}
        title="Add comment"
        placeholder="Context, resolution, reference…"
        submitLabel="ADD"
        onSubmit={(text) => {
          if (commentFor !== null)
            fetch("/api/actions/comment", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ callId: call.id, index: commentFor, text }),
            }).then(() => flash("ok")).catch(() => flash("err"));
        }}
        onClose={() => setCommentFor(null)}
      />

      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-full border px-4 py-2 font-sans text-xs shadow-lg backdrop-blur ${
            toast === "ok"
              ? "border-[rgba(62,224,138,.45)] bg-[rgba(62,224,138,.12)] text-[var(--green)]"
              : "border-[rgba(255,107,132,.45)] bg-[rgba(255,107,132,.12)] text-[var(--red)]"
          }`}
        >
          {toast === "ok" ? "✓ Auto-saved" : "✕ Save failed — edit again to retry"}
        </div>
      )}
    </div>
  );
}
