// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// JarvisBar — the menu-bar face of Jarvis. A single-file AppKit app built by
// install.sh (swiftc, ad-hoc signed), no Xcode project. It is the master
// switch: launching it starts the server if it's down, and the icon shows
// live state (red badge + elapsed while a call records). All privileged work
// stays in the server/JarvisAudio — this app only talks localhost HTTP, so
// it needs no permissions of its own.
import AppKit
import UserNotifications

// ── config: repo dir comes from Info.plist (templated at build time);
// the port follows memory/settings/port.txt like everything else
let jarvisDir = (Bundle.main.object(forInfoDictionaryKey: "JarvisDir") as? String) ?? ""
func port() -> Int {
    // same precedence as tools/services.sh: port.txt, else 4321
    let p = jarvisDir + "/memory/settings/port.txt"
    if let s = try? String(contentsOfFile: p, encoding: .utf8) {
        let digits = s.components(separatedBy: .newlines).first?
            .filter { $0.isNumber } ?? ""
        if let n = Int(digits), n > 0 { return n }
    }
    return 4321
}
func base() -> String { "http://127.0.0.1:\(port())" }

func getJSON(_ path: String, done: @escaping ([String: Any]?) -> Void) {
    guard let url = URL(string: base() + path) else { return done(nil) }
    var req = URLRequest(url: url); req.timeoutInterval = 2.5
    URLSession.shared.dataTask(with: req) { data, resp, _ in
        guard let d = data, (resp as? HTTPURLResponse)?.statusCode == 200,
              let j = try? JSONSerialization.jsonObject(with: d) as? [String: Any]
        else { return DispatchQueue.main.async { done(nil) } }
        DispatchQueue.main.async { done(j) }
    }.resume()
}

func postJSON(_ path: String, _ body: [String: Any] = [:]) {
    guard let url = URL(string: base() + path) else { return }
    var req = URLRequest(url: url)
    req.httpMethod = "POST"
    req.timeoutInterval = 5
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.httpBody = try? JSONSerialization.data(withJSONObject: body)
    URLSession.shared.dataTask(with: req).resume()
}

func runTool(_ args: [String]) {
    guard !jarvisDir.isEmpty else { return }
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/bin/bash")
    p.arguments = [jarvisDir + "/tools/services.sh"] + args
    p.currentDirectoryURL = URL(fileURLWithPath: jarvisDir)
    // launched at login the app gets a bare PATH — make sure brew/node resolve
    var env = ProcessInfo.processInfo.environment
    env["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:" + (env["PATH"] ?? "")
    p.environment = env
    try? p.run()
}

func openPage(_ path: String) {
    if let u = URL(string: "http://localhost:\(port())" + path) { NSWorkspace.shared.open(u) }
}

class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
    var item: NSStatusItem!
    var timer: Timer?
    var serverUp = false
    var recording = false
    var recStarted: Date?
    var autorecord = true
    var micMuted = false
    var muteMinutesLeft = 0
    var startedServer = false

    // Notifications used to be shelled out with `osascript display notification`
    // from five places. Two problems with that: macOS attributes them to
    // "osascript" rather than Jarvis, so there is nothing recognisable to grant
    // permission to; and call-watch runs under launchd (parent PID 1), a
    // context those notifications routinely never leave. Every call site also
    // swallowed its own errors, so a notification that went nowhere was
    // indistinguishable from one that arrived.
    //
    // This bundle is a real, signed app. It can hold the permission, it shows
    // as "Jarvis" in System Settings, and it is already awake on a 3-second
    // timer — so it drains a queue file that any script can append to.
    let queueURL: URL = {
        let dir = Bundle.main.object(forInfoDictionaryKey: "JarvisDir") as? String ?? "."
        return URL(fileURLWithPath: dir).appendingPathComponent("data/notify-queue.jsonl")
    }()
    var notifyReady = false

    func askForNotifications() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { granted, err in
            DispatchQueue.main.async {
                self.notifyReady = granted
                if let err = err { NSLog("[jarvisbar] notification auth error: \(err)") }
                if !granted { NSLog("[jarvisbar] notifications not granted — enable Jarvis in System Settings › Notifications") }
            }
        }
    }

    // Read and TRUNCATE in one step: a notification must fire once, and a
    // crash between the two would otherwise repeat the whole backlog.
    func drainNotifications() {
        guard let h = try? FileHandle(forUpdating: queueURL) else { return }
        defer { try? h.close() }
        guard let data = try? h.readToEnd(), !data.isEmpty else { return }
        try? h.truncate(atOffset: 0)
        for line in String(decoding: data, as: UTF8.self).split(separator: "\n") {
            guard let d = line.data(using: .utf8),
                  let j = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
                  let body = j["body"] as? String, !body.isEmpty else { continue }
            let c = UNMutableNotificationContent()
            c.title = (j["title"] as? String) ?? "Jarvis"
            c.body = body
            c.sound = (j["silent"] as? Bool == true) ? nil : .default
            UNUserNotificationCenter.current().add(
                UNNotificationRequest(identifier: UUID().uuidString, content: c, trigger: nil))
        }
    }

    func applicationDidFinishLaunching(_ n: Notification) {
        askForNotifications()
        item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        let menu = NSMenu()
        menu.delegate = self
        item.menu = menu
        render()
        poll()
        timer = Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { [weak self] _ in
            self?.poll()
            self?.drainNotifications()
        }
    }

    func pollMute() {
        getJSON("/api/mic-mute") { [weak self] j in
            guard let self else { return }
            let m = (j?["muted"] as? Bool) ?? false
            let left = (j?["minutesLeft"] as? Int) ?? 0
            if m != self.micMuted || left != self.muteMinutesLeft {
                self.micMuted = m; self.muteMinutesLeft = left; self.render()
            }
        }
    }

    func poll() {
        pollMute()
        getJSON("/api/health") { [weak self] h in
            guard let self else { return }
            let wasUp = self.serverUp
            self.serverUp = h != nil
            // master switch: first sight of a down server → start it (once)
            if !self.serverUp && !self.startedServer && !jarvisDir.isEmpty {
                self.startedServer = true
                runTool(["start"])
            }
            if self.serverUp && !wasUp { self.startedServer = false }
            if self.serverUp {
                getJSON("/api/recstate") { [weak self] r in
                    guard let self else { return }
                    self.recording = (r?["recording"] as? Bool) ?? false
                    if self.recording, let s = r?["started"] as? String {
                        let f = DateFormatter()
                        f.dateFormat = "yyyy-MM-dd HH:mm"
                        self.recStarted = f.date(from: String(s.prefix(16)))
                    } else { self.recStarted = nil }
                    self.render()
                }
                getJSON("/api/autorecord") { [weak self] a in
                    self?.autorecord = (a?["on"] as? Bool) ?? true
                }
            } else {
                self.recording = false
                self.render()
            }
        }
    }

    func render() {
        guard let btn = item.button else { return }
        // Muted wins the icon. While the mic is off, "am I being recorded?" is
        // the question the menu bar has to answer at a glance — a red dot says
        // the opposite of the truth.
        if micMuted {
            let cfg = NSImage.SymbolConfiguration(paletteColors: [.systemOrange])
            let img = NSImage(systemSymbolName: "mic.slash.circle.fill",
                              accessibilityDescription: "Jarvis — microphone muted")?
                .withSymbolConfiguration(cfg)
            img?.isTemplate = false
            btn.image = img
            // still show the counter when a call is being recorded around you:
            // the far side is captured, only your room is not
            var t = muteMinutesLeft > 0 ? " \(muteMinutesLeft)m" : ""
            if recording, let s = recStarted {
                let secs = max(0, Int(Date().timeIntervalSince(s)))
                t = String(format: " %d:%02d", secs / 60, secs % 60)
            }
            btn.attributedTitle = NSAttributedString(string: t, attributes: [
                .foregroundColor: NSColor.systemOrange,
                .font: NSFont.monospacedDigitSystemFont(ofSize: 12, weight: .semibold),
            ])
            return
        }
        let sym = recording ? "waveform.circle.fill" : "waveform.circle"
        if recording {
            // contentTintColor on status-item buttons is unreliable — paint
            // the symbol itself via a palette configuration, and the counter
            // via an attributed title. Red on ANY menu bar appearance.
            let cfg = NSImage.SymbolConfiguration(paletteColors: [.systemRed])
            let img = NSImage(systemSymbolName: sym, accessibilityDescription: "Jarvis recording")?
                .withSymbolConfiguration(cfg)
            img?.isTemplate = false
            btn.image = img
            var t = " REC"
            if let s = recStarted {
                let secs = max(0, Int(Date().timeIntervalSince(s)))
                let m = secs / 60
                t = m >= 60 ? String(format: " %d:%02dh", m / 60, m % 60)
                            : String(format: " %d:%02d", m, secs % 60)
            }
            btn.attributedTitle = NSAttributedString(string: t, attributes: [
                .foregroundColor: NSColor.systemRed,
                .font: NSFont.monospacedDigitSystemFont(ofSize: 12, weight: .semibold),
            ])
        } else {
            let img = NSImage(systemSymbolName: sym, accessibilityDescription: "Jarvis")
            img?.isTemplate = true       // adapts to light/dark menu bars
            btn.image = img
            btn.contentTintColor = serverUp ? nil : .disabledControlTextColor
            btn.attributedTitle = NSAttributedString(string: "")
        }
    }

    // menu reflects live state every time it opens
    func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems()
        let status = NSMenuItem(
            title: serverUp
                ? (recording ? "● Recording a call" : "● Online · local only")
                : "○ Server starting…",
            action: nil, keyEquivalent: "")
        status.isEnabled = false
        menu.addItem(status)
        menu.addItem(.separator())

        menu.addItem(mk("Open Dashboard", #selector(dash), "d"))
        menu.addItem(mk("Today's Digest", #selector(digest), ""))
        menu.addItem(.separator())

        if recording {
            menu.addItem(mk("■ Stop & Save Recording", #selector(stopRec), "s"))
        } else if serverUp {
            menu.addItem(mk("● Record a Call Now", #selector(startRec), "r"))
        }
        menu.addItem(mk(micMuted ? "🔇 Mic muted — \(muteMinutesLeft)m left · Unmute"
                                 : "🎙 Mute My Mic (1 hour)", #selector(toggleMute), "m"))
        let auto = mk(autorecord ? "Auto-record Calls ✓" : "Auto-record Calls", #selector(toggleAuto), "")
        menu.addItem(auto)
        menu.addItem(.separator())

        menu.addItem(mk("Activity & Logs", #selector(logs), ""))
        menu.addItem(mk("Restart Server", #selector(restart), ""))
        menu.addItem(.separator())
        menu.addItem(mk("Quit Jarvis (stops services)", #selector(quit), "q"))
    }

    func mk(_ title: String, _ sel: Selector, _ key: String) -> NSMenuItem {
        let m = NSMenuItem(title: title, action: sel, keyEquivalent: key)
        m.target = self
        return m
    }

    @objc func dash() { openPage("/") }
    @objc func digest() { openPage("/digest") }
    @objc func logs() { openPage("/logs") }
    @objc func toggleMute() {
        postJSON("/api/mic-mute", ["on": !micMuted])
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { self.pollMute() }
    }
    @objc func startRec() { postJSON("/api/calls/startrec"); DispatchQueue.main.asyncAfter(deadline: .now() + 2) { self.poll() } }
    @objc func stopRec() { postJSON("/api/calls/stoprec"); DispatchQueue.main.asyncAfter(deadline: .now() + 2) { self.poll() } }
    @objc func toggleAuto() { postJSON("/api/autorecord", ["on": !autorecord]); autorecord.toggle() }
    @objc func restart() { runTool(["restart"]) }
    @objc func quit() {
        // quitting the icon quits Jarvis: boot the login service out first so
        // launchd's KeepAlive can't resurrect the server, then stop services
        timer?.invalidate()
        DispatchQueue.global().async {
            let stop = Process()
            stop.executableURL = URL(fileURLWithPath: "/bin/bash")
            stop.arguments = ["-c",
                "launchctl bootout gui/$(id -u)/com.jarvis 2>/dev/null; " +
                "\"\(jarvisDir)/tools/services.sh\" stop"]
            var env = ProcessInfo.processInfo.environment
            env["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:" + (env["PATH"] ?? "")
            stop.environment = env
            try? stop.run()
            stop.waitUntilExit()
            DispatchQueue.main.async { NSApp.terminate(nil) }
        }
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)   // menu bar only, no dock icon
app.run()
