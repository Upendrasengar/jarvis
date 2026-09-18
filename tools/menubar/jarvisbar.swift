// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// JarvisBar — the menu-bar face of Jarvis. A single-file AppKit app built by
// install.sh (swiftc, ad-hoc signed), no Xcode project. It is the master
// switch: launching it starts the server if it's down, and the icon shows
// live state (red badge + elapsed while a call records). All privileged work
// stays in the server/JarvisAudio — this app only talks localhost HTTP, so
// it needs no permissions of its own.
import AppKit
import UserNotifications
import WebKit

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

// Shared by every menu item that shows a page. The window is created once and
// reused; holding it here keeps the call sites unchanged.
let dashboard = DashboardWindow()

func openPage(_ path: String) {
    guard let u = URL(string: "http://localhost:\(port())" + path) else { return }
    dashboard.show(u)
}

// Jarvis in its own window rather than a browser tab.
//
// A WKWebView, not Electron: the system already has a renderer, and shipping a
// second copy of Chromium to display a local page would cost more than the
// rest of the app put together.
//
// The data store is NON-PERSISTENT on purpose. During development a browser
// cached the built bundle so stubbornly that the dashboard kept serving a
// version hours old — new tabs, cache-busting queries and even no-store
// fetches returned the stale copy. A window that keeps no cache always shows
// what the server is actually serving.
final class DashboardWindow: NSObject, WKUIDelegate, NSWindowDelegate {
    private var window: NSWindow?
    private var web: WKWebView?
    private var iconSet = false
    private var titleObs: NSKeyValueObservation?

    // The Dock showed a blank generic icon because the bundle has no .icns —
    // this app is built by swiftc from a single file, with no Xcode project to
    // carry an asset catalogue. Drawing it at runtime keeps that property and
    // guarantees the Dock matches the menu bar, since both come from the same
    // symbol rather than from an exported file that can drift out of step.
    static func dockIcon() -> NSImage? {
        let side: CGFloat = 512
        // Tint through the symbol configuration rather than filling over the
        // drawn glyph: sourceAtop paints every opaque pixel in the rect, so the
        // background square was tinted too and the brain disappeared into it.
        let cfg = NSImage.SymbolConfiguration(pointSize: 260, weight: .regular)
            .applying(NSImage.SymbolConfiguration(paletteColors: [
                NSColor(calibratedRed: 0.36, green: 0.86, blue: 0.96, alpha: 1)]))   // dashboard cyan
        guard let glyph = NSImage(systemSymbolName: AppDelegate.glyph + ".fill",
                                  accessibilityDescription: "Jarvis")?
            .withSymbolConfiguration(cfg) else { return nil }
        glyph.isTemplate = false

        let img = NSImage(size: NSSize(width: side, height: side))
        img.lockFocus()
        defer { img.unlockFocus() }

        // macOS rounds app icons to a squircle; a bare glyph on transparency
        // reads as a broken icon beside everything else in the Dock.
        let inset: CGFloat = 40
        let rect = NSRect(x: inset, y: inset, width: side - inset * 2, height: side - inset * 2)
        NSColor(calibratedRed: 0.04, green: 0.09, blue: 0.13, alpha: 1).setFill()
        NSBezierPath(roundedRect: rect, xRadius: 112, yRadius: 112).fill()

        // fit to ~58% of the canvas rather than the symbol's intrinsic size,
        // which at this point size fills the whole square
        let target = side * 0.58
        let g = glyph.size
        let scale = min(target / g.width, target / g.height)
        let w = g.width * scale, h = g.height * scale
        glyph.draw(in: NSRect(x: (side - w) / 2, y: (side - h) / 2, width: w, height: h))
        return img
    }

    func show(_ url: URL) {
        NSApp.setActivationPolicy(.regular)     // a window needs a Dock presence
        if NSApp.applicationIconImage == nil || !iconSet {
            NSApp.applicationIconImage = Self.dockIcon()
            iconSet = true
        }
        if let w = window {
            if web?.url != url { web?.load(URLRequest(url: url)) }
            w.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
            return
        }
        let cfg = WKWebViewConfiguration()
        cfg.websiteDataStore = .nonPersistent()
        cfg.mediaTypesRequiringUserActionForPlayback = []   // spoken replies autoplay
        let v = WKWebView(frame: .zero, configuration: cfg)
        v.uiDelegate = self
        // "Jarvis" on every route tells you nothing. The page already sets a
        // title per view, so follow it and fall back when it is empty.
        titleObs = v.observe(\.title, options: [.new]) { [weak self] _, _ in
            guard let t = self?.web?.title, !t.isEmpty else { return }
            self?.window?.title = t
        }
        v.load(URLRequest(url: url))
        web = v

        let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1180, height: 820),
                         styleMask: [.titled, .closable, .miniaturizable, .resizable],
                         backing: .buffered, defer: false)
        w.title = "Jarvis"
        // A native window shows its document icon beside the title. There is no
        // file here, so represent the app itself: the same brain the Dock, the
        // menu bar and notifications use, drawn once and reused.
        w.representedURL = URL(fileURLWithPath: "/")
        if let btn = w.standardWindowButton(.documentIconButton) {
            btn.image = Self.dockIcon()
            btn.action = nil            // not a file — clicking it should do nothing
        }
        w.contentView = v
        w.center()
        w.setFrameAutosaveName("JarvisDashboard")   // remembers size and position
        w.delegate = self
        w.isReleasedWhenClosed = false              // reused, not dangling
        window = w
        w.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    // The dashboard's voice feature calls getUserMedia. Without this the
    // request is denied silently and the mic simply never turns on — the same
    // shape of failure as the notifications that went nowhere for weeks.
    func webView(_ webView: WKWebView,
                 requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                 initiatedByFrame frame: WKFrameInfo,
                 type: WKMediaCaptureType,
                 decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        decisionHandler(origin.host == "localhost" || origin.host == "127.0.0.1" ? .grant : .deny)
    }

    // Back to a menu-bar-only app when the window closes, so Jarvis does not
    // sit in the Dock doing nothing.
    func windowWillClose(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
    }
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

    // The icon never had a point size, so it rendered at whatever the symbol's
    // intrinsic size happened to be — noticeably chunkier than the 16pt glyphs
    // every other menu-bar app uses. One helper now sizes all three states
    // identically, and clamps the drawn image to the 18pt the menu bar expects.
    // The mascot. A brain rather than a waveform: recording calls is one
    // capability, but most of what Jarvis does is digests, recall and notes —
    // the icon should say assistant, not tape machine. One constant, because
    // the idle and recording states derive from it.
    static let glyph = "brain"
    func icon(_ name: String, tint: NSColor?) -> NSImage? {
        var cfg = NSImage.SymbolConfiguration(pointSize: 16, weight: .regular, scale: .medium)
        if let tint { cfg = cfg.applying(NSImage.SymbolConfiguration(paletteColors: [tint])) }
        // Not every glyph has a .fill variant, and an unknown symbol name
        // returns nil — which shows as NO icon at all. Fall back to the base
        // name so changing the mascot can never blank the menu bar.
        let base = NSImage(systemSymbolName: name, accessibilityDescription: "Jarvis")
            ?? NSImage(systemSymbolName: name.replacingOccurrences(of: ".fill", with: ""),
                       accessibilityDescription: "Jarvis")
        let img = base?.withSymbolConfiguration(cfg)
        img?.size = NSSize(width: 18, height: 18)
        img?.isTemplate = (tint == nil)       // template = adapts to light/dark
        return img
    }

    func render() {
        guard let btn = item.button else { return }
        // Muted wins the icon. While the mic is off, "am I being recorded?" is
        // the question the menu bar has to answer at a glance — a red dot says
        // the opposite of the truth.
        if micMuted {
            btn.image = icon("mic.slash.circle.fill", tint: .systemOrange)
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
        let sym = recording ? Self.glyph + ".fill" : Self.glyph
        if recording {
            // contentTintColor on status-item buttons is unreliable — paint
            // the symbol itself via a palette configuration, and the counter
            // via an attributed title. Red on ANY menu bar appearance.
            btn.image = icon(sym, tint: .systemRed)
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
            btn.image = icon(sym, tint: nil)
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
