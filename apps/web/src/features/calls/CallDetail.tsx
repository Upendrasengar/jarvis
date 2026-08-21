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

function Chip({ tone, children }: { tone?: "rec" | "ok" | "warn"; children: React.ReactNode }) {
  const tones = {
    rec: "border-[rgba(255,92,122,.4)] text-[var(--red)] blip",
    ok: "border-[rgba(62,224,138,.3)] text-[var(--green)]",
    warn: "border-[rgba(255,207,92,.3)] text-[var(--amber)]",
    default: "border-[var(--line)] text-[var(--dim)]",
  };
  return (
    <span className={`rounded-full border bg-[var(--chipbg)] px-[10px] py-[3px] text-[10px] ${tones[tone ?? "default"]}`}>
      {children}
    </span>
  );
}

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
          className="rounded-full border border-[rgba(57,215,255,.4)] bg-[var(--chipbg)] px-[10px] py-[3px] text-[10px] text-[var(--cyan)] hover:bg-[rgba(57,215,255,.1)]"
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

export function CallDetail({ call, onDeleted }: { call: Call | null; onDeleted: () => void }) {
  const toggle = useToggleItem();
  const del = useDeleteCall();
  const save = useUpdateNotes();
  const { stop } = useRecordingControls();
  const [armed, setArmed] = useState(false);
  const [draft, setDraft] = useState<string | null>(null); // non-null = editing
  const [toast, setToast] = useState<null | "ok" | "err">(null);
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

  return (
    <div className="h-full overflow-auto px-10 py-8 font-sans">
      <div className="flex items-start justify-between gap-4">
        <h1 className="text-2xl leading-tight text-[var(--bright)]">{callTitle(call)}</h1>
        <span className="flex shrink-0 gap-2">
          {call.status === "recording" ? (
            <button
              onClick={() => stop.mutate()}
              disabled={stop.isPending}
              className="blip rounded-lg border border-[rgba(255,92,122,.5)] bg-[rgba(255,92,122,.08)] px-3 py-1 text-[10px] tracking-wider text-[var(--red)]"
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

      <div className="mb-5 mt-3 flex flex-wrap gap-2">
        <Chip>{call.started}</Chip>
        {call.url && <Chip>{callHost(call.url)}</Chip>}
        {call.status === "recording" && <Chip tone="rec">● recording now</Chip>}
        {call.status === "processing" && <Chip tone="warn">transcribing…</Chip>}
        {call.status === "done" && <Chip tone="ok">notes ready</Chip>}
        {call.status === "failed" && <Chip tone="warn">processing failed</Chip>}
        {call.status !== "recording" && <LinkedNotes callId={call.id} />}
      </div>

      {call.status === "recording" && (
        <p className="text-xs text-[var(--dim)]">
          Recording in progress — both sides are being captured. Stop &amp; Save ends it
          immediately; otherwise it stops ~30s after the call ends.
        </p>
      )}
      {call.status === "processing" && (
        <p className="text-xs text-[var(--dim)]">
          Transcribing locally and writing notes…{" "}
          <a href={`/logs?src=call:${call.id}`} className="text-[var(--cyan)] hover:underline">
            watch live progress →
          </a>
        </p>
      )}
      {call.status === "failed" && (
        <p className="mb-4 text-xs text-[var(--dim)]">
          Processing failed or stalled — the audio is kept, so it can be rerun:{" "}
          <code className="text-[var(--cyan)]">
            bash tools/process-call.sh reports/calls/{call.id}
          </code>
        </p>
      )}

      {draft !== null ? (
        <div className="max-w-[720px]">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
            className="h-[60vh] w-full resize-y rounded-xl border border-[rgba(57,215,255,.35)] bg-[var(--field)] p-4 font-mono text-[12.5px] leading-relaxed text-[var(--text)] outline-none focus:border-[var(--cyan)]"
          />
          <div className="mt-1 text-[10px] text-[var(--dim)]">
            Markdown — headings, bullets, and <code>- [ ]</code> action items render back into the note.
            Saving updates the reports file and your vault copy together.
          </div>
        </div>
      ) : call.notes ? (
        <>
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
          <div className="mt-4 max-w-[720px] text-[10px] text-[var(--dim)]">
            Click any line to fix it — changes save to the notes file and your vault.
          </div>
        </>
      ) : null}

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
              : "border-[rgba(255,92,122,.45)] bg-[rgba(255,92,122,.12)] text-[var(--red)]"
          }`}
        >
          {toast === "ok" ? "✓ Auto-saved" : "✕ Save failed — edit again to retry"}
        </div>
      )}

      {call.transcript.trim() && (
        <details className="mt-7 max-w-[720px]">
          <summary className="cursor-pointer text-[10px] uppercase tracking-[1.5px] text-[var(--dim)]">
            full transcript
          </summary>
          <pre className="mt-2 max-h-[340px] overflow-auto whitespace-pre-wrap rounded-lg border border-[var(--line)] bg-[var(--field)] p-4 text-xs text-[var(--dim)]">
            {call.transcript}
          </pre>
        </details>
      )}
    </div>
  );
}
