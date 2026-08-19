// Chat page state on top of the shared transport (lib/chatTransport).
import { useCallback, useEffect, useRef, useState } from "react";
import {
  loadTranscript, saveTranscript, streamChatTurn, type Msg,
} from "../../lib/chatTransport";
import type { ChatImage } from "../../lib/image";
import { makeTypewriter } from "../../lib/typewriter";

export type { Msg };

export function useChatStream(sessionId: string) {
  const [messages, setMessages] = useState<Msg[]>(() => loadTranscript(sessionId));
  const [streaming, setStreaming] = useState(false);
  const lastReply = useRef<(text: string) => void>(() => {});

  // switching conversations swaps the transcript
  useEffect(() => { setMessages(loadTranscript(sessionId)); }, [sessionId]);

  useEffect(() => { saveTranscript(sessionId, messages); }, [messages, sessionId]);

  // a background voice turn may append to this transcript from the header bar
  useEffect(() => {
    const refresh = () => setMessages(loadTranscript(sessionId));
    window.addEventListener("jarvis:transcript", refresh);
    return () => window.removeEventListener("jarvis:transcript", refresh);
  }, [sessionId]);

  const onReply = useCallback((fn: (text: string) => void) => { lastReply.current = fn; }, []);

  const send = useCallback(async (message: string, images: ChatImage[] = []) => {
    if (!message.trim() || streaming) return;
    setStreaming(true);
    setMessages((m) => [
      ...m,
      { c: "me", t: message, ...(images.length ? { imgs: images.map((i) => i.thumb) } : {}) },
      { c: "jarvis", t: "" },
    ]);
    const setLast = (t: string) =>
      setMessages((m) => {
        const copy = m.slice();
        copy[copy.length - 1] = { c: "jarvis", t };
        return copy;
      });
    const tw = makeTypewriter(setLast);
    try {
      const finalText = await streamChatTurn(sessionId, message, tw.feed, images.map((i) => i.full));
      await tw.finish(finalText || "(no reply)");
      if (finalText) lastReply.current(finalText);
    } catch (e) {
      tw.abort(`(connection lost — ${String(e).slice(0, 80)})`);
    } finally {
      setStreaming(false);
    }
  }, [sessionId, streaming]);

  const clear = useCallback(() => {
    try { localStorage.removeItem("jarvis_tx_" + sessionId); } catch {}
    setMessages([]);
  }, [sessionId]);

  return { messages, send, streaming, clear, onReply };
}
