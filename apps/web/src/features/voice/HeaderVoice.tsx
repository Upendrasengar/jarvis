// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// Header voice bar — talk to Jarvis from ANY tab without leaving it.
// Three modes (⚙ settings):
//   on-demand    click → one utterance → stops (classic)
//   wake-word    mic stays hot; only "Jarvis …" utterances are sent
//   conversation mic stays hot; EVERYTHING you say is sent
// The persistent modes auto-restart recognition when the browser times out
// on silence (Chrome stops after a few quiet seconds — we just start again),
// pause while Jarvis speaks so it can't hear itself, and heartbeat a flag so
// the call watcher knows the hot mic is Jarvis, not a Teams call.
import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import * as S from "@jarvis/shared";
import { appendTranscript, currentSessionId, streamChatTurn } from "../../lib/chatTransport";
import { speak } from "../../lib/tts";
import { setVoicePresence } from "../../lib/live";

type VState = "idle" | "listening" | "thinking" | "speaking";

const WAKE_RE = /^\s*(?:hey|ok|okay)?[,\s]*jarvis\b[,!.:]?\s*(.*)$/i;

export function useSettings() {
  return useQuery({
    queryKey: ["settings"],
    queryFn: async () => S.Settings.parse(await (await fetch("/api/settings")).json()),
    staleTime: 5_000,
  });
}

export function HeaderVoice() {
  const { data: settings } = useSettings();
  const mode = settings?.voiceMode ?? "on-demand";
  const [state, setState] = useState<VState>("idle");
  const [persistent, setPersistent] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recRef = useRef<any>(null);
  const activeRef = useRef(false);       // persistent loop wants to run
  const speakingRef = useRef(false);     // TTS playing — don't listen to ourselves
  const stateRef = useRef<VState>("idle");
  stateRef.current = state;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const location = useLocation();
  const locationRef = useRef(location.pathname);
  locationRef.current = location.pathname;

  // ---- waveform ----
  useEffect(() => {
    const canvas = canvasRef.current!;
    const x = canvas.getContext("2d")!;
    let raf = 0, t = 0;
    const loop = () => {
      t += 1;
      const w = canvas.width, h = canvas.height, mid = h / 2;
      x.clearRect(0, 0, w, h);
      const st = stateRef.current;
      let level = 0;
      if (st === "thinking") {
        x.fillStyle = "#ffcf5c";
        for (let i = 0; i < 24; i++) {
          const on = Math.floor(t / 6) % 24;
          x.globalAlpha = i === on ? 1 : 0.25;
          x.fillRect((i / 24) * w, mid - 1, 2, 2);
        }
        x.globalAlpha = 1;
      } else if (st === "listening" && analyserRef.current) {
        const data = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteFrequencyData(data);
        x.fillStyle = "#39d7ff";
        const bars = 24;
        for (let i = 0; i < bars; i++) {
          const v = data[Math.floor((i / bars) * data.length)] / 255;
          level = Math.max(level, v);
          const bh = Math.max(2, v * h * 0.9);
          x.fillRect((i / bars) * w, mid - bh / 2, w / bars - 2, bh);
        }
        // real mic energy = the user is (still) talking — this keeps working
        // even while the recognition engine is mid-restart and deaf
        if (level > 0.25) lastVoiceRef.current = performance.now();
      } else if (st === "speaking") {
        x.fillStyle = "#3ee08a";
        const bars = 24;
        level = 0.4 + 0.3 * Math.abs(Math.sin(t * 0.1));
        for (let i = 0; i < bars; i++) {
          const bh = 3 + Math.abs(Math.sin(t * 0.15 + i * 0.7)) * h * 0.6;
          x.fillRect((i / bars) * w, mid - bh / 2, w / bars - 2, bh);
        }
      } else {
        x.fillStyle = "rgba(95,137,173,.5)";
        for (let i = 0; i < 24; i++) x.fillRect((i / 24) * w, mid - 1, 2, 2);
      }
      (window as any)._jarvisVoiceLevel = level;   // neural core breathes with this
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ---- TTS state reflection + self-mute during playback ----
  useEffect(() => {
    const on = () => {
      speakingRef.current = true;
      try { recRef.current?.stop(); } catch {}
      if (stateRef.current !== "listening") setState("speaking");
      else setState("speaking");
    };
    const off = () => {
      speakingRef.current = false;
      if (activeRef.current) {
        setState("listening");
        restartRecognition();
        if (modeRef.current === "wake-word") {
          // follow-up window: the conversation continues without re-waking —
          // attention stays open ~8s after Jarvis finishes speaking
          setAttentive(true);
          followTone();
          armDispatch(8000);
        }
      }
      else if (stateRef.current === "speaking") setState("idle");
    };
    window.addEventListener("jarvis:speaking", on);
    window.addEventListener("jarvis:spoken", off);
    return () => {
      window.removeEventListener("jarvis:speaking", on);
      window.removeEventListener("jarvis:spoken", off);
    };
  }, []);

  // ---- heartbeat: tell the call watcher our hot mic is Jarvis ----
  useEffect(() => {
    if (!persistent) return;
    const beat = () =>
      fetch("/api/voicestate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listening: true }),
      }).catch(() => {});
    beat();
    const t = setInterval(beat, 30_000);
    return () => {
      clearInterval(t);
      fetch("/api/voicestate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listening: false }),
      }).catch(() => {});
    };
  }, [persistent]);

  // ---- attention window: real-assistant endpointing --------------------------
  // "Jarvis" (even alone) opens attention; subsequent speech is STITCHED into
  // one command across Chrome's premature finalizations; dispatch happens only
  // after ~3s of ASR silence AND ~1.2s of acoustic silence (mic energy). The
  // energy gate matters because Chrome finalizes mid-sentence and goes deaf
  // for ~300ms while restarting — the analyser never does.
  const attentiveRef = useRef(false);
  const [attentive, setAttentiveState] = useState(false);
  const bufferRef = useRef("");
  const dispatchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastVoiceRef = useRef(0);   // last time the mic heard real energy
  const armStartRef = useRef(0);    // when this utterance's countdown began
  const setAttentive = (v: boolean) => { attentiveRef.current = v; setAttentiveState(v); };

  const chirp = () => {   // two quick rising tones: "I'm listening"
    try {
      const a = new AudioContext();
      const o = a.createOscillator();
      const g = a.createGain();
      o.connect(g); g.connect(a.destination);
      g.gain.setValueAtTime(0.06, a.currentTime);
      o.frequency.setValueAtTime(880, a.currentTime);
      o.frequency.setValueAtTime(1320, a.currentTime + 0.09);
      o.start(); o.stop(a.currentTime + 0.17);
      setTimeout(() => a.close().catch(() => {}), 400);
    } catch {}
  };

  const followTone = () => {   // one soft tone: "your turn"
    try {
      const a = new AudioContext();
      const o = a.createOscillator();
      const g = a.createGain();
      o.connect(g); g.connect(a.destination);
      g.gain.setValueAtTime(0.04, a.currentTime);
      o.frequency.setValueAtTime(660, a.currentTime);
      o.start(); o.stop(a.currentTime + 0.1);
      setTimeout(() => a.close().catch(() => {}), 300);
    } catch {}
  };

  const dispatchBuffer = () => {
    // energy gate: if the mic heard voice in the last 1.2s the user isn't
    // done — keep waiting (capped at 20s so room noise can't hold a command
    // hostage forever)
    const quietFor = performance.now() - lastVoiceRef.current;
    const heldFor = performance.now() - armStartRef.current;
    if (quietFor < 1200 && heldFor < 20_000) {
      dispatchTimer.current = setTimeout(dispatchBuffer, 1500);
      return;
    }
    const text = bufferRef.current.trim();
    bufferRef.current = "";
    setAttentive(false);
    if (text) void sendUtterance(text);
  };
  const armDispatch = (ms: number) => {
    if (dispatchTimer.current) clearTimeout(dispatchTimer.current);
    armStartRef.current = performance.now();
    dispatchTimer.current = setTimeout(dispatchBuffer, ms);
  };
  const holdDispatch = () => {
    if (dispatchTimer.current) clearTimeout(dispatchTimer.current);
  };

  const sendUtterance = async (text: string) => {
    if (locationRef.current.startsWith("/chat")) {
      window.dispatchEvent(new CustomEvent("jarvis:send", { detail: { text, voice: true } }));
      return;
    }
    const sid = currentSessionId();
    setState("thinking");
    appendTranscript(sid, [{ c: "me", t: text }]);
    try {
      const reply = await streamChatTurn(sid, text);
      appendTranscript(sid, [{ c: "jarvis", t: reply || "(no reply)" }]);
      window.dispatchEvent(new Event("jarvis:transcript"));
      if (reply) await speak(reply);   // speaking events drive state
    } catch {
      appendTranscript(sid, [{ c: "jarvis", t: "(connection lost)" }]);
    } finally {
      if (activeRef.current) setState("listening");
      else setState("idle");
    }
  };

  // one-shot mode still sends a single utterance directly
  const handleFinal = (raw: string) => {
    const text = raw.trim();
    if (!text) return;
    if (modeRef.current === "wake-word") {
      const m = text.match(WAKE_RE);
      if (!m || !m[1].trim()) return;
      void sendUtterance(m[1].trim());
    } else {
      void sendUtterance(text);
    }
  };

  // persistent modes: stitch speech across pauses, dispatch on real silence
  const handleStream = (text: string, isFinal: boolean) => {
    if (speakingRef.current) return;              // never listen to ourselves
    if (modeRef.current === "conversation") {
      if (!isFinal) { holdDispatch(); return; }   // still talking — wait
      bufferRef.current += " " + text;
      armDispatch(3000);
      return;
    }
    // wake-word mode
    if (!isFinal) {
      if (attentiveRef.current) { holdDispatch(); return; }
      if (WAKE_RE.test(text.trim())) { setAttentive(true); chirp(); }
      return;
    }
    const m = text.trim().match(WAKE_RE);
    if (m) {
      if (!attentiveRef.current) { setAttentive(true); chirp(); }
      const rest = m[1].trim();
      if (rest) bufferRef.current += " " + rest;
      // content → short endpoint; bare "hey jarvis" → wait for the question
      armDispatch(rest ? 3000 : 6000);
    } else if (attentiveRef.current) {
      bufferRef.current += " " + text;
      armDispatch(3000);
    }
    // not attentive, no wake word → discarded locally
  };

  const makeRecognition = () => {
    const SR = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    if (!SR) return null;
    const rec = new SR();
    rec.lang = "en-IN";
    rec.interimResults = true;
    rec.continuous = true;
    rec.onresult = (e: any) => {
      const last = e.results[e.results.length - 1];
      handleStream(last[0].transcript, last.isFinal);
    };
    rec.onend = () => {
      // Chrome self-stops on silence — in persistent modes we just restart
      if (activeRef.current && !speakingRef.current)
        setTimeout(() => { try { recRef.current?.start(); } catch {} }, 300);
      else if (!activeRef.current && stateRef.current === "listening")
        setState("idle");
    };
    rec.onerror = (e: any) => {
      if (e.error === "not-allowed") stopAll();
    };
    return rec;
  };

  const restartRecognition = () => {
    try { recRef.current?.start(); } catch {}
  };

  const attachAnalyser = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setVoicePresence(true);   // mic is ours — tell the call watcher
      streamRef.current = stream;
      const actx = new AudioContext();
      const src = actx.createMediaStreamSource(stream);
      const analyser = actx.createAnalyser();
      analyser.fftSize = 128;
      src.connect(analyser);   // analyser only — never to speakers
      analyserRef.current = analyser;
    } catch {}
  };

  const stopAll = () => {
    setVoicePresence(false);
    activeRef.current = false;
    setPersistent(false);
    setAttentive(false);
    bufferRef.current = "";
    holdDispatch();
    localStorage.setItem("jarvis_mic_on", "0");
    try { recRef.current?.stop(); } catch {}
    recRef.current = null;
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
    analyserRef.current = null;
    setState("idle");
  };

  const startPersistent = async () => {
    const rec = makeRecognition();
    if (!rec) return;
    await attachAnalyser();
    recRef.current = rec;
    activeRef.current = true;
    setPersistent(true);
    localStorage.setItem("jarvis_mic_on", "1");
    setState("listening");
    try { rec.start(); } catch {}
  };

  const startOnDemand = async () => {
    const rec = makeRecognition();
    if (!rec) return;
    rec.continuous = false;
    await attachAnalyser();
    recRef.current = rec;
    activeRef.current = false;
    setState("listening");
    rec.onresult = (e: any) => {
      const last = e.results[e.results.length - 1];
      if (!last.isFinal) return;
      try { rec.stop(); } catch {}
      streamRef.current?.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
      analyserRef.current = null;
      handleFinal(last[0].transcript);
    };
    try { rec.start(); } catch {}
  };

  const onMicClick = () => {
    if (state === "listening" || persistent) { stopAll(); return; }
    if (mode === "on-demand") void startOnDemand();
    else void startPersistent();
  };

  // Arm the mic the moment a persistent mode is chosen in settings; on plain
  // page loads, resume only if it was on before (a manual mic-click stop is
  // respected across reloads).
  const prevModeRef = useRef<string | null>(null);
  useEffect(() => {
    if (!settings) return;
    const prev = prevModeRef.current;
    prevModeRef.current = mode;
    if (mode === "on-demand") {
      if (activeRef.current) stopAll();
      return;
    }
    const explicitSwitch = prev !== null && prev !== mode;  // just picked in ⚙
    const resume = localStorage.getItem("jarvis_mic_on") === "1";
    if (!activeRef.current && (explicitSwitch || resume)) void startPersistent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, !!settings]);

  const status =
    state === "listening"
      ? mode === "wake-word" && attentive ? "GO AHEAD…" : "LISTENING"
    : state === "thinking" ? "THINKING"
    : state === "speaking" ? "SPEAKING"
    : "VOICE READY";

  return (
    <div className="flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--chipbg)] py-1 pl-1 pr-3">
      <button
        onClick={onMicClick}
        title={
          mode === "on-demand"
            ? "Click to talk to Jarvis"
            : persistent ? "Listening — click to stop" : "Click to start listening"
        }
        className={`flex h-[30px] w-[30px] items-center justify-center rounded-full border text-[14px] ${
          state === "listening"
            ? "blip border-[var(--cyan)] bg-[var(--cyan)] text-[#012] shadow-[0_0_18px_var(--cyan)]"
            : "border-[rgba(57,215,255,.4)] bg-[rgba(57,215,255,.12)] text-[var(--cyan)]"
        }`}
      >
        🎙️
      </button>
      <canvas ref={canvasRef} width={120} height={26} className="h-[26px] w-[120px]" />
      <span
        className={`min-w-[64px] text-[9px] tracking-[1.5px] ${
          state === "listening"
            ? "text-[var(--cyan)] [text-shadow:0_0_10px_rgba(57,215,255,.6)]"
            : state === "thinking"
              ? "text-[var(--amber)]"
              : state === "speaking"
                ? "text-[var(--green)] [text-shadow:0_0_10px_rgba(62,224,138,.6)]"
                : "text-[var(--dim)]"
        }`}
      >
        {status}
      </span>
    </div>
  );
}
