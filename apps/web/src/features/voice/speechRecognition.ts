import { LocalRecognition } from "./LocalRecognition";
import { supportsAudioTrack } from "./microphone";

export function createRecognition(): any {
  const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (SR && supportsAudioTrack()) return new SR();
  if (typeof MediaRecorder === "undefined") throw new Error("Audio recording is unavailable in this browser.");
  return new LocalRecognition();
}
