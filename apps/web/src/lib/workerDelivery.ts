// Worker-result delivery — closes the "it never told me" gap. When a worker
// finishes, the server pushes worker-result over the live channel; this hook
// (mounted once in Layout) runs a hidden chat turn so Jarvis DELIVERS the
// answer immediately: it lands in the transcript, and is spoken aloud when a
// voice session is active. If a turn is already streaming, we retry shortly;
// worst case the old fold-into-next-message behavior still applies.
import { useEffect } from "react";
import { appendTranscript, currentSessionId, streamChatTurn } from "./chatTransport";
import { speak } from "./tts";

const DELIVER_PROMPT =
  "Your worker just came back — the results are in the background block above. " +
  "Give me the answer now, short and spoken-friendly. Do not re-delegate.";

export function useWorkerDelivery() {
  useEffect(() => {
    let pending = false;
    let retries = 0;

    const shouldSpeak = () =>
      localStorage.getItem("jarvis_mic_on") === "1" ||
      localStorage.getItem("jarvis_voice") === "on";

    const deliver = async () => {
      if ((window as any)._jarvisTurnActive) {
        if (retries++ < 3) setTimeout(deliver, 4000);
        else { pending = false; retries = 0; }
        return;
      }
      pending = false;
      retries = 0;
      const sid = currentSessionId();
      try {
        const reply = await streamChatTurn(sid, DELIVER_PROMPT);
        if (!reply) return;
        appendTranscript(sid, [{ c: "jarvis", t: reply }]);
        window.dispatchEvent(new Event("jarvis:transcript"));
        if (shouldSpeak()) await speak(reply);
      } catch {}
    };

    const onResult = (e: Event) => {
      const { sessionId } = (e as CustomEvent).detail ?? {};
      if (sessionId !== currentSessionId()) return;   // not my conversation
      if (pending) return;                            // batch bursts into one delivery
      pending = true;
      setTimeout(deliver, 600);
    };

    window.addEventListener("jarvis:worker-result", onResult);
    return () => window.removeEventListener("jarvis:worker-result", onResult);
  }, []);
}
