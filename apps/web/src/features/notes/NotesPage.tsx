// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// Notes — freeform markdown in the brain vault (Notes/), bound to calls via
// frontmatter and to the Actions inbox via "- [ ]" lines. Same interaction
// language as calls: sidebar/detail, click-any-line editing, raw EDIT, COPY,
// auto-save toast. Jarvis's note-workers write to the same folder, so
// "Jarvis, update my note about X" lands here live.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as S from "@jarvis/shared";
import { NotesView } from "../calls/NotesView";
import { copyNotes } from "../calls/copyNotes";
import { PromptDialog } from "../../components/PromptDialog";
import { TagChips } from "../../components/TagChips";

function useNotes() {
  return useQuery({
    queryKey: ["notes"],
    queryFn: async () => S.NoteMeta.array().parse(await (await fetch("/api/notes")).json()),
  });
}
function useNote(id: string | null) {
  return useQuery({
    queryKey: ["note", id],
    enabled: !!id,
    queryFn: async () => {
      const r = await fetch(`/api/notes/${id}`);
      if (!r.ok) throw new Error("not found");
      return (await r.json()) as { md: string };
    },
  });
}

function ago(ms: number): string {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function NotesPage() {
  const { data: notes = [] } = useNotes();
  const [filter, setFilter] = useState("");
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const selected = notes.find((n) => n.id === id)?.id ?? notes[0]?.id ?? null;
  const { data: doc } = useNote(selected);
  const meta = notes.find((n) => n.id === selected);
  // Display-only filter. `selected` above is deliberately computed from the
  // FULL list: narrowing the sidebar must not close the note you are reading.
  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return notes;
    return notes.filter((n) =>
      n.title.toLowerCase().includes(q) ||
      n.preview.toLowerCase().includes(q) ||
      n.id.toLowerCase().includes(q));
  }, [notes, filter]);

  const [draft, setDraft] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);
  const [toast, setToast] = useState<null | "ok" | "err">(null);
  const [copied, setCopied] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mdRef = useRef("");

  useEffect(() => {
    if (selected && selected !== id) navigate(`/notes/${selected}`, { replace: true });
  }, [selected, id]);
  useEffect(() => {
    if (doc && !save.isPending) mdRef.current = doc.md;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.md, selected]);

  const flash = (k: "ok" | "err") => {
    setToast(k);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  };

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["notes"] });
    qc.invalidateQueries({ queryKey: ["note", selected] });
    qc.invalidateQueries({ queryKey: ["actions"] });
  };

  const save = useMutation({
    mutationFn: async ({ nid, md }: { nid: string; md: string }) => {
      const r = await fetch(`/api/notes/${nid}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ md }),
      });
      if (!r.ok) throw new Error("save failed");
    },
    onSuccess: () => { invalidate(); flash("ok"); },
    onError: () => flash("err"),
  });

  const create = useMutation({
    mutationFn: async (title: string) => {
      const r = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      if (!r.ok) throw new Error("create failed");
      return (await r.json()) as { id: string };
    },
    onSuccess: ({ id: nid }) => { invalidate(); navigate(`/notes/${nid}`); },
  });

  const del = useMutation({
    mutationFn: async (nid: string) => {
      await fetch(`/api/notes/${nid}/delete`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    },
    onSuccess: () => { invalidate(); navigate("/notes", { replace: true }); },
  });

  const [showNew, setShowNew] = useState(false);
  const [commentFor, setCommentFor] = useState<number | null>(null);
  const newNote = () => setShowNew(true);

  const editLine = (lineIndex: number, newLine: string) => {
    if (!selected) return;
    const lines = mdRef.current.split("\n");
    lines[lineIndex] = newLine;
    mdRef.current = lines.join("\n");
    save.mutate({ nid: selected, md: mdRef.current });
  };

  const toggleItem = (index: number) => {
    if (!selected) return;
    fetch("/api/actions/toggle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callId: `note:${selected}`, index }),
    }).then(invalidate).catch(() => flash("err"));
  };

  return (
    <div className="flex h-full">
      <aside className="flex w-[300px] min-w-[300px] flex-col gap-2 overflow-auto border-r border-[var(--line)] bg-[var(--surf)] p-3">
        <h2 className="px-1 pt-1 text-[18px] font-medium text-[var(--text)] [font-family:var(--display)]">Notes</h2>
        <button
          onClick={newNote}
          className="w-full rounded-lg border border-[var(--cyan-3)] bg-[var(--cyan-2)] py-2 text-[10px] tracking-[1.5px] text-[var(--cyan)] hover:bg-[var(--cyan-3)]"
        >
          ＋ NEW NOTE
        </button>
        {notes.length > 0 && (
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search notes…"
            aria-label="Search notes"
            className="w-full rounded-xl border border-[var(--line)] bg-[var(--field)] px-3 py-2 font-sans text-[12px] text-[var(--text)] outline-none placeholder:text-[var(--dim)] focus:border-[var(--cyan)]"
          />
        )}
        {notes.length === 0 && (
          <div className="mt-8 text-center text-[11px] text-[var(--dim)]">
            No notes yet.<br /><br />
            Create one here, or tell Jarvis:<br />"make a note about…"
          </div>
        )}
        {notes.length > 0 && visible.length === 0 && (
          <div className="mt-8 text-center text-[11px] text-[var(--dim)]">
            No notes match “{filter.trim()}”.
          </div>
        )}
        {visible.map((n) => (
          <button
            key={n.id}
            onClick={() => navigate(`/notes/${n.id}`)}
            className={`w-full rounded-xl border px-3 py-2 text-left transition ${
              n.id === selected
                ? "border-[var(--cyan-3)] bg-[var(--cyan-2)]"
                : "border-transparent hover:bg-[var(--surf-2)]"
            }`}
          >
            <div className="truncate font-sans text-xs font-medium text-[var(--text)]">{n.title}</div>
            <div className="mt-[3px] flex items-center gap-2 text-[10px] text-[var(--dim)]">
              {ago(n.updated)}
              {n.call && <span className="text-[var(--cyan)]">· from call</span>}
              {n.openItems > 0 && <span className="text-[var(--amber)]">· {n.openItems} open</span>}
            </div>
          </button>
        ))}
      </aside>

      <section className="min-w-0 flex-1 overflow-auto px-10 py-8 font-sans">
        {!meta ? (
          <div className="mt-20 text-center text-xs text-[var(--dim)]">Select or create a note</div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-4">
              <h1 className="text-[26px] leading-tight text-[var(--bright)] [font-family:var(--display)]">{meta.title}</h1>
              <span className="flex shrink-0 gap-2">
                {draft !== null ? (
                  <>
                    <button
                      onClick={() =>
                        draft.trim() &&
                        save.mutate({ nid: meta.id, md: draft }, { onSuccess: () => { mdRef.current = draft; setDraft(null); flash("ok"); invalidate(); } })
                      }
                      className="rounded-lg border border-[rgba(62,224,138,.5)] bg-[rgba(62,224,138,.08)] px-3 py-1 text-[10px] tracking-wider text-[var(--green)]"
                    >
                      SAVE
                    </button>
                    <button onClick={() => setDraft(null)} className="rounded-lg border border-[var(--line)] px-3 py-1 text-[10px] tracking-wider text-[var(--dim)]">
                      CANCEL
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={async () => { if (await copyNotes(mdRef.current)) { setCopied(true); setTimeout(() => setCopied(false), 2000); } }}
                      className="rounded-lg border border-[var(--line)] px-3 py-1 text-[10px] tracking-wider text-[var(--dim)] hover:border-[var(--cyan)] hover:text-[var(--cyan)]"
                    >
                      {copied ? "✓ COPIED" : "COPY"}
                    </button>
                    <button onClick={() => setDraft(mdRef.current)} className="rounded-lg border border-[var(--line)] px-3 py-1 text-[10px] tracking-wider text-[var(--dim)] hover:border-[var(--cyan)] hover:text-[var(--cyan)]">
                      EDIT
                    </button>
                    <button
                      onClick={() => {
                        if (!armed) { setArmed(true); setTimeout(() => setArmed(false), 2500); return; }
                        del.mutate(meta.id);
                      }}
                      className="rounded-lg border border-[var(--line)] px-3 py-1 text-[10px] tracking-wider text-[var(--dim)] hover:border-[var(--red)] hover:text-[var(--red)]"
                    >
                      {armed ? "SURE?" : "DELETE"}
                    </button>
                  </>
                )}
              </span>
            </div>

            <div className="mb-5 mt-3 flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-[var(--line)] bg-[var(--surf-2)] px-[10px] py-[3px] text-[10px] text-[var(--dim)]">
                updated {ago(meta.updated)}
              </span>
              <TagChips md={mdRef.current} onChange={(next) =>
                save.mutate({ nid: meta.id, md: next }, { onSuccess: () => { mdRef.current = next; invalidate(); } })} />
              {meta.call && (
                <Link
                  to={`/calls/${meta.call}`}
                  className="rounded-full border border-[var(--cyan-3)] bg-[var(--cyan-2)] px-[10px] py-[3px] text-[10px] text-[var(--cyan)] hover:bg-[var(--cyan-3)]"
                >
                  from call {meta.call} →
                </Link>
              )}
            </div>

            {draft !== null ? (
              <div className="max-w-[720px]">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  spellCheck={false}
                  className="h-[60vh] w-full resize-y rounded-xl border border-[var(--cyan-3)] bg-[var(--field)] p-4 font-mono text-[12.5px] leading-relaxed text-[var(--text)] outline-none focus:border-[var(--cyan)]"
                />
              </div>
            ) : doc ? (
              <>
                <NotesView
                  noteId={selected ?? undefined}
                  cards={false}
                  notes={doc.md.replace(/^---\n[\s\S]*?\n---\n?/, "")}
                  onToggle={toggleItem}
                  onComment={setCommentFor}
                  onEditLine={(i, line) => {
                    // rendered body is offset by the frontmatter lines
                    const fm = mdRef.current.match(/^---\n[\s\S]*?\n---\n?/);
                    const offset = fm ? fm[0].split("\n").length - 1 : 0;
                    editLine(i + offset, line);
                  }}
                />
                <div className="mt-4 max-w-[720px] text-[10px] text-[var(--dim)]">
                  Click any line to edit. <code>- [ ]</code> lines appear in your Actions inbox.
                  Jarvis can update this note too — it lives in your vault.
                </div>
              </>
            ) : null}

            {toast && (
              <div className={`fixed bottom-6 right-6 z-50 rounded-full border px-4 py-2 font-sans text-xs shadow-lg backdrop-blur ${
                toast === "ok"
                  ? "border-[rgba(62,224,138,.45)] bg-[rgba(62,224,138,.12)] text-[var(--green)]"
                  : "border-[rgba(255,107,132,.45)] bg-[rgba(255,107,132,.12)] text-[var(--red)]"
              }`}>
                {toast === "ok" ? "✓ Auto-saved" : "✕ Save failed"}
              </div>
            )}
          </>
        )}
      </section>
      <PromptDialog
        open={commentFor !== null}
        title="Add comment"
        placeholder="Context, resolution, reference…"
        submitLabel="ADD"
        onSubmit={(text) => {
          if (selected && commentFor !== null)
            fetch("/api/actions/comment", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ callId: `note:${selected}`, index: commentFor, text }),
            }).then(invalidate).catch(() => flash("err"));
        }}
        onClose={() => setCommentFor(null)}
      />
      <PromptDialog
        open={showNew}
        title="New note"
        placeholder="Note title…"
        onSubmit={(title) => create.mutate(title)}
        onClose={() => setShowNew(false)}
      />
    </div>
  );
}
