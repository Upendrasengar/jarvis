// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { LocalRecognition } from '../src/features/voice/LocalRecognition.ts';

test('local recognition sends the chosen track, then drops cancelled transcripts and closes audio resources', async () => {
  const originals = new Map(['MediaRecorder', 'MediaStream', 'AudioContext', 'fetch', 'setInterval', 'clearInterval'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let tick: () => void = () => {};
  let selectedTrack: unknown;
  let closed = 0;
  let stopped = 0;
  let resolveFetch!: (value: unknown) => void;
  let signal: AbortSignal | undefined;
  const recorderReady: Array<() => void> = [];
  class Recorder {
    state = 'inactive';
    ondataavailable: any;
    onstop: any;
    start() { this.state = 'recording'; }
    stop() {
      this.state = 'inactive'; stopped++;
      this.ondataavailable?.({ data: new Blob(['audio']) });
      recorderReady.push(() => this.onstop?.());
    }
  }
  Object.assign(globalThis, {
    MediaRecorder: Recorder,
    MediaStream: class { constructor(tracks: unknown[]) { selectedTrack = tracks[0]; } },
    AudioContext: class {
      resume() { return Promise.resolve(); }
      close() { closed++; return Promise.resolve(); }
      createMediaStreamSource() { return { connect() {} }; }
      createAnalyser() { return { fftSize: 2048, getFloatTimeDomainData: (samples: Float32Array) => samples.fill(0.1) }; }
    },
    setInterval: (callback: () => void) => { tick = callback; return 1; },
    clearInterval() {},
    fetch: (_url: string, options: RequestInit) => { signal = options.signal as AbortSignal; return new Promise(resolve => { resolveFetch = resolve; }); },
  });
  try {
    const recognition = new LocalRecognition();
    const result = mock.fn();
    recognition.onresult = result;
    const track = { readyState: 'live' } as MediaStreamTrack;
    recognition.start(track);
    assert.equal(selectedTrack, track);
    tick(); tick(); tick();
    recognition.stop();
    recorderReady.shift()!();
    assert.equal(closed, 1);
    assert.equal(stopped, 1);
    recognition.abort();
    assert.equal(signal?.aborted, true);
    resolveFetch({ ok: true, json: async () => ({ text: 'cancelled utterance' }) });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(result.mock.callCount(), 0);
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
