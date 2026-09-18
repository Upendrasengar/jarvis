// Device IDs are browser-local; never sync them to the server or another computer.
const INPUT_KEY = 'jarvis_audio_input';
export const savedMicrophone = () => {
  try { return localStorage.getItem(INPUT_KEY) || ''; } catch { return ''; }
};
export const saveMicrophone = (id: string) => {
  try { localStorage.setItem(INPUT_KEY, id); } catch {}
};

// start(track) has no safe capability probe: older engines silently ignore it.
// https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/start
export function supportsAudioTrack(ua = navigator.userAgent): boolean {
  return !/Android|iPhone|iPad|iPod/.test(ua) && Number(ua.match(/Chrome\/(\d+)/)?.[1] || 0) >= 135;
}

export function openMicrophone(id: string, media = navigator.mediaDevices): Promise<MediaStream> {
  if (!media?.getUserMedia) throw new Error('Microphone access requires localhost or HTTPS.');
  return media.getUserMedia({ audio: id ? { deviceId: { exact: id } } : true });
}

export function startRecognition(rec: { start: (track?: MediaStreamTrack) => void; acceptsAudioTrack?: boolean }, stream: MediaStream | null, id: string, trackSupported = supportsAudioTrack()) {
  if (!trackSupported && !rec.acceptsAudioTrack) {
    if (id) throw new Error('Choose Browser default, or use desktop Chrome 135+ to select a microphone.');
    rec.start();
    return;
  }
  const track = stream?.getAudioTracks()[0];
  if (!track || track.readyState !== 'live') throw new Error('Microphone disconnected. Choose an available input.');
  rec.start(track);
}

export function microphoneError(error: unknown): string {
  const name = (error as { name?: string })?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Microphone permission was denied. Allow microphone access in your browser and try again.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'Microphone unavailable. Connect it or choose another input.';
  if (name === 'NotReadableError') return 'Microphone is busy or unavailable. Check the device and try again.';
  return error instanceof Error ? error.message : 'Could not start the microphone. Please try again.';
}
