// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// make-icon.swift — renders JarvisBar's icon PNGs from the same SF Symbol the
// menu bar uses, so the Dock, the notification banner and the app icon cannot
// drift apart. install.sh runs this, then iconutil turns the set into .icns.
//
// The Dock icon is already drawn at runtime, but a notification banner takes
// its icon from the BUNDLE, not from NSApp.applicationIconImage — which is why
// alerts showed a generic grey placeholder while the Dock showed the brain.
import AppKit

let glyph = "brain.fill"
let out = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "."

func icon(_ side: CGFloat) -> NSImage? {
    let cfg = NSImage.SymbolConfiguration(pointSize: side * 0.5, weight: .regular)
        .applying(NSImage.SymbolConfiguration(paletteColors: [
            NSColor(calibratedRed: 0.36, green: 0.86, blue: 0.96, alpha: 1)]))
    guard let g = NSImage(systemSymbolName: glyph, accessibilityDescription: "Jarvis")?
        .withSymbolConfiguration(cfg) else { return nil }
    g.isTemplate = false

    let img = NSImage(size: NSSize(width: side, height: side))
    img.lockFocus()
    defer { img.unlockFocus() }
    let inset = side * 0.078
    let rect = NSRect(x: inset, y: inset, width: side - inset * 2, height: side - inset * 2)
    NSColor(calibratedRed: 0.04, green: 0.09, blue: 0.13, alpha: 1).setFill()
    NSBezierPath(roundedRect: rect, xRadius: side * 0.22, yRadius: side * 0.22).fill()

    let target = side * 0.58
    let s = min(target / g.size.width, target / g.size.height)
    let w = g.size.width * s, h = g.size.height * s
    g.draw(in: NSRect(x: (side - w) / 2, y: (side - h) / 2, width: w, height: h))
    return img
}

// the sizes iconutil expects in an .iconset
let sizes: [(String, CGFloat)] = [
    ("icon_16x16", 16), ("icon_16x16@2x", 32),
    ("icon_32x32", 32), ("icon_32x32@2x", 64),
    ("icon_128x128", 128), ("icon_128x128@2x", 256),
    ("icon_256x256", 256), ("icon_256x256@2x", 512),
    ("icon_512x512", 512), ("icon_512x512@2x", 1024),
]
for (name, px) in sizes {
    guard let i = icon(px), let tiff = i.tiffRepresentation,
          let rep = NSBitmapImageRep(data: tiff),
          let png = rep.representation(using: .png, properties: [:]) else {
        FileHandle.standardError.write("failed at \(name)\n".data(using: .utf8)!); exit(1)
    }
    try! png.write(to: URL(fileURLWithPath: "\(out)/\(name).png"))
}
print("wrote \(sizes.count) sizes to \(out)")
