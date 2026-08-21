// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// Spoken replies — one shared player so chat and background voice never talk
// over each other. Broadcasts jarvis:speaking / jarvis:spoken for the header
// voice bar's status + waveform.
let current: HTMLAudioElement | null = null;

export async function speak(text: string): Promise<void> {
  // SOURCES: lines are for eyes (rendered as links), not for ears
  text = text.replace(/^SOURCES:.*$/gim, "").trim();
  if (!text) return;
  try {
    const r = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!r.ok) return;
    const url = URL.createObjectURL(await r.blob());
    current?.pause();
    current = new Audio(url);
    window.dispatchEvent(new Event("jarvis:speaking"));
    await new Promise<void>((resolve) => {
      current!.onended = current!.onerror = () => resolve();
      current!.play().catch(() => resolve());
    });
  } finally {
    window.dispatchEvent(new Event("jarvis:spoken"));
  }
}
