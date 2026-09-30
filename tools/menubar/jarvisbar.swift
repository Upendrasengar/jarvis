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

// The selection overlay.
//
// `screencapture -i` was the obvious choice and is the wrong one here. It is
// ONE-SHOT, and it draws the system crosshair with nowhere to put a label.
// This has to stay up for several grabs in a row and say what it is for, so
// the selection UI is ours; only the pixel grab is delegated, to
// `screencapture -R`, which takes an explicit rect and needs the same
// permission we would have needed anyway.
final class SelectionView: NSView {
    var onCommit: ((NSRect) -> Void)?
    var onEnd: (() -> Void)?
    // The bar gets out of the way for the duration of the drag: it sits over
    // the screen you are framing, and you cannot select what is behind it.
    var onDragStart: (() -> Void)?
    var onDragAbort: (() -> Void)?          // released without a usable rect
    var onCursorMoved: (() -> Void)?        // lets the bar follow you between displays
    private var anchor: NSPoint?
    private var drag: NSPoint?
    private var cursor: NSPoint = .zero
    // Mirrors what the bar is actually holding. It is not a tally of drags:
    // removing a thumbnail has to count, and a drag refused at the cap must
    // not. The page reports it; this only draws it.
    var shots = 0 { didSet { needsDisplay = true } }
    var maxShots = 4
    private var atMax: Bool { shots >= maxShots }

    override var acceptsFirstResponder: Bool { true }
    override var isFlipped: Bool { false }

    // The bar deliberately holds key status so you can type while framing, so
    // this view lives in a window that is NOT key. AppKit spends the first
    // click on such a window activating it and delivers no mouseDown — which
    // is why the first drag did nothing and the second worked.
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    // This view owns exactly ONE screen. `live` means the cursor is on it, so
    // it draws the scrim and the label; the others stay clear and silent.
    var live: Bool = false { didSet { needsDisplay = true } }

    // With no scrim, the cursor IS the mode indicator — an unchanged arrow
    // over an unchanged screen gives no sign that a drag would do anything.
    override func resetCursorRects() {
        super.resetCursorRects()
        addCursorRect(bounds, cursor: .crosshair)
    }

    // mouseMoved only reaches the KEY window by default, and this window is
    // not it — without an always-active tracking area the cursor label sits
    // wherever the pointer happened to enter.
    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        trackingAreas.forEach(removeTrackingArea)
        addTrackingArea(NSTrackingArea(rect: bounds,
                                       options: [.activeAlways, .mouseMoved, .inVisibleRect],
                                       owner: self, userInfo: nil))
    }

    private func selection() -> NSRect? {
        guard let a = anchor, let d = drag else { return nil }
        let r = NSRect(x: min(a.x, d.x), y: min(a.y, d.y), width: abs(a.x - d.x), height: abs(a.y - d.y))
        return (r.width < 4 || r.height < 4) ? nil : r
    }

    override func draw(_ dirty: NSRect) {
        if live {
            NSColor(white: 0, alpha: 0.22).setFill()
            bounds.fill()
        }
        if let sel = selection() {
            // Punch the selection clear so you see the real thing you are framing.
            NSColor.clear.set()
            sel.fill(using: .copy)
            // Brand cyan rather than white: this has to read against a white
            // document and a dark editor with no backdrop to separate it from
            // either, and a hairline white rect disappears on the first.
            NSColor(calibratedRed: 0.36, green: 0.86, blue: 0.96, alpha: 1).setStroke()
            let p = NSBezierPath(rect: sel)
            p.lineWidth = 2
            p.stroke()
        }
        if live { drawLabel() }
    }

    // The label rides with the cursor, which is the part that makes the mode
    // legible — a bare dimmed screen says nothing about what it wants.
    private func drawLabel() {
        let text: String
        if atMax          { text = "\(shots) captured · max — remove one to add another · ⏎ when done" }
        else if shots == 0 { text = "Drag to take a screenshot" }
        else               { text = "\(shots) captured · drag for another · ⏎ when done" }
        let attrs: [NSAttributedString.Key: Any] = [
            .font: NSFont.systemFont(ofSize: 12, weight: .medium),
            .foregroundColor: NSColor.black,
        ]
        let size = (text as NSString).size(withAttributes: attrs)
        let pad: CGFloat = 8
        var box = NSRect(x: cursor.x + 14, y: cursor.y - size.height - 14,
                         width: size.width + pad * 2, height: size.height + pad)
        // Keep it on screen when the cursor is near an edge.
        if box.maxX > bounds.maxX { box.origin.x = cursor.x - box.width - 14 }
        if box.minY < bounds.minY { box.origin.y = cursor.y + 14 }
        NSColor(white: 0.96, alpha: 0.98).setFill()
        NSBezierPath(roundedRect: box, xRadius: 6, yRadius: 6).fill()
        (text as NSString).draw(at: NSPoint(x: box.minX + pad, y: box.minY + pad / 2), withAttributes: attrs)
    }

    override func mouseMoved(with e: NSEvent) {
        cursor = convert(e.locationInWindow, from: nil)
        needsDisplay = true
        onCursorMoved?()
    }
    override func mouseDown(with e: NSEvent) {
        anchor = convert(e.locationInWindow, from: nil)
        drag = anchor
        needsDisplay = true
        onDragStart?()
    }
    override func mouseDragged(with e: NSEvent) { drag = convert(e.locationInWindow, from: nil); cursor = drag!; needsDisplay = true }

    override func mouseUp(with e: NSEvent) {
        defer { anchor = nil; drag = nil; needsDisplay = true }
        // A click, or a rect too small to be meant — put the bar back, since
        // nothing is going to capture and restore it.
        guard let sel = selection() else { onDragAbort?(); return }
        // Refuse rather than capture-and-silently-drop: the page caps at
        // maxShots, so a grab past it used to vanish while the label happily
        // counted it.
        guard !atMax else { onDragAbort?(); return }
        // Window coords → screen coords. The overlay spans every display, so
        // its own origin is the offset.
        let onScreen = NSRect(x: sel.minX + (window?.frame.minX ?? 0),
                              y: sel.minY + (window?.frame.minY ?? 0),
                              width: sel.width, height: sel.height)
        onCommit?(onScreen)
    }

    override func keyDown(with e: NSEvent) {
        // 53 = Esc, 36 = Return. Both mean "done"; Esc before the first grab
        // simply means you changed your mind.
        if e.keyCode == 53 || e.keyCode == 36 { onEnd?() } else { super.keyDown(with: e) }
    }
}

final class CaptureOverlay: NSWindow {
    override var canBecomeKey: Bool { true }

    // AppKit clamps a window's frame to fit ONE screen. This one is built to
    // span every display — on a two-monitor desk the union rect is larger than
    // either screen, so the clamp shoved the whole overlay onto the wrong one
    // and the dimming appeared on the display you were not looking at.
    // Returning the rect unchanged opts out of the clamp.
    override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect {
        frameRect
    }
}

// The floating ask-bar: click the icon, type, usually with a screenshot of
// whatever you were looking at already attached.
//
// An NSPanel rather than a second NSWindow, because it has to appear OVER
// another app without stealing that app's Dock slot or activating Jarvis. A
// plain panel will not take keystrokes though — canBecomeKey is false for
// non-activating panels — so the subclass below opts back in. Without it you
// get a bar you cannot type into.
final class QuickPanel: NSPanel {
    override var canBecomeKey: Bool { true }
}

// Both web views share ONE data store. They are separate WKWebViews on the
// same origin, and without sharing they get separate localStorage — the
// ask-bar would be a different browser from the dashboard, with its own idea
// of the theme and the session. (WKProcessPool would have been the other half
// of this before macOS 12; it has had no effect since.)
//
// PERSISTENT, as of now. It was non-persistent because during development a
// cached bundle kept the dashboard hours out of date — but that is the
// server's job and the server does it: every response carries
// `cache-control: no-store`, index.html and hashed assets alike, so nothing
// is cacheable to go stale in the first place.
//
// What the workaround cost was the conversation. loadTranscript() reads
// localStorage, and a store thrown away at every launch meant the app opened
// with an empty chat every single time while a browser on the same machine
// kept its history.
let sharedStore = WKWebsiteDataStore.default()

// A notification is the only way this app can speak when no window is up —
// which is exactly the case when a screenshot fails before the bar appears.
// Set JARVIS_BAR_DEBUG=1 and run the binary from a terminal to see what AppKit
// actually did with the overlay — a window placed on the wrong display looks
// identical from in here, and guessing at it twice was two guesses too many.
let barDebug = ProcessInfo.processInfo.environment["JARVIS_BAR_DEBUG"] != nil
func dbg(_ s: String) {
    guard barDebug else { return }
    FileHandle.standardError.write(("[bar] " + s + "\n").data(using: .utf8)!)
}

func notifyUser(_ text: String) {
    let c = UNMutableNotificationContent()
    c.title = "Jarvis"
    c.body = text
    UNUserNotificationCenter.current().add(
        UNNotificationRequest(identifier: UUID().uuidString, content: c, trigger: nil))
}

final class QuickBar: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
    private var panel: QuickPanel?
    private var web: WKWebView?
    private var pending: [String] = []    // captures that beat the page load
    private var loaded = false
    private let width: CGFloat = 720
    // One overlay PER SCREEN. A single window spanning the union of every
    // display produced three separate bugs — a scrim on the wrong monitor, a
    // coordinate conversion that inverted on a stacked layout, and a main
    // display that never showed the crosshair at all. Per-screen windows have
    // none of those: each one's origin IS its screen's origin, so there is no
    // conversion to get wrong, and nothing has to span anything.
    //
    // The cost is that a single drag cannot cross displays. That is the same
    // limit the rest of the OS has, and it buys correctness on the case that
    // actually happens.
    private var overlays: [CaptureOverlay] = []
    private var selViews: [SelectionView] = []
    private var shotCount = 0
    // Held so endCapture can remove it. Capture is now re-armable from the
    // bar, so beginCapture runs many times per session — installing a monitor
    // each time and never removing them stacks a new one on every re-arm.
    private var keyMonitor: Any?
    private var lastScreenFrame: NSRect = .zero
    // Follows the pointer while the bar is up. A timer rather than a global
    // NSEvent monitor on purpose: the monitor is event-driven and prettier,
    // but it is also the kind of thing that fails silently when a permission
    // is missing, and this session has lost enough rounds to silent failures.
    // 150ms of lag nobody will notice, and it cannot not-work.
    private var followTimer: Timer?

    // The screen the POINTER is on — NOT NSScreen.main, which is the screen
    // holding the key window. Once the bar opened it WAS the key window, so
    // main resolved to whatever display it was already on: self-reinforcing,
    // and on a multi-display desk the bar could never follow you anywhere.
    private func cursorScreen() -> NSScreen? {
        let p = NSEvent.mouseLocation
        return NSScreen.screens.first { $0.frame.contains(p) } ?? NSScreen.main
    }

    // Anchored to the BOTTOM, above the Dock. visibleFrame already excludes
    // the Dock and the menu bar, so minY is the top of the Dock rather than
    // the bottom of the screen — the gap below is deliberate breathing room,
    // not a Dock allowance.
    //
    // Bottom-anchored matters for more than taste: a row of captures makes
    // the panel taller, and growing from a fixed bottom edge pushes it UPWARD,
    // leaving the composer under the cursor where it started. Anchoring the
    // top would slide the input down out from under you mid-capture.
    private func frame(height: CGFloat) -> NSRect {
        let vis = cursorScreen()?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        return NSRect(x: vis.midX - width / 2,
                      y: vis.minY + 28,
                      width: width, height: height)
    }

    // The scrim belongs to the display you are actually looking at. The window
    // underneath it still spans them all, so crossing to the other screen keeps
    // working — the dimming simply moves with you.
    // While framing you move between displays, and a bar left behind on the
    // first one is no use — you cannot see what you typed. Only fires on an
    // actual screen CHANGE, so the mouseMoved firehose costs a rect compare.
    // Exactly one overlay is "live" — the one whose screen holds the cursor.
    private func syncLive() {
        let m = NSEvent.mouseLocation
        for (w, v) in zip(overlays, selViews) { v.live = w.frame.contains(m) }
    }

    private func followCursor() {
        // Not gated on capture any more. The bar should be on the screen you
        // are working on, full stop — during a drag it is hidden, and
        // isVisible covers that.
        guard let p = panel, p.isVisible, let s = cursorScreen() else { return }
        if s.frame == lastScreenFrame { return }
        lastScreenFrame = s.frame
        p.setFrame(frame(height: p.frame.height), display: true)
    }

    func show(capture: Bool) {
        if panel == nil { build() }
        guard let p = panel else { return }
        lastScreenFrame = cursorScreen()?.frame ?? .zero
        p.setFrame(frame(height: p.frame.height > 0 ? p.frame.height : 96), display: true)
        // makeKeyAndOrderFront ONLY — deliberately no NSApp.activate here.
        //
        // Activating raises every window the app owns, and if the dashboard
        // happened to be open it came forward over whatever you were about to
        // photograph. You then framed Jarvis without realising, and the grab
        // was perfectly faithful to what was actually on screen.
        //
        // This is why the panel is a .nonactivatingPanel that overrides
        // canBecomeKey: it takes keystrokes without its app becoming frontmost,
        // which is exactly the Spotlight behaviour this wants. Activating on
        // top of that threw the property away.
        p.makeKeyAndOrderFront(nil)
        // Reload rather than reuse. Keeping the page alive across opens meant
        // the bar kept whatever bundle it happened to load at launch, so a
        // rebuilt dashboard only reached it when the whole app was restarted —
        // a stale UI that no amount of reopening could clear. The page is on
        // localhost and weighs nothing; a fresh load every time is the honest
        // trade for never wondering which version you are looking at.
        //
        // didFinish does the focusing, and any capture taken while this is in
        // flight queues in `pending` and is drained there.
        loaded = false
        // An explicit load, NOT reload(). build() kicks off the first load and
        // show() runs immediately after it, so on the first open reload() was
        // racing a provisional load that had not committed — no current item to
        // reload, and the in-flight one cancelled. The panel came up blank, and
        // a blank panel that draws no background of its own is an invisible
        // one: "the bar stopped opening".
        if let u = URL(string: "http://localhost:\(port())/bar") {
            web?.load(URLRequest(url: u, cachePolicy: .reloadIgnoringLocalCacheData))
        }
        if capture { beginCapture() }
        followTimer?.invalidate()
        followTimer = Timer.scheduledTimer(withTimeInterval: 0.15, repeats: true) { [weak self] _ in
            self?.followCursor()
        }
    }

    func close() {
        followTimer?.invalidate()
        followTimer = nil
        panel?.orderOut(nil)      // before endCapture, so it skips the follow-me move
        endCapture()
    }

    private func build() {
        let cfg = WKWebViewConfiguration()
        cfg.websiteDataStore = sharedStore
        cfg.userContentController.add(self, name: "resize")
        cfg.userContentController.add(self, name: "close")
        cfg.userContentController.add(self, name: "submit")
        cfg.userContentController.add(self, name: "count")
        cfg.userContentController.add(self, name: "capture")
        let v = WKWebView(frame: NSRect(x: 0, y: 0, width: width, height: 96), configuration: cfg)
        if #available(macOS 13.3, *) { v.isInspectable = true }
        // The page paints its own rounded card; anything the web view draws
        // behind it would show as an opaque rectangle with square corners.
        v.setValue(false, forKey: "drawsBackground")
        v.navigationDelegate = self
        web = v          // show() issues the load, so there is exactly one

        let p = QuickPanel(contentRect: frame(height: 96),
                           styleMask: [.borderless, .nonactivatingPanel],
                           backing: .buffered, defer: false)
        p.isOpaque = false
        p.backgroundColor = .clear
        p.hasShadow = false                  // the card draws its own
        p.level = NSWindow.Level(rawValue: NSWindow.Level.floating.rawValue + 2)
        p.isMovableByWindowBackground = true
        p.hidesOnDeactivate = false
        p.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        p.contentView = v
        panel = p
    }

    func webView(_ w: WKWebView, didFinish n: WKNavigation!) {
        loaded = true
        // Focus belongs here now that every open reloads: evaluating into the
        // old page from show() would land on a document about to be replaced.
        w.evaluateJavaScript("window.__jarvisFocus && window.__jarvisFocus()")
        selViews.forEach { $0.shots = 0 }  // a reloaded page holds no captures
        shotCount = 0
        // Grabs taken before the page finished loading — drain them in order.
        let queued = pending
        pending = []
        for d in queued { attach(d) }
    }

    // MARK: capture mode
    //
    // The overlay stays up across grabs: drag, the shot appears in the bar,
    // drag again. Return or Esc ends it. It spans every display as one window
    // so a selection can start on one screen and the maths stays in one
    // coordinate space.
    private func beginCapture() {
        dbg("beginCapture: granted=\(CGPreflightScreenCaptureAccess()) alreadyUp=\(!overlays.isEmpty)")
        if !CGPreflightScreenCaptureAccess() {
            dbg("beginCapture: BAILED — no Screen Recording permission")
            CGRequestScreenCaptureAccess()
            notifyUser("Jarvis needs Screen Recording permission to grab a screenshot. "
                     + "System Settings → Privacy & Security → Screen Recording → enable Jarvis, then try again.")
            return
        }
        if !overlays.isEmpty { dbg("beginCapture: bailed — already up"); return }
        for s in NSScreen.screens {
            let w = CaptureOverlay(contentRect: s.frame, styleMask: [.borderless],
                                   backing: .buffered, defer: false)
            w.isOpaque = false
            w.backgroundColor = .clear
            w.hasShadow = false
            w.level = .floating                   // the bar sits above this
            w.ignoresMouseEvents = false
            w.acceptsMouseMovedEvents = true
            w.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
            let v = SelectionView(frame: NSRect(origin: .zero, size: s.frame.size))
            v.onCommit = { [weak self] r in self?.grab(r) }
            v.onEnd = { [weak self] in self?.endCapture() }
            v.onDragStart = { [weak self] in self?.panel?.orderOut(nil) }
            v.onDragAbort = { [weak self] in self?.panel?.makeKeyAndOrderFront(nil) }
            v.onCursorMoved = { [weak self] in self?.followCursor(); self?.syncLive() }
            v.shots = shotCount
            w.contentView = v
            w.setFrame(s.frame, display: false)
            w.orderFrontRegardless()              // orderFront is a no-op for an .accessory app
            overlays.append(w)
            selViews.append(v)
            dbg("overlay for screen \(s.frame) -> actual \(w.frame) visible=\(w.isVisible)")
        }
        lastScreenFrame = cursorScreen()?.frame ?? .zero
        syncLive()
        dbg("cursor=\(NSEvent.mouseLocation)  overlays=\(overlays.count)")
        dbg("panel(bar) = \(panel?.frame ?? .zero)")

        keyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] e in
            guard self?.overlays.isEmpty == false else { return e }
            if e.keyCode == 53 { self?.endCapture(); return nil }   // Esc leaves capture, not the bar
            return e
        }
    }

    // Leaves capture mode. Everything the bar is holding — typed text, the
    // captures so far — stays: this is "step aside", not "start over", and
    // the bar's own button arms it again.
    private func endCapture() {
        if let m = keyMonitor { NSEvent.removeMonitor(m); keyMonitor = nil }
        overlays.forEach { $0.orderOut(nil) }
        overlays.removeAll()
        selViews.removeAll()
        // Leaving capture brings the bar TO you. Esc is what you press to get
        // at the screen you were framing — scrolling it, reading it — so the
        // composer belongs on that screen, not stranded on the one you
        // happened to start from.
        if let p = panel, p.isVisible {
            lastScreenFrame = cursorScreen()?.frame ?? .zero
            p.setFrame(frame(height: p.frame.height), display: true)
            p.makeKeyAndOrderFront(nil)
        }
    }

    // The grab itself is still the system's, via -R: same pixels, same
    // permission, and none of the colour-space work a CGImage round trip
    // would have needed.
    private func grab(_ rectInScreen: NSRect) {
        // Cocoa is bottom-left origin; screencapture wants top-left, measured
        // from the top of the MAIN display.
        let mainTop = NSScreen.screens.first?.frame.maxY ?? rectInScreen.maxY
        let x = Int(rectInScreen.minX.rounded())
        let y = Int((mainTop - rectInScreen.maxY).rounded())
        let w = Int(rectInScreen.width.rounded())
        let h = Int(rectInScreen.height.rounded())
        let tmp = NSTemporaryDirectory() + "jarvis-shot-\(UUID().uuidString).png"
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
        p.arguments = ["-x", "-R\(x),\(y),\(w),\(h)", tmp]   // -x: no shutter sound
        // The bar is already hidden (mouseDown did that); the dimming goes too,
        // or the shot comes back dimmed with our own selection border baked
        // into it. Both are restored together once the pixels are on disk.
        overlays.forEach { $0.orderOut(nil) }
        // The dashboard is Jarvis's too, and it has no business being in a
        // screenshot of somebody else's app. Hidden only for the grab, and put
        // back exactly where it was in the stacking order.
        let dashWasVisible = dashboard.isWindowVisible
        if dashWasVisible { dashboard.hideForCapture() }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.08) {
            // Off the main thread: waitUntilExit here would freeze the overlay
            // and the bar for as long as screencapture takes.
            DispatchQueue.global(qos: .userInitiated).async {
                try? p.run()
                p.waitUntilExit()
                let data = try? Data(contentsOf: URL(fileURLWithPath: tmp))
                try? FileManager.default.removeItem(atPath: tmp)
                DispatchQueue.main.async {
                    if dashWasVisible { dashboard.restoreAfterCapture() }
                    self.overlays.forEach { $0.orderFrontRegardless() }
                    self.syncLive()
                    self.panel?.makeKeyAndOrderFront(nil)
                    if let d = data, !d.isEmpty {
                        self.deliver("data:image/png;base64," + d.base64EncodedString())
                    }
                }
            }
        }
    }

    private func deliver(_ dataUrl: String) {
        if loaded { attach(dataUrl) } else { pending.append(dataUrl) }
    }

    private func attach(_ dataUrl: String) {
        // Through JSON so the base64 payload cannot terminate the string
        // literal it is being embedded in.
        guard let j = try? JSONSerialization.data(withJSONObject: [dataUrl]),
              let arr = String(data: j, encoding: .utf8) else { return }
        web?.evaluateJavaScript("window.__jarvisAttach && window.__jarvisAttach(\(arr)[0])")
    }

    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) {
        if m.name == "close" { close(); return }
        // Re-arm from the bar. beginCapture is a no-op while an overlay is
        // already up, so a stray click cannot stack two of them.
        if m.name == "capture" { beginCapture(); return }
        // The bar is the only thing that knows how many images it holds —
        // captures ADD and the thumbnail ✕ REMOVES, and the overlay label has
        // to say the truth after either.
        if m.name == "count", let n = m.body as? NSNumber {
            shotCount = n.intValue
            selViews.forEach { $0.shots = shotCount }
            return
        }
        // Sending hands the whole turn to the dashboard chat and gets out of
        // the way. The bar is a launcher, not a second place your conversation
        // lives — the answer belongs with the rest of the history.
        if m.name == "submit" {
            // Passed through as opaque JSON. Swift has no business knowing the
            // shape of an image the page built and the page will consume.
            guard let d = try? JSONSerialization.data(withJSONObject: m.body),
                  let json = String(data: d, encoding: .utf8) else { return }
            close()
            dashboard.submit(payload: json)
            return
        }
        if m.name == "resize", let h = m.body as? NSNumber, let p = panel {
            let want = max(96, min(640, CGFloat(truncating: h)))
            if abs(p.frame.height - want) > 1 { p.setFrame(frame(height: want), display: true, animate: false) }
        }
    }
}

let quickBar = QuickBar()

// Jarvis in its own window rather than a browser tab.
//
// A WKWebView, not Electron: the system already has a renderer, and shipping a
// second copy of Chromium to display a local page would cost more than the
// rest of the app put together.
//
// The data store is shared and persistent — see sharedStore above for why it
// stopped being non-persistent.
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

    // A turn handed over from the ask-bar. The window comes to the front on
    // /chat and the page is told to send it, so the question and its answer
    // land in the real transcript rather than in a panel that vanishes.
    //
    // The page may still be loading (first ever open), and evaluating into a
    // half-built React tree does nothing silently — so this retries briefly
    // rather than dropping the turn the owner just typed.
    func submit(payload json: String) {
        show(URL(string: "http://localhost:\(port())/chat")!)
        var tries = 0
        func attempt() {
            tries += 1
            web?.evaluateJavaScript("!!window.__jarvisSubmit && (window.__jarvisSubmit(\(json)), true)") { r, _ in
                if (r as? Bool) == true || tries > 40 { return }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { attempt() }
            }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { attempt() }
    }

    var isWindowVisible: Bool { window?.isVisible == true }

    // Step out of frame for the duration of a grab, then return to exactly the
    // stacking position held before — orderBack rather than orderFront, so a
    // dashboard that was BEHIND the app being captured does not jump in front
    // of it afterwards.
    func hideForCapture()     { window?.orderOut(nil) }
    func restoreAfterCapture() { window?.orderBack(nil) }

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
        cfg.websiteDataStore = sharedStore   // shared with the ask-bar panel
        cfg.mediaTypesRequiringUserActionForPlayback = []   // spoken replies autoplay
        let v = WKWebView(frame: .zero, configuration: cfg)
        v.uiDelegate = self
        // Since macOS 13.3 a WKWebView is invisible to Safari's Web Inspector
        // unless it opts in. Without this there is no way to see the app's
        // console or network at all — the dashboard can only be debugged in a
        // browser, which is exactly the situation where a bug that happens
        // ONLY in the app cannot be looked at. Local pages, local server.
        if #available(macOS 13.3, *) { v.isInspectable = true }
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
    // Consecutive failed health polls, and when the Mac last woke. Both feed
    // the "is the server really down" test in poll() — see the note there.
    var downPolls = 0
    var wokeAt = Date.distantPast
    // Held rather than assigned to item.menu — see applicationDidFinishLaunching.
    var barMenu: NSMenu?

    // Left click opens the ask-bar with the crosshair live. Right click (or
    // control-click, which is the same gesture on a trackpad) is the menu that
    // used to own every click: recording, mute, dashboard, quit.
    @objc func iconClicked() {
        let e = NSApp.currentEvent
        let wantsMenu = e?.type == .rightMouseUp
            || e?.modifierFlags.contains(.control) == true
        if wantsMenu {
            guard let menu = barMenu, let b = item.button else { return }
            menuNeedsUpdate(menu)
            // popUp, NOT item.menu + performClick. Assigning item.menu makes
            // the status item swallow clicks and open the menu itself — the
            // action never fires again. The reset that was supposed to undo
            // that was dispatched against the menu's own nested tracking loop,
            // so when it failed to stick, every later click opened the menu and
            // the ask-bar was unreachable until the app was restarted.
            // popUp touches no persistent state at all.
            menu.popUp(positioning: nil,
                       at: NSPoint(x: 0, y: b.bounds.height + 5),
                       in: b)
            return
        }
        dbg("iconClicked: left click -> show(capture: true)")
        quickBar.show(capture: true)
    }

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

    // A menu-bar app needs no menu bar of its own — until it opens a WINDOW.
    // Standard editing shortcuts on macOS are delivered as menu key
    // equivalents: with no main menu there is no Edit menu, so ⌘V, ⌘C, ⌘X and
    // ⌘A have nothing to dispatch to and the web view never hears them. The
    // items target nil so each one travels the responder chain and lands on
    // the WKWebView, which already implements every one of these selectors.
    func installMainMenu() {
        guard NSApp.mainMenu == nil else { return }
        let main = NSMenu()

        // The FIRST menu is always the application menu, whatever it is named.
        let appItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(NSMenuItem(title: "Hide Jarvis", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h"))
        appMenu.addItem(.separator())
        // NOT NSApp.terminate: quitting Jarvis stops its services and boots
        // the login job, and ⌘Q must do the same thing the status menu does.
        let quitItem = NSMenuItem(title: "Quit Jarvis (stops services)", action: #selector(quit), keyEquivalent: "q")
        quitItem.target = self
        appMenu.addItem(quitItem)
        appItem.submenu = appMenu
        main.addItem(appItem)

        let editItem = NSMenuItem()
        let edit = NSMenu(title: "Edit")
        let entries: [(String, Selector, String, NSEvent.ModifierFlags)] = [
            ("Undo", Selector(("undo:")), "z", [.command]),
            ("Redo", Selector(("redo:")), "z", [.command, .shift]),
            ("Cut", #selector(NSText.cut(_:)), "x", [.command]),
            ("Copy", #selector(NSText.copy(_:)), "c", [.command]),
            // The one this was all for: pasting a screenshot into the chat box.
            ("Paste", #selector(NSText.paste(_:)), "v", [.command]),
            ("Select All", #selector(NSText.selectAll(_:)), "a", [.command]),
        ]
        for (title, sel, key, mods) in entries {
            if title == "Cut" { edit.addItem(.separator()) }
            let mi = NSMenuItem(title: title, action: sel, keyEquivalent: key)
            mi.keyEquivalentModifierMask = mods
            edit.addItem(mi)                         // target nil → responder chain
        }
        editItem.submenu = edit
        main.addItem(editItem)

        let winItem = NSMenuItem()
        let win = NSMenu(title: "Window")
        win.addItem(NSMenuItem(title: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m"))
        win.addItem(NSMenuItem(title: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w"))
        winItem.submenu = win
        main.addItem(winItem)

        NSApp.mainMenu = main
    }

    func applicationDidFinishLaunching(_ n: Notification) {
        askForNotifications()
        installMainMenu()
        // The wake itself is the signal. Without it the first poll after a
        // Deep Idle fires into a loopback stack that has not come back yet,
        // and reads the timeout as a dead server.
        NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didWakeNotification, object: nil, queue: .main
        ) { [weak self] _ in
            self?.wokeAt = Date()
            self?.downPolls = 0
        }
        item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        let menu = NSMenu()
        menu.delegate = self
        // NOT item.menu — assigning a menu hands EVERY click to it, and the
        // left click is wanted for the ask-bar. The menu is popped by hand on
        // a right click instead, so nothing in it becomes unreachable.
        barMenu = menu
        if let b = item.button {
            b.target = self
            b.action = #selector(iconClicked)
            b.sendAction(on: [.leftMouseUp, .rightMouseUp])
        }
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
            // One missed poll is not a dead server. The health request times
            // out after 2.5s against a 3s timer, and on wake from sleep the
            // loopback stack is routinely slower than that — so a single miss
            // used to spawn a duplicate server (28 EADDRINUSE in api.log) and,
            // via services.sh, a browser tab. Ask three times before believing
            // it, and give a wake its own grace period on top.
            if self.serverUp {
                self.downPolls = 0
            } else if Date().timeIntervalSince(self.wokeAt) > 20 {
                self.downPolls += 1
            }
            if self.downPolls >= 3 && !self.startedServer && !jarvisDir.isEmpty {
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
