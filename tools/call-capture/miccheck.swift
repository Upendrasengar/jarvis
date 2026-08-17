// miccheck [excludePid ...] — prints "1" if ANY process is currently capturing
// audio input (any microphone — built-in, AirPods, USB headset), "0" if not.
// PIDs passed as arguments are ignored, so call-watch can exclude its OWN
// mic recorder (ffmpeg) when asking "is the CALL still using the mic?".
//
// miccheck --pids — prints the PID of each capturing process, one per line,
// so call-watch can resolve WHO holds the mic (e.g. the Teams desktop app).
//
// Uses the macOS 14.4+ process-object API (kAudioProcessPropertyIsRunningInput)
// rather than checking the default input device, which misses calls taken on
// a non-default mic (AirPods etc). No permissions needed.

import CoreAudio
import Foundation

let args = CommandLine.arguments.dropFirst()
let pidsMode = args.contains("--pids")
let excluded = Set(args.compactMap { Int32($0) })

let system = AudioObjectID(kAudioObjectSystemObject)
var addr = AudioObjectPropertyAddress(
    mSelector: kAudioHardwarePropertyProcessObjectList,
    mScope: kAudioObjectPropertyScopeGlobal,
    mElement: kAudioObjectPropertyElementMain)

var size: UInt32 = 0
guard AudioObjectGetPropertyDataSize(system, &addr, 0, nil, &size) == noErr, size > 0 else {
    print("0")
    exit(0)
}

var procs = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
guard AudioObjectGetPropertyData(system, &addr, 0, nil, &size, &procs) == noErr else {
    print("0")
    exit(0)
}

var inputAddr = AudioObjectPropertyAddress(
    mSelector: kAudioProcessPropertyIsRunningInput,
    mScope: kAudioObjectPropertyScopeGlobal,
    mElement: kAudioObjectPropertyElementMain)
var pidAddr = AudioObjectPropertyAddress(
    mSelector: kAudioProcessPropertyPID,
    mScope: kAudioObjectPropertyScopeGlobal,
    mElement: kAudioObjectPropertyElementMain)

var found = false
for proc in procs {
    var running: UInt32 = 0
    var rsize = UInt32(MemoryLayout<UInt32>.size)
    guard AudioObjectGetPropertyData(proc, &inputAddr, 0, nil, &rsize, &running) == noErr,
          running != 0 else { continue }
    var pid: pid_t = -1
    var psize = UInt32(MemoryLayout<pid_t>.size)
    let havePid = AudioObjectGetPropertyData(proc, &pidAddr, 0, nil, &psize, &pid) == noErr
    if havePid && excluded.contains(pid) { continue }
    if pidsMode {
        if havePid { print(pid) }
        found = true
    } else {
        print("1")
        exit(0)
    }
}
if !pidsMode { print(found ? "1" : "0") }
