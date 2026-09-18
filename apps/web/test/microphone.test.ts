import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openMicrophone, startRecognition, supportsAudioTrack } from '../src/features/voice/microphone.ts';

test('only supported desktop browsers can select the recognition input', () => {
  assert.equal(supportsAudioTrack('Chrome/135.0.0.0'), true);
  for (const ua of ['Chrome/134.0.0.0', 'Android Chrome/150.0.0.0', 'Version/18.0 Safari/605.1', 'CriOS/150.0']) {
    assert.equal(supportsAudioTrack(ua), false);
  }
});

test('selected microphone is requested exactly, with no silent fallback', async () => {
  let constraints: unknown;
  const stream = {} as MediaStream;
  const media = { getUserMedia: async (value: unknown) => { constraints = value; return stream; } };
  assert.equal(await openMicrophone('usb-mic', media), stream);
  assert.deepEqual(constraints, { audio: { deviceId: { exact: 'usb-mic' } } });
  await openMicrophone('', media);
  assert.deepEqual(constraints, { audio: true });
  await assert.rejects(openMicrophone('missing', { getUserMedia: async () => { throw new Error('disconnected'); } }), /disconnected/);
});

test('recognition and every restart receive the captured audio track', () => {
  const track = { kind: 'audio', readyState: 'live' } as MediaStreamTrack;
  const stream = { getAudioTracks: () => [track] } as MediaStream;
  const inputs: unknown[] = [];
  const rec = { start: (...args: unknown[]) => inputs.push(args), abort() {} };
  startRecognition(rec, stream, 'usb-mic', true);
  startRecognition(rec, stream, 'usb-mic', true);
  assert.deepEqual(inputs, [[track], [track]]);
});

test('unsupported browsers never silently ignore an explicit microphone', () => {
  let started = false;
  const rec = { start: () => { started = true; }, abort() {} };
  assert.throws(() => startRecognition(rec, null, 'usb-mic', false), /Chrome/);
  assert.equal(started, false);
  startRecognition(rec, null, '', false);
  assert.equal(started, true);
});

test('a missing or ended track cannot start recognition', () => {
  const rec = { start() { assert.fail('must not start'); }, abort() {} };
  assert.throws(() => startRecognition(rec, null, 'usb-mic', true), /disconnected/);
  const stream = { getAudioTracks: () => [{ kind: 'audio', readyState: 'ended' }] } as MediaStream;
  assert.throws(() => startRecognition(rec, stream, 'usb-mic', true), /disconnected/);
});

 test('local recognition accepts selected audio on WebKit', () => {
  const track = { readyState: 'live' } as MediaStreamTrack;
  const stream = { getAudioTracks: () => [track] } as MediaStream;
  let received: unknown;
  startRecognition({ acceptsAudioTrack: true, start: value => { received = value; } }, stream, 'usb-mic', false);
  assert.equal(received, track);
});
