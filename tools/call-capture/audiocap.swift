// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// audiocap — record system audio (everything the Mac plays) to a WAV file
// using ScreenCaptureKit. This is how Jarvis hears the OTHER side of a call.
//
// Usage:  audiocap /path/to/system.wav
// Stops cleanly on SIGINT/SIGTERM and finalizes the file.
//
// First run triggers the macOS Screen Recording permission prompt (SCK audio
// rides on that permission). Grant it once for the process that launches this
// (Terminal / launchd context) and it sticks.

import Foundation
import AVFoundation
import CoreGraphics
import ScreenCaptureKit

// Permission plumbing: `audiocap --check` prints machine-readable status for
// jarvis doctor; `audiocap --request` triggers the system prompts so setup
// can surface them at a calm moment instead of mid-first-call.
// When launched via `open` (the only way TCC attributes to THIS app rather
// than the spawning terminal), stdout is lost — an optional result-file path
// carries the answer back.
func permissionStatus() -> (String, Bool) {
    let screen = CGPreflightScreenCaptureAccess()
    let mic = AVCaptureDevice.authorizationStatus(for: .audio)
    let micStr: String
    switch mic {
    case .authorized: micStr = "granted"
    case .denied, .restricted: micStr = "denied"
    default: micStr = "not-determined"
    }
    let text = "screen-recording: \(screen ? "granted" : "denied")\nmicrophone: \(micStr)\n"
    return (text, screen && mic == .authorized)
}

func permissionCheck(resultFile: String?) -> Never {
    let (text, ok) = permissionStatus()
    print(text, terminator: "")
    if let f = resultFile { try? text.write(toFile: f, atomically: true, encoding: .utf8) }
    exit(ok ? 0 : 2)
}

func permissionRequest(resultFile: String?) -> Never {
    // screen prompt (also registers this app in the Settings list)
    if !CGPreflightScreenCaptureAccess() { _ = CGRequestScreenCaptureAccess() }
    // mic prompt
    let sem = DispatchSemaphore(value: 0)
    AVCaptureDevice.requestAccess(for: .audio) { _ in sem.signal() }
    _ = sem.wait(timeout: .now() + 120)
    permissionCheck(resultFile: resultFile)
}

final class SystemAudioRecorder: NSObject, SCStreamOutput, SCStreamDelegate {
    private let url: URL
    private var file: AVAudioFile?
    private var stream: SCStream?
    private let queue = DispatchQueue(label: "jarvis.audiocap")

    init(url: URL) { self.url = url }

    func start() async throws {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
        guard let display = content.displays.first else {
            throw NSError(domain: "audiocap", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "no display found"])
        }
        let filter = SCContentFilter(display: display, excludingWindows: [])
        let cfg = SCStreamConfiguration()
        cfg.capturesAudio = true
        cfg.excludesCurrentProcessAudio = true
        cfg.sampleRate = 48000
        cfg.channelCount = 2
        // We only want audio; keep the mandatory video leg as cheap as possible.
        cfg.width = 2
        cfg.height = 2
        cfg.minimumFrameInterval = CMTime(value: 1, timescale: 1)

        let stream = SCStream(filter: filter, configuration: cfg, delegate: self)
        try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: queue)
        try await stream.startCapture()
        self.stream = stream
    }

    func stop() {
        let sem = DispatchSemaphore(value: 0)
        stream?.stopCapture { _ in sem.signal() }
        _ = sem.wait(timeout: .now() + 3)
        queue.sync { self.file = nil }  // closes the file
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
                of type: SCStreamOutputType) {
        guard type == .audio, sampleBuffer.isValid,
              let pcm = pcmBuffer(from: sampleBuffer) else { return }
        if file == nil {
            file = try? AVAudioFile(forWriting: url, settings: pcm.format.settings,
                                    commonFormat: .pcmFormatFloat32, interleaved: false)
        }
        try? file?.write(from: pcm)
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        fputs("audiocap: stream stopped: \(error.localizedDescription)\n", stderr)
        exit(1)
    }

    private func pcmBuffer(from sampleBuffer: CMSampleBuffer) -> AVAudioPCMBuffer? {
        try? sampleBuffer.withAudioBufferList { audioBufferList, _ in
            guard let absd = sampleBuffer.formatDescription?.audioStreamBasicDescription,
                  let format = AVAudioFormat(standardFormatWithSampleRate: absd.mSampleRate,
                                             channels: absd.mChannelsPerFrame)
            else { return nil }
            return AVAudioPCMBuffer(pcmFormat: format,
                                    bufferListNoCopy: audioBufferList.unsafePointer)
        }
    }
}

// Mic capture (Phase 2): the same app identity records YOUR side too —
// one "Jarvis Audio" grant covers both, and no ffmpeg/terminal attribution.
// Writes 16 kHz mono 16-bit WAV, whisper's preferred diet.
final class MicRecorder {
    private let engine = AVAudioEngine()
    private var file: AVAudioFile?
    private let url: URL

    init(url: URL) { self.url = url }

    func start() throws {
        let input = engine.inputNode
        let inFmt = input.outputFormat(forBus: 0)
        guard let outFmt = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16000,
                                         channels: 1, interleaved: true),
              let conv = AVAudioConverter(from: inFmt, to: outFmt) else {
            throw NSError(domain: "audiocap", code: 3,
                          userInfo: [NSLocalizedDescriptionKey: "mic format setup failed"])
        }
        file = try AVAudioFile(forWriting: url, settings: outFmt.settings,
                               commonFormat: .pcmFormatInt16, interleaved: true)
        input.installTap(onBus: 0, bufferSize: 4096, format: inFmt) { [weak self] buf, _ in
            guard let self, let file = self.file else { return }
            let ratio = 16000.0 / inFmt.sampleRate
            let cap = AVAudioFrameCount(Double(buf.frameLength) * ratio + 32)
            guard let out = AVAudioPCMBuffer(pcmFormat: outFmt, frameCapacity: cap) else { return }
            var consumed = false
            var err: NSError?
            conv.convert(to: out, error: &err) { _, status in
                if consumed { status.pointee = .noDataNow; return nil }
                consumed = true; status.pointee = .haveData; return buf
            }
            if out.frameLength > 0 { try? file.write(from: out) }
        }
        try engine.start()
    }

    func stop() {
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        file = nil   // closes/finalizes
    }
}

let args = CommandLine.arguments
if args.count >= 2 && args[1] == "--check" { permissionCheck(resultFile: args.count > 2 ? args[2] : nil) }
if args.count >= 2 && args[1] == "--request" { permissionRequest(resultFile: args.count > 2 ? args[2] : nil) }
guard args.count >= 2 else {
    fputs("usage: audiocap <output.wav> [log] | --mic <output.wav> [log] | --check [file] | --request [file]\n", stderr)
    exit(2)
}
let micMode = args[1] == "--mic"
let outPath = micMode ? args[2] : args[1]
let logIdx = micMode ? 3 : 2
// optional log arg — `open` gives us no stderr, so redirect
if args.count > logIdx { freopen(args[logIdx], "a", stderr) }
if micMode && args.count < 3 { fputs("usage: audiocap --mic <output.wav> [log]\n", stderr); exit(2) }

let outURL = URL(fileURLWithPath: outPath)
let sysRecorder: SystemAudioRecorder? = micMode ? nil : SystemAudioRecorder(url: outURL)
let micRecorder: MicRecorder? = micMode ? MicRecorder(url: outURL) : nil

for sig in [SIGINT, SIGTERM] {
    signal(sig, SIG_IGN)
    let src = DispatchSource.makeSignalSource(signal: sig, queue: .main)
    src.setEventHandler {
        sysRecorder?.stop()
        micRecorder?.stop()
        exit(0)
    }
    src.resume()
    // keep the source alive for the life of the process
    _ = Unmanaged.passRetained(src as AnyObject)
}

if micMode {
    do {
        try micRecorder?.start()
        fputs("audiocap: recording microphone -> \(outPath)\n", stderr)
    } catch {
        fputs("audiocap: mic failed to start: \(error.localizedDescription)\n", stderr)
        exit(1)
    }
} else {
    Task {
        do {
            try await sysRecorder?.start()
            fputs("audiocap: recording system audio -> \(outPath)\n", stderr)
        } catch {
            fputs("audiocap: failed to start: \(error.localizedDescription)\n", stderr)
            exit(1)
        }
    }
}

dispatchMain()
