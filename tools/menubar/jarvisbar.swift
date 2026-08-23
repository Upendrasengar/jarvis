// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// JarvisBar — the menu-bar face of Jarvis. A single-file AppKit app built by
// install.sh (swiftc, ad-hoc signed), no Xcode project. It is the master
// switch: launching it starts the server if it's down, and the icon shows
// live state (red badge + elapsed while a call records). All privileged work
// stays in the server/JarvisAudio — this app only talks localhost HTTP, so
// it needs no permissions of its own.
import AppKit

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
    var startedServer = false

    func applicationDidFinishLaunching(_ n: Notification) {
        item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        let menu = NSMenu()
        menu.delegate = self
        item.menu = menu
        render()
        poll()
        timer = Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { [weak self] _ in self?.poll() }
    }

    func poll() {
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
