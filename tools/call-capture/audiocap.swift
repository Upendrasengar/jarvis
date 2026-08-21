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
import ScreenCaptureKit

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

let args = CommandLine.arguments
guard args.count == 2 else {
    fputs("usage: audiocap <output.wav>\n", stderr)
    exit(2)
}

let recorder = SystemAudioRecorder(url: URL(fileURLWithPath: args[1]))

for sig in [SIGINT, SIGTERM] {
    signal(sig, SIG_IGN)
    let src = DispatchSource.makeSignalSource(signal: sig, queue: .main)
    src.setEventHandler {
        recorder.stop()
        exit(0)
    }
    src.resume()
    // keep the source alive for the life of the process
    _ = Unmanaged.passRetained(src as AnyObject)
}

Task {
    do {
        try await recorder.start()
        fputs("audiocap: recording system audio -> \(args[1])\n", stderr)
    } catch {
        fputs("audiocap: failed to start: \(error.localizedDescription)\n", stderr)
        exit(1)
    }
}

dispatchMain()
