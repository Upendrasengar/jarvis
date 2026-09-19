// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
import { useEffect, useId, useRef, useState } from 'react';
import { microphoneError, openMicrophone, savedMicrophone, saveMicrophone } from './microphone';

export function MicrophonePicker({ onStart, onClose, onCancel }: {
  onStart: (deviceId: string) => Promise<void>;
  onClose: () => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const alive = useRef(true);
  const titleId = useId();
  const inputId = useId();
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selected, setSelected] = useState(savedMicrophone);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    alive.current = true;
    const trigger = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    dialog?.showModal();
    const media = navigator.mediaDevices;
    let revision = 0;
    let cancelled = false;
    const refresh = async (requestPermission = false) => {
      const current = ++revision;
      let stream: MediaStream | undefined;
      try {
        if (!media?.enumerateDevices) throw new Error('Microphone access requires localhost or HTTPS.');
        let inputs = (await media.enumerateDevices()).filter(d => d.kind === 'audioinput');
        if (requestPermission && (!inputs.length || inputs.some(d => !d.label))) {
          stream = await openMicrophone('');
          if (cancelled) return;
          inputs = (await media.enumerateDevices()).filter(d => d.kind === 'audioinput');
        }
        if (!cancelled && current === revision) {
          setDevices(inputs.filter(d => d.deviceId && d.deviceId !== 'default'));
          setError(inputs.length ? '' : 'No microphones found. Connect an input device and try again.');
        }
      } catch (err) {
        if (!cancelled && current === revision) setError(microphoneError(err));
      } finally {
        stream?.getTracks().forEach(track => track.stop());
        if (!cancelled && current === revision) setLoading(false);
      }
    };
    void refresh(true);
    const changed = () => { void refresh(); };
    media?.addEventListener('devicechange', changed);
    return () => {
      cancelled = true;
      alive.current = false;
      media?.removeEventListener('devicechange', changed);
      dialog?.close();
      trigger?.focus();
    };
  }, []);

  const missing = !!selected && !devices.some(device => device.deviceId === selected);
  const start = async () => {
    if (starting) return;
    setStarting(true);
    setError('');
    try {
      await onStart(selected);
      if (!alive.current) return;
      saveMicrophone(selected);
      onClose();
    } catch (err) {
      if (alive.current) { setError(microphoneError(err)); setStarting(false); }
    }
  };

  return (
    <dialog ref={dialogRef} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onCancel(); }}
      className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-sm rounded-2xl border border-[var(--line)] bg-[var(--surf)] p-5 text-[var(--text)] shadow-xl backdrop:bg-black/50">
      <h2 id={titleId} className="font-sans text-lg font-semibold">Choose microphone</h2>
      <p className="mt-1 text-xs text-[var(--dim)]">Choose the audio input for talking to Jarvis.</p>
      <label htmlFor={inputId} className="mb-2 mt-5 block text-[10px] uppercase tracking-[2px] text-[var(--dim)]">Audio input</label>
      <select id={inputId} autoFocus value={selected} disabled={loading || starting} onChange={event => setSelected(event.target.value)}
        className="w-full rounded-lg border border-[var(--line)] bg-[var(--surf-2)] p-3 text-sm text-[var(--text)] focus:outline-[var(--cyan)]">
        <option value="">Browser default</option>
        {missing && <option value={selected} disabled>Saved microphone unavailable</option>}
        {devices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Microphone ${index + 1}`}</option>)}
      </select>
      {/* Kept as a live region while enumerating — it announces progress. The
          idle half said the choice is remembered, which is both obvious once
          it happens and now rarely seen at all, since the picker only opens
          when there is nothing remembered. */}
      {loading && <p className="mt-2 text-xs text-[var(--dim)]" role="status">Finding microphones…</p>}
      {error && <p role="alert" className="mt-3 text-xs text-[var(--red)]">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-lg border border-[var(--line)] px-4 py-2 text-xs disabled:opacity-50">Cancel</button>
        <button type="button" disabled={loading || starting || missing} onClick={() => void start()}
          className="rounded-lg border border-[var(--cyan-3)] bg-[var(--cyan-2)] px-4 py-2 text-xs text-[var(--cyan)] disabled:opacity-50">{starting ? 'Starting…' : 'Start listening'}</button>
      </div>
    </dialog>
  );
}
