import { createRecognition } from "../voice/speechRecognition";
// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// The operator comms log — port of the legacy chat design: Jarvis speaks as
// the system (node + mono eyebrow, no bubble), you transmit in capsules.
// Voice: 🎙 fills the composer via speech recognition; 🔈 reads replies aloud.
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { cachedUiState, fetchUiState, saveUiState } from "../../lib/uiState";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useChatStream } from "./useChatStream";
import { speak as speakAloud } from "../../lib/tts";
import { Markdown } from "../../components/Markdown";
import { MentionMenu } from "./MentionMenu";
import { ActivityRows } from "./ActivityRows";
import { useMentions, type Mention } from "./useMentions";
import { Call, NoteMeta, type ChatRef } from "@jarvis/shared";
import { useQuery } from "@tanstack/react-query";
import { callTitle } from "../calls/hooks";
import { imagesFromClipboard, processImage, type ChatImage } from "../../lib/image";
import { ContextRail } from "./ContextRail";
import { MicrophonePicker } from "../voice/MicrophonePicker";
import { microphoneError, openMicrophone, savedMicrophone, startRecognition } from "../voice/microphone";
import { setVoicePresence } from "../../lib/live";

// "SOURCES: /calls/x /notes/y" (from recall workers) renders as link chips
// replies carry a screen part (markdown) and a final "SPOKEN: ..." line for
// the voice — the bubble hides the spoken line, the TTS reads only it
function splitSpoken(t: string): { display: string; spoken: string } {
  const m = t.match(/^SPOKEN:\s*(.+)$/im);
  if (!m) return { display: t, spoken: t };
  return {
    display: t.replace(/^SPOKEN:.*$/im, "").replace(/\n{3,}/g, "\n\n").trim(),
    spoken: m[1].trim(),
  };
}

// FOLLOWUPS: a | b | c — pulled out before display so it never renders as
// prose, and never reaches the voice channel.
function splitFollowups(t: string): { body: string; followups: string[] } {
  const m = t.match(/^FOLLOWUPS:\s*(.+)$/im);
  if (!m) return { body: t, followups: [] };
  const followups = m[1]
    .split("|")
    .map((x) => x.trim().replace(/^[-*\d.\s]+/, ""))
    .filter((x) => x.length > 2 && x.length < 120)
    .slice(0, 3);
  return { body: t.replace(m[0], "").trimEnd(), followups };
}

function splitSources(t: string): { body: string; sources: { to: string; kind: "call" | "note"; label: string }[] } {
  const m = t.match(/^SOURCES:\s*(.+)$/im);
  if (!m) return { body: t, sources: [] };
  const seen = new Set<string>();
  const sources = (m[1].match(/\/(?:calls|notes)\/\S+/g) ?? []).flatMap((raw) => {
    const to = raw.replace(/[.,;]+$/, "");
    const id = decodeURIComponent(to.split("/").pop() ?? "");
    const kind = (to.startsWith("/calls/") ? "call" : "note") as "call" | "note";
    if (kind === "call" && !/^\d{4}-\d{2}-\d{2}-\d{4}$/.test(id)) return [];   // malformed
    if (id.length < 2 || seen.has(to)) return [];
    seen.add(to);
    return [{ to, kind, label: (kind === "call" ? "☎ " : "◇ ") + id }];
  });
  return { body: t.replace(m[0], "").trimEnd(), sources };
}

// A source chip used to read "☎ 2026-08-24-1211", which is an id, not an
// answer to "where did this come from". The title is already in the caches
// the page holds, so resolve it and fall back to the id only when the file is
// genuinely unknown.
function SourceChips({ sources }: { sources: { to: string; kind: "call" | "note"; label: string }[] }) {
  const { data: calls = [] } = useQuery({
    queryKey: ["calls"],
    queryFn: async () => Call.array().parse(await (await fetch("/api/calls")).json()),
    staleTime: 30_000,
    enabled: sources.some((s) => s.kind === "call"),
  });
  const { data: notes = [] } = useQuery({
    queryKey: ["notes"],
    queryFn: async () => NoteMeta.array().parse(await (await fetch("/api/notes")).json()),
    staleTime: 30_000,
    enabled: sources.some((s) => s.kind === "note"),
  });
  const titleFor = (s: { to: string; kind: "call" | "note" }) => {
    const id = decodeURIComponent(s.to.split("/").pop() ?? "");
    if (s.kind === "call") {
      const c = calls.find((x) => x.id === id);
      return c ? callTitle(c) : id;
    }
    return notes.find((n) => n.id === id)?.title ?? id;
  };
  if (!sources.length) return null;
  return (
    <span className="mt-2 flex flex-wrap gap-1.5">
      {sources.map((s, i) => (
        <Link
          key={i}
          to={s.to}
          className={`rounded-full border border-[var(--line)] bg-[var(--surf-2)] px-2 py-[2px] text-[10px] no-underline ${s.kind === "call" ? "text-[var(--cyan)] hover:border-[var(--cyan-3)]" : "text-[var(--indigo)] hover:border-[var(--indigo-3)]"}`}
        >
          <span className="opacity-60">{s.kind === "call" ? "☎" : "◇"}</span>{" "}
          {titleFor(s)}
        </Link>
      ))}
    </span>
  );
}

const fmtTime = (ts?: number) =>
  ts ? new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
const dayKey = (ts?: number) => (ts ? new Date(ts).toDateString() : "");
const fmtDay = (ts: number) => {
  const d = new Date(ts); const today = new Date();
  const yd = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return "TODAY";
  if (d.toDateString() === yd.toDateString()) return "YESTERDAY";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase();
};

const QUICK = [
  "give me today's digest",
  "what were my calls about today",
  "what do I know about adobe target",
  "what are my active projects",
];

function newId() {
  return crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
}

// `hadLocal` records whether THIS origin already knew a conversation, which
// decides whether the server's is allowed to replace it below. Read once, at
// module load, before anything writes a new id.
const hadLocalSession =
  !!localStorage.getItem("jarvis_session") || !!cachedUiState().session;

function sessionFromRoute(param: string | undefined): string {
  if (param && /^[0-9a-f-]{8,}$/i.test(param)) return param;
  const saved = localStorage.getItem("jarvis_session") ?? cachedUiState().session;
  if (saved) return saved;
  const id = newId();
  localStorage.setItem("jarvis_session", id);
  return id;
}

export function ChatPage() {
  const { id: routeId } = useParams();
  const navigate = useNavigate();
  const sessionId = useMemo(() => sessionFromRoute(routeId), [routeId]);
  const { messages, send, streaming, clear, onReply } = useChatStream(sessionId);
  const [input, setInput] = useState("");
  const [speak, setSpeak] = useState(
    () => (cachedUiState().voice ?? localStorage.getItem("jarvis_voice")) === "on",
  );
  const [listening, setListening] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [micError, setMicError] = useState("");
  const micRef = useRef<{ rec: any; stream: MediaStream } | null>(null);
  const micAttempt = useRef(0);
  const [pendingImgs, setPendingImgs] = useState<ChatImage[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  // @-mentions. `refs` is the authoritative list; the text token only mirrors
  // it so the sentence reads naturally. Menu state is real component state —
  // a module-level flag here would strand the menu open across renders.
  const inputRef = useRef<HTMLInputElement>(null);
  const [refs, setRefs] = useState<ChatRef[]>([]);
  const [mentionAt, setMentionAt] = useState<number | null>(null); // caret index of the "@"
  const [mentionQ, setMentionQ] = useState("");
  const [mentionKind, setMentionKind] = useState<"doc" | "set">("doc");
  const [mentionI, setMentionI] = useState(0);
  // Backspace into the pills highlights the last one first, then deletes it —
  // one keystroke should never silently drop a reference you cannot see go.
  const [armedRef, setArmedRef] = useState(false);
  const { search, searchSets } = useMentions();
  const hits = mentionAt === null ? [] : (mentionKind === "set" ? searchSets(mentionQ) : search(mentionQ));
  const menuOpen = mentionAt !== null && hits.length > 0;

  const closeMenu = () => { setMentionAt(null); setMentionQ(""); setMentionI(0); };

  // Reads the text left of the caret for a trailing "@query". Bounded to 40
  // chars and stopped by a second @ so a stray character cannot open a menu
  // halfway down a paragraph.
  const syncMention = (value: string, caret: number) => {
    // "@" picks a document (note, call); "#" picks a set (topic, tag)
    const m = value.slice(0, caret).match(/(?:^|\s)([@#])([^@#\n]{0,40})$/);
    if (!m) return closeMenu();
    setMentionKind(m[1] === "#" ? "set" : "doc");
    setMentionAt(caret - m[2].length - 1);
    setMentionQ(m[2]);
    setMentionI(0);
  };

  // A picked reference becomes a PILL, never text. Pasting a 60-character note
  // title into the field buried the message and made backspace chew through it
  // one character at a time; the pill deletes as one thing.
  const pickMention = (m: Mention) => {
    if (mentionAt === null) return;
    const caret = inputRef.current?.selectionStart ?? input.length;
    const next = input.slice(0, mentionAt) + input.slice(caret);   // drop the "@query"
    setInput(next);
    setRefs((r) => (r.some((x) => x.kind === m.kind && x.id === m.id)
      ? r
      : [...r, { kind: m.kind, id: m.id, title: m.title }]));
    setArmedRef(false);
    closeMenu();
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(mentionAt, mentionAt);
    });
  };

  const removeRef = (r: ChatRef) => {
    setRefs((x) => x.filter((y) => !(y.kind === r.kind && y.id === r.id)));
    setArmedRef(false);
  };

  useEffect(() => {
    if (routeId !== sessionId) navigate(`/chat/${sessionId}`, { replace: true });
    localStorage.setItem("jarvis_session", sessionId);
    saveUiState({ session: sessionId });
    fetch(`/api/warmup?sessionId=${sessionId}`).catch(() => {});
  }, [sessionId]);

  // Adopt the conversation the owner was actually in, when this origin has
  // never seen one. That is the native window (127.0.0.1) opening for the
  // first time while the browser (localhost) holds the real session — two
  // origins, two localStorages, one person who does not care about the
  // difference.
  //
  // Narrow on purpose: only when there was no local session AND no explicit
  // /chat/:id in the URL. Pressing "new chat" must not be undone by the
  // server still remembering the previous one.
  useEffect(() => {
    if (hadLocalSession || routeId) return;
    let cancelled = false;
    void fetchUiState()
      .then((st) => {
        if (cancelled || !st.session || st.session === sessionId) return;
        navigate(`/chat/${st.session}`, { replace: true });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages]);

  // spoken replies via server TTS. Voice-originated turns are always spoken;
  // typed turns follow the 🔈 toggle. Broadcasts speaking state for the
  // header voice bar.
  const voiceTurn = useRef(false);
  useEffect(() => {
    onReply((text) => {
      if (!speak && !voiceTurn.current) return;
      voiceTurn.current = false;
      void speakAloud(splitSpoken(splitSources(splitFollowups(text).body).body).spoken);
    });
  }, [speak, onReply]);

  const submit = (text = input, viaVoice = false) => {
    const v = text.trim() || (pendingImgs.length ? "What do you see here?" : "");
    if (!v) return;
    if (viaVoice) voiceTurn.current = true;
    const sending = refs;
    setInput("");
    const imgs = pendingImgs;
    setPendingImgs([]);
    setRefs([]);
    setArmedRef(false);
    closeMenu();
    void send(v, imgs, sending);
  };

  const onPaste = async (e: React.ClipboardEvent) => {
    const files = imagesFromClipboard(e);
    if (!files.length) return;
    e.preventDefault();
    const processed = await Promise.all(files.map(processImage));
    setPendingImgs((p) => [...p, ...processed].slice(0, 4));
  };

  // messages handed off from other tabs (header voice bar, brain node clicks)
  useEffect(() => {
    const raw = sessionStorage.getItem("jarvis_pending");
    if (raw) {
      sessionStorage.removeItem("jarvis_pending");
      try {
        const { text, voice } = JSON.parse(raw);
        if (text) setTimeout(() => submit(text, !!voice), 300);
      } catch {}
    }
    const onSend = (e: Event) => {
      const { text, voice } = (e as CustomEvent).detail ?? {};
      if (text) submit(text, !!voice);
    };
    window.addEventListener("jarvis:send", onSend);
    return () => window.removeEventListener("jarvis:send", onSend);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const stopMic = () => {
    micAttempt.current++;
    const current = micRef.current;
    micRef.current = null;
    if (current) {
      try { current.rec.abort(); } catch {}
      current.stream.getTracks().forEach(track => track.stop());
      setVoicePresence(false);
    }
    setListening(false);
  };

  useEffect(() => {
    window.addEventListener("jarvis:microphone-starting", stopMic);
    return () => {
      window.removeEventListener("jarvis:microphone-starting", stopMic);
      stopMic();
    };
  }, [sessionId]);

  const startMic = async (deviceId: string) => {
    window.dispatchEvent(new Event("jarvis:microphone-starting"));
    const attempt = ++micAttempt.current;
    const stream = await openMicrophone(deviceId);
    if (attempt !== micAttempt.current) {
      stream.getTracks().forEach(track => track.stop());
      throw new Error("Microphone start cancelled. Please try again.");
    }
    try {
      const rec = createRecognition();
      micRef.current = { rec, stream };
      setVoicePresence(true);
      rec.lang = "en-IN";
      rec.interimResults = true;
      rec.onresult = (event: any) => {
        if (micRef.current?.rec !== rec) return;
        const text = [...event.results].map((result: any) => result[0].transcript).join("");
        setInput(text);
        if (event.results[event.results.length - 1].isFinal) { stopMic(); submit(text, true); }
      };
      rec.onend = () => { if (micRef.current?.rec === rec) stopMic(); };
      rec.onerror = (event: any) => {
        if (micRef.current?.rec !== rec) return;
        stopMic();
        if (event.error !== "no-speech" && event.error !== "aborted")
          setMicError(event.message || (event.error === "not-allowed" ? "Allow microphone access in your browser and try again." : `Speech recognition failed (${event.error}). Please try again.`));
      };
      stream.getAudioTracks()[0]?.addEventListener("ended", () => {
        if (micRef.current?.rec !== rec) return;
        stopMic();
        setMicError("Microphone disconnected. Choose another input.");
      });
      startRecognition(rec, stream, deviceId);
      setListening(true);
    } catch (error) {
      stream.getTracks().forEach(track => track.stop());
      stopMic();
      throw error;
    }
  };

  // Same as the header mic: use the device already chosen rather than opening
  // a dialog to re-ask. The picker is a repair path, not a step on the way to
  // talking, so it appears only when nothing is saved or the saved device
  // refuses to open.
  const mic = () => {
    if (listening) { stopMic(); return; }
    setMicError("");
    const saved = savedMicrophone();
    if (!saved) { setPickerOpen(true); return; }
    // Show why it failed rather than silently reopening the picker — a
    // permission denial repeats for every device, and an unexplained loop is
    // worse than the original modal.
    void startMic(saved).catch((err) => { setMicError(microphoneError(err)); setPickerOpen(true); });
    return;
  };

  const newChat = () => {
    const id = newId();
    localStorage.setItem("jarvis_session", id);
    clear();
    navigate(`/chat/${id}`);
  };

  const lastSources = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].c !== "jarvis" || !messages[i].t) continue;
      const src = splitSources(messages[i].t).sources;
      if (src.length) return src;    // most recent reply that cited anything
    }
    return [];
  }, [messages]);

  return (
    <div className="flex h-full">
    {pickerOpen && <MicrophonePicker onStart={startMic} onClose={() => setPickerOpen(false)} onCancel={() => { stopMic(); setPickerOpen(false); }} />}
    <div className="relative mx-auto flex h-full w-full max-w-[780px] flex-col px-6 py-4">
      {messages.length === 0 && (
        <div className="absolute inset-x-6 bottom-[120px] top-0 z-10 flex flex-col items-center justify-center gap-2 text-center">
          <span className="blip h-[11px] w-[11px] rounded-full bg-[var(--cyan)] shadow-[0_0_18px_var(--cyan),0_0_44px_var(--cyan-3)]" />
          <div className="mt-2 font-sans text-[17px] font-semibold text-[var(--text)]">Channel open</div>
          <div className="text-[9.5px] uppercase tracking-[1.8px] text-[var(--dim)]">
            Projects · calls · second brain — type, or just talk
          </div>
          <div className="mt-6 grid w-full max-w-[500px] grid-cols-2 gap-2">
            {QUICK.map((q) => (
              <button
                key={q}
                onClick={() => submit(q)}
                className="rounded-xl border border-[var(--line)] bg-[var(--surf)] px-3 py-3 text-left font-sans text-[11.5px] text-[var(--dim)] transition [box-shadow:var(--shadow)] hover:-translate-y-px hover:border-[var(--cyan-3)] hover:text-[var(--cyan)]"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      <div
        ref={logRef}
        className="flex flex-1 flex-col gap-[5px] overflow-auto py-2 pr-4 [mask-image:linear-gradient(180deg,transparent_0,#000_22px)]"
      >
        {messages.map((m, i) => {
          const groupFirst = m.c === "jarvis" && messages[i - 1]?.c !== "jarvis";
          const prevTs = messages.slice(0, i).reverse().find((x) => x.ts)?.ts;
          const newDay = m.ts && dayKey(m.ts) !== dayKey(prevTs);
          const divider = newDay && (
            <div key={`d${i}`} className="mt-5 mb-1 text-center text-[8.5px] tracking-[2px] text-[var(--dim)]">
              — {fmtDay(m.ts!)} —
            </div>
          );
          return m.c === "me" ? (<Fragment key={i}>
            {divider}
            <div
              key={i}
              className="mt-4 max-w-[76%] self-end whitespace-pre-wrap rounded-[18px_18px_6px_18px] border border-[var(--indigo-3)] bg-[var(--indigo-2)] px-[14px] py-[10px] font-sans text-[13.5px] leading-relaxed [box-shadow:var(--shadow)]"
            >
              {m.imgs?.length ? (
                <span className="mb-2 flex flex-wrap gap-2">
                  {m.imgs.map((src, k) => (
                    <img key={k} src={src} alt="pasted" className="max-h-36 rounded-lg border border-[var(--cyan-3)]" />
                  ))}
                </span>
              ) : null}
              {m.refs?.length ? (
                <span className="mb-2 flex flex-wrap gap-1.5">
                  {m.refs.map((r) => (
                    <span
                      key={`${r.kind}:${r.id}`}
                      title={`${r.kind} referenced with this message`}
                      className="flex items-center gap-1.5 rounded-lg border border-[var(--indigo-3)] bg-[var(--indigo-2)] px-2 py-[2px] text-[10.5px] text-[var(--indigo)]"
                    >
                      <span className="font-mono text-[8.5px] uppercase tracking-[1px] opacity-70">{r.kind}</span>
                      <span className="max-w-[220px] truncate">{r.title}</span>
                    </span>
                  ))}
                </span>
              ) : null}
              {m.t}
              {m.ts && (
                <span className="mt-[3px] block text-right text-[8.5px] text-[var(--dim)]">{fmtTime(m.ts)}</span>
              )}
            </div>
          </Fragment>) : (<Fragment key={i}>
            {divider}
            <div
              key={i}
              className={`relative max-w-[88%] self-start whitespace-pre-wrap pl-6 font-sans text-[13.5px] leading-relaxed ${groupFirst ? "pt-5" : "pt-[2px]"}`}
            >
              {groupFirst && (
                <>
                  <span className="absolute left-6 top-0 whitespace-nowrap text-[9px] font-semibold tracking-[2.5px] text-[var(--cyan-dim)] [font-family:'Roboto_Mono',ui-monospace,monospace]">
                    JARVIS{m.ts ? ` · ${fmtTime(m.ts)}` : ""}
                  </span>
                  <span className="absolute left-[7px] top-[2px] h-[7px] w-[7px] rounded-full bg-[var(--cyan)] shadow-[0_0_10px_var(--cyan)]" />
                </>
              )}
              {(() => {
                if (!m.t) return <span className="blip text-[var(--dim)]">…</span>;
                const { body: noFollow, followups } = splitFollowups(m.t);
                const { body, sources } = splitSources(noFollow);
                const { display } = splitSpoken(body);
                const last = i === messages.length - 1;
                return (
                  <>
                    <Markdown md={display} />
                    <SourceChips sources={sources} />
                    {/* only the newest reply offers them — older ones would be
                        a wall of stale buttons down the transcript */}
                    {last && !streaming && followups.length > 0 && (
                      <span className="mt-3 flex flex-wrap gap-1.5">
                        {followups.map((q, k) => (
                          <button
                            key={k}
                            onClick={() => submit(q)}
                            className="rounded-full border border-[var(--line)] bg-[var(--surf)] px-3 py-[5px] text-left font-sans text-[11.5px] text-[var(--dim)] transition hover:border-[var(--cyan-3)] hover:text-[var(--cyan)]"
                          >
                            {q}
                          </button>
                        ))}
                      </span>
                    )}
                  </>
                );
              })()}
            </div>
          </Fragment>);
        })}
        {/* worker activity sits at the foot of the transcript, under the turn
            that spawned it — that is where you are already looking while a
            reply is pending */}
        <ActivityRows sessionId={sessionId} />
      </div>

      <div className="relative mt-2">
        {menuOpen && <MentionMenu items={hits} index={mentionI} onPick={pickMention} />}
        {pendingImgs.length > 0 && (
          <div className="mb-2 flex gap-2">
            {pendingImgs.map((img, i) => (
              <span key={i} className="relative">
                <img src={img.thumb} alt="pending" className="h-14 rounded-lg border border-[var(--line)]" />
                <button
                  onClick={() => setPendingImgs((p) => p.filter((_, k) => k !== i))}
                  title="Remove image"
                  className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--red)] text-[9px] text-white"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="rounded-2xl border border-[var(--line)] bg-[var(--surf)] p-[6px] transition [box-shadow:var(--shadow)] focus-within:border-[var(--cyan-3)]">
          {refs.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-1 pb-[6px] pt-[2px]">
              {refs.map((r, i) => (
                <span
                  key={`${r.kind}:${r.id}`}
                  title={`${r.kind} · Jarvis opens this file — the message itself stays small`}
                  className={`flex items-center gap-1.5 rounded-lg border px-2 py-[3px] text-[11.5px] ${
                    i === refs.length - 1 && armedRef
                      ? "border-[var(--red)] bg-[var(--red)]/15 text-[var(--text)]"
                      : "border-[var(--indigo-3)] bg-[var(--indigo-2)] text-[var(--indigo)]"
                  }`}
                >
                  <span className="font-mono text-[9px] uppercase tracking-[1px] opacity-70">{r.kind}</span>
                  <span className="max-w-[260px] truncate">{r.title}</span>
                  <button
                    onClick={() => removeRef(r)}
                    title="Remove reference"
                    className="text-[var(--dim)] hover:text-[var(--red)]"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          {micError && <p role="alert" className="mb-2 text-xs text-[var(--red)]">{micError}</p>}
          <div className="flex items-center gap-[6px]">
          <button
            onClick={mic}
            title={listening ? "Stop listening" : "Choose microphone and speak"}
            aria-label={listening ? "Stop dictation" : "Choose dictation microphone"}
            className={`h-[38px] w-[38px] shrink-0 rounded-full border text-[15px] ${
              listening
                ? "blip border-[var(--cyan)] bg-[var(--cyan)] text-[#012] shadow-[0_0_22px_var(--cyan)]"
                : "border-[var(--line)] text-[var(--cyan)] hover:border-[var(--cyan)]"
            }`}
          >
            🎙️
          </button>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => { setInput(e.target.value); syncMention(e.target.value, e.target.selectionStart ?? 0); }}
            onClick={(e) => syncMention(input, e.currentTarget.selectionStart ?? 0)}
            onBlur={closeMenu}
            onKeyDown={(e) => {
              // the menu owns these keys while it is open, or Enter would
              // send the message instead of choosing the highlighted row
              if (menuOpen) {
                if (e.key === "ArrowDown") { e.preventDefault(); setMentionI((i) => (i + 1) % hits.length); return; }
                if (e.key === "ArrowUp") { e.preventDefault(); setMentionI((i) => (i - 1 + hits.length) % hits.length); return; }
                if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pickMention(hits[mentionI]); return; }
                if (e.key === "Escape") { e.preventDefault(); closeMenu(); return; }
              }
              if (e.key === "Backspace" && !input && refs.length) {
                e.preventDefault();
                if (armedRef) { setRefs((r) => r.slice(0, -1)); setArmedRef(false); }
                else setArmedRef(true);
                return;
              }
              if (armedRef && e.key !== "Backspace") setArmedRef(false);
              if (e.key === "Enter") submit();
            }}
            onPaste={onPaste}
            placeholder={pendingImgs.length ? "Ask about the image…" : "Message Jarvis…  (@ to reference a note or call)"}
            autoFocus
            className="flex-1 bg-transparent px-2 py-[9px] font-sans text-[13.5px] text-[var(--text)] outline-none placeholder:text-[var(--dim)]"
          />
          <button
            onClick={() => {
              const next = !speak;
              setSpeak(next);
              saveUiState({ voice: next ? "on" : "off" });
            }}
            title="Spoken replies"
            className={`h-[38px] w-[38px] shrink-0 rounded-full border text-[14px] ${
              speak ? "border-[var(--cyan)] text-[var(--cyan)]" : "border-[var(--line)] text-[var(--dim)]"
            }`}
          >
            {speak ? "🔊" : "🔈"}
          </button>
          <button
            onClick={newChat}
            title="New conversation"
            className="h-[38px] w-[38px] shrink-0 rounded-full border border-[var(--line)] text-[15px] text-[var(--dim)] hover:border-[var(--cyan)] hover:text-[var(--cyan)]"
          >
            ＋
          </button>
          <button
            onClick={() => submit()}
            disabled={streaming}
            title="Send"
            className="h-[38px] w-[38px] shrink-0 rounded-full bg-[var(--cyan)] text-[15px] font-extrabold text-[#02121a] transition hover:shadow-[0_0_16px_var(--cyan-3)] disabled:opacity-50"
          >
            ❯
          </button>
          </div>
        </div>
        <div className="mt-[7px] text-center text-[9px] uppercase tracking-[2px] text-[var(--dim)]">
          enter to send · 🎙 to speak
        </div>
      </div>
    </div>

    <aside className="hidden w-[260px] shrink-0 overflow-auto border-l border-[var(--line)] bg-[var(--surf)] px-4 py-6 xl:block">
      <ContextRail sources={lastSources} onAsk={(t) => submit(t)} />
    </aside>
    </div>
  );
}
