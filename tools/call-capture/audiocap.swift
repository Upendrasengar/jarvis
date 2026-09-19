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
import CoreAudio

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

// ── input device selection ─────────────────────────────────────────────────
// macOS keeps "MacBook Pro Microphone" as the default input even with the lid
// closed, where it is physically obstructed and delivers digital zero. TCC
// still answers "granted", every permission check passes, and the recording is
// silence. That is how eight calls lost one side of the conversation: nothing
// asked whether sound was ARRIVING, only whether we were allowed to listen.
//
// So the default gets no benefit of the doubt. Listen to it for a moment, and
// if nothing is coming through, record from a device where something is.
//
// The bar is deliberately "digital zero", not "quiet". A real microphone in a
// silent room still has a noise floor around -60 dBFS; an obstructed or dead
// one produces exact zeros. Switching on "quiet" would hand a live call to the
// wrong device every time someone stopped talking.
private let deadPeak: Float = 1e-5          // ≈ -100 dBFS: silence, not quiet
private let probeSeconds = 0.8

private func systemObjectIDs(_ selector: AudioObjectPropertySelector) -> [AudioDeviceID] {
    var addr = AudioObjectPropertyAddress(mSelector: selector,
                                          mScope: kAudioObjectPropertyScopeGlobal,
                                          mElement: kAudioObjectPropertyElementMain)
    var size: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject),
                                         &addr, 0, nil, &size) == noErr else { return [] }
    var ids = [AudioDeviceID](repeating: 0, count: Int(size) / MemoryLayout<AudioDeviceID>.size)
    guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject),
                                     &addr, 0, nil, &size, &ids) == noErr else { return [] }
    return ids
}

private func deviceName(_ id: AudioDeviceID) -> String {
    var addr = AudioObjectPropertyAddress(mSelector: kAudioObjectPropertyName,
                                          mScope: kAudioObjectPropertyScopeGlobal,
                                          mElement: kAudioObjectPropertyElementMain)
    // CoreAudio hands back a +1 CFStringRef, so take it as Unmanaged and
    // release it. Reading straight into a `var name: CFString` compiles but
    // writes a raw pointer over a managed reference, which is a leak at best.
    var name: Unmanaged<CFString>?
    var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
    guard AudioObjectGetPropertyData(id, &addr, 0, nil, &size, &name) == noErr,
          let n = name?.takeRetainedValue() else { return "device \(id)" }
    return n as String
}

private func hasInputChannels(_ id: AudioDeviceID) -> Bool {
    var addr = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyStreamConfiguration,
                                          mScope: kAudioObjectPropertyScopeInput,
                                          mElement: kAudioObjectPropertyElementMain)
    var size: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(id, &addr, 0, nil, &size) == noErr, size > 0 else { return false }
    let raw = UnsafeMutableRawPointer.allocate(byteCount: Int(size),
                                               alignment: MemoryLayout<AudioBufferList>.alignment)
    defer { raw.deallocate() }
    guard AudioObjectGetPropertyData(id, &addr, 0, nil, &size, raw) == noErr else { return false }
    let list = UnsafeMutableAudioBufferListPointer(raw.assumingMemoryBound(to: AudioBufferList.self))
    return list.reduce(0) { $0 + Int($1.mNumberChannels) } > 0
}

private func defaultInputDevice() -> AudioDeviceID? {
    var addr = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDefaultInputDevice,
                                          mScope: kAudioObjectPropertyScopeGlobal,
                                          mElement: kAudioObjectPropertyElementMain)
    var id: AudioDeviceID = 0
    var size = UInt32(MemoryLayout<AudioDeviceID>.size)
    guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject),
                                     &addr, 0, nil, &size, &id) == noErr, id != 0 else { return nil }
    return id
}

@discardableResult
private func bindInput(_ engine: AVAudioEngine, to id: AudioDeviceID) -> Bool {
    guard let unit = engine.inputNode.audioUnit else { return false }
    var dev = id
    return AudioUnitSetProperty(unit, kAudioOutputUnitProperty_CurrentDevice,
                                kAudioUnitScope_Global, 0, &dev,
                                UInt32(MemoryLayout<AudioDeviceID>.size)) == noErr
}

// Loudest sample seen in a short listen. Negative means the device would not
// open at all, which is as disqualifying as silence.
private func probePeak(_ id: AudioDeviceID) -> Float {
    let engine = AVAudioEngine()
    guard bindInput(engine, to: id) else { return -1 }
    let input = engine.inputNode
    let fmt = input.outputFormat(forBus: 0)
    guard fmt.sampleRate > 0, fmt.channelCount > 0 else { return -1 }

    let lock = NSLock()
    var peak: Float = 0
    input.installTap(onBus: 0, bufferSize: 4096, format: fmt) { buf, _ in
        var local: Float = 0
        if let ch = buf.floatChannelData {
            for c in 0..<Int(buf.format.channelCount) {
                for i in 0..<Int(buf.frameLength) { local = max(local, abs(ch[c][i])) }
            }
        } else if let ch = buf.int16ChannelData {
            for c in 0..<Int(buf.format.channelCount) {
                for i in 0..<Int(buf.frameLength) {
                    local = max(local, abs(Float(ch[c][i]) / 32768.0))
                }
            }
        }
        lock.lock(); peak = max(peak, local); lock.unlock()
    }
    do { try engine.start() } catch { input.removeTap(onBus: 0); return -1 }
    Thread.sleep(forTimeInterval: probeSeconds)
    input.removeTap(onBus: 0)
    engine.stop()
    lock.lock(); defer { lock.unlock() }
    return peak
}

// Default first — it is what the owner chose, and it is usually right. The
// rest are fallbacks, tried only because the default proved deaf.
private func liveInputDevice() -> (id: AudioDeviceID, name: String, substituted: Bool)? {
    let fallback = systemObjectIDs(kAudioHardwarePropertyDevices).filter(hasInputChannels)
    var order: [AudioDeviceID] = []
    if let d = defaultInputDevice() { order.append(d) }
    order.append(contentsOf: fallback.filter { !order.contains($0) })
    guard !order.isEmpty else { return nil }

    for (i, id) in order.enumerated() {
        let name = deviceName(id)
        let peak = probePeak(id)
        if peak > deadPeak { return (id, name, i > 0) }
        fputs("audiocap: input '\(name)' is silent (peak \(String(format: "%.7f", max(peak, 0))))\n", stderr)
    }
    return nil
}

final class MicRecorder {
    private let engine = AVAudioEngine()
    private var file: AVAudioFile?
    private let url: URL

    // Mute writes SILENCE rather than skipping the write. mic.wav and
    // system16.wav are merged by timestamp afterwards, so dropping frames
    // would shorten one channel against the other and slide every later line
    // onto the wrong speaker. Zeroed frames keep the two timelines identical
    // and simply contain nothing.
    //
    // The flag is refreshed on its own timer, never from inside the audio
    // tap: that closure runs on the render thread, where a stat() per buffer
    // has no business being.
    private var muted = false
    private var muteTimer: DispatchSourceTimer?
    private let muteFile: URL

    // The directory is passed IN rather than read from the environment.
    // call-watch launches this app with `open`, which does not forward the
    // caller's environment — so JARVIS_DIR was never set, the path fell back
    // to the working directory ("/"), and mute was read from /data/mic-mute,
    // which does not exist. readMute() answered "not muted" every time and
    // nothing said otherwise: muting yourself did nothing on this path, while
    // the menu bar and the watcher both reported the mute as active.
    init(url: URL, jarvisDir: String) {
        self.url = url
        self.muteFile = URL(fileURLWithPath: jarvisDir).appendingPathComponent("data/mic-mute")
        if !FileManager.default.fileExists(atPath: URL(fileURLWithPath: jarvisDir).path) {
            fputs("audiocap: WARNING jarvis dir '\(jarvisDir)' does not exist — mute cannot be read\n", stderr)
        }
    }

    // File holds the epoch second the mute expires. An expired file is not
    // muted — a mute nobody remembers setting must not silence calls forever.
    private func readMute() -> Bool {
        guard let t = try? String(contentsOf: muteFile, encoding: .utf8),
              let until = Double(t.trimmingCharacters(in: .whitespacesAndNewlines)) else { return false }
        return Date().timeIntervalSince1970 < until
    }

    private func watchMute() {
        muted = readMute()
        let t = DispatchSource.makeTimerSource(queue: .global(qos: .utility))
        t.schedule(deadline: .now() + 1, repeating: 1)
        t.setEventHandler { [weak self] in self?.muted = self?.readMute() ?? false }
        t.resume()
        muteTimer = t
    }

    func start() throws {
        // Prove sound arrives BEFORE committing the call to this device. The
        // cost is under a second when the default works, which is the common
        // case; it is only slow when it is about to save the recording.
        if let live = liveInputDevice() {
            if live.substituted {
                bindInput(engine, to: live.id)
                fputs("audiocap: default input was silent — recording from '\(live.name)' instead\n", stderr)
            } else {
                fputs("audiocap: input '\(live.name)'\n", stderr)
            }
        } else {
            // Nothing on this machine is producing audio. Record anyway rather
            // than abort: a silent track still keeps the two channels aligned
            // for the merge, and call-watch's silence check raises the alarm.
            fputs("audiocap: WARNING no input device produced audio — recording will be silent\n", stderr)
        }
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
            if out.frameLength > 0 {
                if self.muted, let ch = out.int16ChannelData {
                    memset(ch[0], 0, Int(out.frameLength) * MemoryLayout<Int16>.size)
                }
                try? file.write(from: out)
            }
        }
        watchMute()
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
// Explicit beats ambient: `open` drops the environment, so the caller states
// the directory outright. The env var remains a fallback for direct execution.
func argValue(_ flag: String) -> String? {
    guard let i = args.firstIndex(of: flag), i + 1 < args.count else { return nil }
    return args[i + 1]
}
let jarvisDir = argValue("--dir")
    ?? ProcessInfo.processInfo.environment["JARVIS_DIR"]
    ?? FileManager.default.currentDirectoryPath

let micMode = args[1] == "--mic"
let outPath = micMode ? args[2] : args[1]
let logIdx = micMode ? 3 : 2
// optional log arg — `open` gives us no stderr, so redirect
// Only a real path is a log path. Without this, `--mic out.wav --dir /x`
// would freopen stderr onto a file literally named "--dir".
if args.count > logIdx, !args[logIdx].hasPrefix("--") { freopen(args[logIdx], "a", stderr) }
if micMode && args.count < 3 { fputs("usage: audiocap --mic <output.wav> [log]\n", stderr); exit(2) }

let outURL = URL(fileURLWithPath: outPath)
let sysRecorder: SystemAudioRecorder? = micMode ? nil : SystemAudioRecorder(url: outURL)
let micRecorder: MicRecorder? = micMode ? MicRecorder(url: outURL, jarvisDir: jarvisDir) : nil

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
