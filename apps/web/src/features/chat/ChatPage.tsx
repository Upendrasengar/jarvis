// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// The operator comms log — port of the legacy chat design: Jarvis speaks as
// the system (node + mono eyebrow, no bubble), you transmit in capsules.
// Voice: 🎙 fills the composer via speech recognition; 🔈 reads replies aloud.
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useChatStream } from "./useChatStream";
import { speak as speakAloud } from "../../lib/tts";
import { imagesFromClipboard, processImage, type ChatImage } from "../../lib/image";
import { ContextRail } from "./ContextRail";

// "SOURCES: /calls/x /notes/y" (from recall workers) renders as link chips
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

function SourceChips({ sources }: { sources: { to: string; kind: "call" | "note"; label: string }[] }) {
  if (!sources.length) return null;
  return (
    <span className="mt-2 flex flex-wrap gap-1.5">
      {sources.map((s, i) => (
        <Link
          key={i}
          to={s.to}
          className={`rounded-full border border-[var(--line)] bg-[var(--surf-2)] px-2 py-[2px] text-[10px] no-underline ${s.kind === "call" ? "text-[var(--cyan)] hover:border-[var(--cyan-3)]" : "text-[var(--indigo)] hover:border-[var(--indigo-3)]"}`}
        >
          {s.label}
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

function sessionFromRoute(param: string | undefined): string {
  if (param && /^[0-9a-f-]{8,}$/i.test(param)) return param;
  const saved = localStorage.getItem("jarvis_session");
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
  const [speak, setSpeak] = useState(() => localStorage.getItem("jarvis_voice") === "on");
  const [listening, setListening] = useState(false);
  const [pendingImgs, setPendingImgs] = useState<ChatImage[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (routeId !== sessionId) navigate(`/chat/${sessionId}`, { replace: true });
    localStorage.setItem("jarvis_session", sessionId);
    fetch(`/api/warmup?sessionId=${sessionId}`).catch(() => {});
  }, [sessionId]);

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
      void speakAloud(text);
    });
  }, [speak, onReply]);

  const submit = (text = input, viaVoice = false) => {
    const v = text.trim() || (pendingImgs.length ? "What do you see here?" : "");
    if (!v) return;
    if (viaVoice) voiceTurn.current = true;
    setInput("");
    const imgs = pendingImgs;
    setPendingImgs([]);
    void send(v, imgs);
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

  const mic = () => {
    const SR = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    rec.lang = "en-IN";
    rec.interimResults = true;
    setListening(true);
    rec.onresult = (e: any) => {
      const t = [...e.results].map((r: any) => r[0].transcript).join("");
      setInput(t);
      if (e.results[e.results.length - 1].isFinal) { rec.stop(); submit(t, true); }
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    rec.start();
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
                const { body, sources } = splitSources(m.t);
                return (<>{body}<SourceChips sources={sources} /></>);
              })()}
            </div>
          </Fragment>);
        })}
      </div>

      <div className="mt-2">
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
        <div className="flex items-center gap-[6px] rounded-2xl border border-[var(--line)] bg-[var(--surf)] p-[6px] transition [box-shadow:var(--shadow)] focus-within:border-[var(--cyan-3)]">
          <button
            onClick={mic}
            title="Click to speak"
            className={`h-[38px] w-[38px] shrink-0 rounded-full border text-[15px] ${
              listening
                ? "blip border-[var(--cyan)] bg-[var(--cyan)] text-[#012] shadow-[0_0_22px_var(--cyan)]"
                : "border-[var(--line)] text-[var(--cyan)] hover:border-[var(--cyan)]"
            }`}
          >
            🎙️
          </button>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            onPaste={onPaste}
            placeholder={pendingImgs.length ? "Ask about the image…" : "Message Jarvis…  (paste screenshots)"}
            autoFocus
            className="flex-1 bg-transparent px-2 py-[9px] font-sans text-[13.5px] text-[var(--text)] outline-none placeholder:text-[var(--dim)]"
          />
          <button
            onClick={() => {
              const next = !speak;
              setSpeak(next);
              localStorage.setItem("jarvis_voice", next ? "on" : "off");
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
