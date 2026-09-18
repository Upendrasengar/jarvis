// WebKit exposes SpeechRecognition in the native app but rejects its service.
// Record the chosen track and transcribe each utterance with Jarvis's local Whisper.
export class LocalRecognition {
  readonly acceptsAudioTrack = true;
  lang = "en-IN";
  interimResults = false;
  continuous = false;
  onresult: ((event: any) => void) | null = null;
  onerror: ((event: { error: string; message?: string }) => void) | null = null;
  onend: (() => void) | null = null;
  private recorder: MediaRecorder | null = null;
  private context: AudioContext | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private request: AbortController | null = null;
  private generation = 0;
  private heardSpeech = false;
  private chunks: Blob[] = [];

  start(track?: MediaStreamTrack) {
    if (this.recorder || this.request) throw new DOMException("Already listening", "InvalidStateError");
    if (!track || track.readyState !== "live") throw new Error("Microphone disconnected. Choose another input.");
    const generation = ++this.generation;
    this.heardSpeech = false;
    this.chunks = [];
    try {
      const stream = new MediaStream([track]);
      const recorder = new MediaRecorder(stream);
      this.recorder = recorder;
      recorder.ondataavailable = event => { if (generation === this.generation && event.data.size) this.chunks.push(event.data); };
      recorder.onerror = () => this.fail("recording-failed", "Could not record the selected microphone.");
      recorder.onstop = () => { if (generation === this.generation) void this.finish(generation); };
      const context = new AudioContext();
      this.context = context;
      void context.resume().catch(() => {});
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      context.createMediaStreamSource(stream).connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      const started = performance.now();
      let lastSpeech = started;
      let voicedFrames = 0;
      recorder.start(250);
      this.timer = setInterval(() => {
        analyser.getFloatTimeDomainData(samples);
        const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
        const now = performance.now();
        if (rms > 0.012) {
          lastSpeech = now;
          if (++voicedFrames >= 3) this.heardSpeech = true;
        } else { voicedFrames = 0; }
        if ((this.heardSpeech && now - lastSpeech > 1400) || now - started > (this.heardSpeech ? 20_000 : 8000)) this.stop();
      }, 100);
    } catch (error) {
      this.abort();
      throw error;
    }
  }

  private releaseMeter() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    void this.context?.close().catch(() => {});
    this.context = null;
  }

  stop() {
    this.releaseMeter();
    if (this.recorder?.state === "recording") this.recorder.stop();
  }

  abort() {
    this.generation++;
    this.request?.abort();
    this.request = null;
    this.releaseMeter();
    if (this.recorder?.state === "recording") this.recorder.stop();
    this.recorder = null;
    this.chunks = [];
  }

  private fail(error: string, message: string) {
    this.abort();
    this.onerror?.({ error, message });
    this.onend?.();
  }

  private async finish(generation: number) {
    this.recorder = null;
    const audio = new Blob(this.chunks);
    this.chunks = [];
    if (!this.heardSpeech || !audio.size) { this.onend?.(); return; }
    const controller = new AbortController();
    this.request = controller;
    try {
      const response = await fetch("/api/voice/transcribe", {
        method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: audio, signal: controller.signal,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Local transcription failed.");
      if (generation !== this.generation) return;
      this.request = null;
      if (result.text?.trim()) {
        const hypothesis = Object.assign([{ transcript: result.text.trim() }], { isFinal: true });
        this.onresult?.({ results: [hypothesis] });
      }
      if (generation === this.generation) this.onend?.();
    } catch (error) {
      if (generation === this.generation) this.fail("transcription-failed", error instanceof Error ? error.message : "Local transcription failed.");
    } finally {
      if (this.request === controller) this.request = null;
    }
  }
}
