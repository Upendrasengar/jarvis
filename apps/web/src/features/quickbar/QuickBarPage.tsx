// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// The floating ask-bar the menu-bar icon opens: one composer, over whatever
// you were doing, usually with a screenshot already attached.
//
// Deliberately NOT the chat page in a smaller window. This surface answers one
// question and gets out of the way — no transcript, no sidebar, no routing. It
// shares the session id with the dashboard (via server ui-state, since the two
// web views cannot share localStorage), so Jarvis keeps the conversation even
// though this view never renders its history.
//
// It is hosted by a WKWebView inside an NSPanel. Two things flow back to Swift
// over message handlers: how tall the content wants to be, and "close me".
import { useCallback, useEffect, useRef, useState } from "react";
import { currentSessionId } from "../../lib/chatTransport";
import { processImage, type ChatImage } from "../../lib/image";
import { cachedUiState, fetchUiState } from "../../lib/uiState";
import { JarvisMark } from "../../components/JarvisMark";

type Host = {
  resize?: { postMessage: (h: number) => void };
  close?: { postMessage: (s: string) => void };
  submit?: { postMessage: (b: { text: string; images: ChatImage[] }) => void };
  count?: { postMessage: (n: number) => void };
  capture?: { postMessage: (s: string) => void };
};
const MAX_IMAGES = 4;   // chat.ts caps the request at 4

const host = (): Host => (window as unknown as { webkit?: { messageHandlers?: Host } }).webkit?.messageHandlers ?? {};

export function QuickBarPage() {
  const [session, setSession] = useState<string>(() => cachedUiState().session ?? currentSessionId());
  const [text, setText] = useState("");
  const [imgs, setImgs] = useState<ChatImage[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // The dashboard writes the live session id to the server on every turn, so
  // this reads the same conversation rather than starting a private one.
  useEffect(() => { fetchUiState().then((s) => { if (s.session) setSession(s.session); }).catch(() => {}); }, []);

  // Swift sizes the panel from the content, so it has to hear about every
  // change — an attached screenshot, a reply growing as it streams.
  useEffect(() => {
    const h = rootRef.current?.scrollHeight ?? 64;
    host().resize?.postMessage(Math.ceil(h));
  }, [imgs, text]);

  // The capture overlay draws a running count, and only this side knows it —
  // a grab adds one, the thumbnail ✕ takes one away. Report after either, or
  // the label keeps counting drags instead of images.
  useEffect(() => { host().count?.postMessage(imgs.length); }, [imgs]);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // The panel is borderless and the web view draws no background, so the page
  // must not paint one either — otherwise the rounded card sits on an opaque
  // rectangle and the whole floating effect is lost. Scoped to this route:
  // the dashboard in the other web view keeps its own background.
  useEffect(() => {
    const prev = document.body.style.background;
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    return () => { document.body.style.background = prev; };
  }, []);

  // The capture hand-off. Swift drops a PNG data URL in here the moment the
  // drag finishes; it is scaled on this side by the same code the paste path
  // uses, so the model sees one image format however it arrived.
  // Re-opening the panel reuses the same live page, so Swift asks it to reset
  // rather than reloading — a reload would cost the session fetch and flash.
  useEffect(() => {
    (window as unknown as { __jarvisFocus: () => void }).__jarvisFocus = () => {
      setText("");
      setImgs([]);
      inputRef.current?.focus();
    };
  }, []);

  useEffect(() => {
    (window as unknown as { __jarvisAttach: (d: string) => void }).__jarvisAttach = (dataUrl: string) => {
      fetch(dataUrl)
        .then((r) => r.blob())
        .then(processImage)
        // Capture mode stays open for several grabs; the request caps at 4.
        .then((im) => setImgs((p) => (p.length >= MAX_IMAGES ? p : [...p, im])))
        .catch(() => {});
    };
  }, []);

  // The bar does not answer — it hands the turn to the dashboard chat, where
  // the conversation actually lives. Swift raises that window and injects it.
  const send = useCallback(() => {
    const q = text.trim() || (imgs.length ? "What do you see here?" : "");
    if (!q) return;
    // Both renditions travel: `full` is what the model sees, `thumb` is what
    // the transcript stores. Sending only `full` would put 1400px JPEGs into
    // localStorage, which is the exact thing the thumb exists to avoid.
    host().submit?.postMessage({ text: q, images: imgs });
    setText("");
    setImgs([]);
  }, [text, imgs]);

  // Esc leaves capture mode so you can scroll the page you are framing — the
  // overlay swallows the mouse, so there is no other way to reach it. Nothing
  // is discarded when it does, so this is the way back in.
  const armCapture = useCallback(() => {
    if (imgs.length >= MAX_IMAGES) return;
    host().capture?.postMessage("arm");
  }, [imgs.length]);

  return (
    <div ref={rootRef} className="px-4 pb-4 pt-2">
      {/* Rounded far enough to read as a pill at rest, and still right once a
          row of captures makes it taller.

          The shadow is the theme's own --shadow, not a hand-rolled one. A flat
          `0 10px 40px rgba(0,0,0,.28)` put a grey halo around the pill: pure
          black at a single blur reads as a smudge, and it did not follow the
          theme. --shadow is tinted (rgba(15,40,70,…) in light, near-black in
          dark), carries a 1px inset highlight along the top edge, and uses a
          negative spread so it stays tight under the card instead of bleeding
          out around it. */}
      <div className="rounded-[28px] border border-[var(--line)] bg-[var(--surf)] px-3 py-2 [box-shadow:var(--shadow)]">
        {imgs.length > 0 && (
          <div className="mb-1 flex flex-wrap items-center gap-2 px-2 pt-1">
            {imgs.map((im, i) => (
              <span key={i} className="relative">
                <img src={im.thumb} alt={`capture ${i + 1}`} className="h-12 rounded-lg border border-[var(--line)]" />
                <button
                  onClick={() => setImgs((p) => p.filter((_, k) => k !== i))}
                  title="Remove"
                  className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--red)] text-[9px] text-white"
                >
                  ×
                </button>
              </span>
            ))}
            <span className="text-[10px] uppercase tracking-[1.6px] text-[var(--dim)]">
              {imgs.length >= MAX_IMAGES ? "max reached" : "drag again for another"}
            </span>
          </div>
        )}
        <div className="flex items-center gap-3">
          <span className="ml-2 shrink-0"><JarvisMark size={24} /></span>
          <textarea
            ref={inputRef}
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              // Esc dismisses the bar, and only Swift can close a window.
              if (e.key === "Escape") { host().close?.postMessage("esc"); return; }
              if (e.metaKey && e.shiftKey && e.key.toLowerCase() === "s") { e.preventDefault(); armCapture(); return; }
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
            }}
            placeholder={imgs.length ? "Ask about this…" : "What can I help you with today?"}
            className="flex-1 resize-none bg-transparent py-[10px] font-sans text-[16px] leading-[1.35] text-[var(--text)] outline-none placeholder:text-[var(--dim)]"
          />
          <button
            onClick={armCapture}
            disabled={imgs.length >= MAX_IMAGES}
            title={imgs.length >= MAX_IMAGES ? "Maximum of 4 captures" : "Take a screenshot  (⌘⇧S)"}
            className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-xl text-[var(--dim)] transition hover:bg-[var(--surf-2)] hover:text-[var(--cyan)] disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-[var(--dim)]"
          >
            {/* viewfinder — four corners, the shape the overlay draws */}
            <svg viewBox="0 0 24 24" className="h-[19px] w-[19px]" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 8V6a2 2 0 0 1 2-2h2" />
              <path d="M16 4h2a2 2 0 0 1 2 2v2" />
              <path d="M20 16v2a2 2 0 0 1-2 2h-2" />
              <path d="M8 20H6a2 2 0 0 1-2-2v-2" />
            </svg>
          </button>
          <button
            onClick={send}
            title="Send"
            className="h-[38px] w-[38px] shrink-0 rounded-xl bg-[var(--cyan)] text-[15px] font-extrabold text-[var(--cyan-ink)] transition hover:shadow-[0_0_16px_var(--cyan-3)]"
          >
            ↑
          </button>
        </div>
      </div>
    </div>
  );
}
