import AVFoundation
import QuartzCore
import UIKit

/// The graphics drawn over the highlights, in the style of football on the telly:
///   - a score box in the top left (crest, the two teams, the score, which changes when the ball goes in, and the match
///     clock, ticking), drawn on every clip;
///   - a bar along the bottom saying what the moment is ("GOAL", the scorer, who set it up), sliding in just after it;
///   - Gaffer's mark in the top right;
///   - the end card: the result and the crest, then Gaffer's icon, its full name and "Download on the App Store".
/// Everything is Core Animation layers, which AVFoundation draws onto the video. The layers' origin is the bottom left,
/// so "up" is +y. Sizes are in `u`, 1% of the video's shorter side, so it looks the same on any footage.

/// The two teams and the team's colours and crest, for the score box.
struct ReelLook {
    let home: String
    let away: String
    let color: UIColor
    let ink: UIColor
    let crest: CGImage?
}

/// The score box for one clip: the match clock at the clip's first frame (seconds), the score then, and each goal in it
/// (seconds into the clip, and the score after it).
struct ReelBug {
    let clock: Double
    let us: Int
    let them: Int
    let changes: [(at: Double, us: Int, them: Int)]
}

/// The bar along the bottom for one clip: what it is ("GOAL"), who (the title) and a line under it, from `at` seconds in.
struct ReelLower {
    let at: Double
    let tag: String
    let title: String
    let sub: String
    let color: UIColor?
    let ink: UIColor?
    /// A goal put right after the clip was made (the wrong scorer pressed in the heat of the moment): the bar the clip
    /// already has, which this one is drawn over. It's made at least as big and solid, so none of the old one shows.
    var over: (tag: String, title: String, sub: String)? = nil
}

enum ReelGraphics {
    // MARK: - Reading what JS sent

    static func color(_ hex: String?, fallback: UIColor) -> UIColor {
        guard var value = hex?.trimmingCharacters(in: .whitespaces), !value.isEmpty else { return fallback }
        if value.hasPrefix("#") { value.removeFirst() }
        guard value.count == 6, let number = UInt32(value, radix: 16) else { return fallback }
        return UIColor(red: CGFloat((number >> 16) & 0xFF) / 255, green: CGFloat((number >> 8) & 0xFF) / 255, blue: CGFloat(number & 0xFF) / 255, alpha: 1)
    }

    /// A picture sent as a data: address (the team's crest).
    static func picture(_ value: Any?) -> CGImage? {
        guard let text = value as? String, text.hasPrefix("data:"), let comma = text.firstIndex(of: ",") else { return nil }
        guard let data = Data(base64Encoded: String(text[text.index(after: comma)...]), options: .ignoreUnknownCharacters) else { return nil }
        return UIImage(data: data)?.cgImage
    }

    static func look(_ value: Any?) -> ReelLook? {
        guard let raw = value as? [String: Any] else { return nil }
        let purple = UIColor(red: 0.36, green: 0.16, blue: 0.53, alpha: 1)
        return ReelLook(home: (raw["home"] as? String ?? "").uppercased(), away: (raw["away"] as? String ?? "").uppercased(),
                        color: color(raw["color"] as? String, fallback: purple), ink: color(raw["ink"] as? String, fallback: .white),
                        crest: picture(raw["crest"]))
    }

    static func bug(_ value: Any?) -> ReelBug? {
        guard let raw = value as? [String: Any], let clock = (raw["clock"] as? NSNumber)?.doubleValue, clock.isFinite else { return nil }
        let changes: [(at: Double, us: Int, them: Int)] = ((raw["changes"] as? [[String: Any]]) ?? []).compactMap { c in
            guard let at = (c["at"] as? NSNumber)?.doubleValue, at.isFinite else { return nil }
            return (at: at, us: (c["us"] as? NSNumber)?.intValue ?? 0, them: (c["them"] as? NSNumber)?.intValue ?? 0)
        }
        return ReelBug(clock: max(0, clock), us: (raw["us"] as? NSNumber)?.intValue ?? 0, them: (raw["them"] as? NSNumber)?.intValue ?? 0,
                       changes: changes.sorted { $0.at < $1.at })
    }

    static func lower(_ value: Any?) -> ReelLower? {
        guard let raw = value as? [String: Any] else { return nil }
        let title = raw["title"] as? String ?? "", tag = raw["tag"] as? String ?? ""
        guard !title.isEmpty || !tag.isEmpty else { return nil }
        var bar = ReelLower(at: (raw["at"] as? NSNumber)?.doubleValue ?? 0, tag: tag.uppercased(), title: title, sub: raw["sub"] as? String ?? "",
                            color: (raw["color"] as? String).map { color($0, fallback: .darkGray) }, ink: (raw["ink"] as? String).map { color($0, fallback: .white) })
        if let old = raw["over"] as? [String: Any] {
            bar.over = (tag: (old["tag"] as? String ?? "").uppercased(), title: old["title"] as? String ?? "", sub: old["sub"] as? String ?? "")
        }
        return bar
    }

    // MARK: - Pieces

    /// One line of text, sized to fit it.
    static func line(_ text: String, font: UIFont, color: UIColor, kern: CGFloat = 0) -> CATextLayer {
        let string = NSAttributedString(string: text, attributes: [.font: font, .foregroundColor: color, .kern: kern])
        let size = string.size()
        let layer = CATextLayer()
        layer.string = string
        layer.contentsScale = 1
        layer.alignmentMode = .left
        layer.frame = CGRect(x: 0, y: 0, width: ceil(size.width) + 2, height: ceil(size.height) + 1)
        return layer
    }

    /// Text that wraps within `maxWidth`, centred or from the left.
    static func block(_ text: String, font: UIFont, color: UIColor, maxWidth: CGFloat, centred: Bool) -> CATextLayer {
        let paragraph = NSMutableParagraphStyle()
        paragraph.alignment = centred ? .center : .left
        paragraph.lineBreakMode = .byWordWrapping
        let string = NSAttributedString(string: text, attributes: [.font: font, .foregroundColor: color, .paragraphStyle: paragraph])
        let bounds = string.boundingRect(with: CGSize(width: maxWidth, height: .greatestFiniteMagnitude), options: [.usesLineFragmentOrigin, .usesFontLeading], context: nil)
        let layer = CATextLayer()
        layer.string = string
        layer.isWrapped = true
        layer.alignmentMode = centred ? .center : .left
        layer.contentsScale = 1
        layer.frame = CGRect(x: 0, y: 0, width: centred ? maxWidth : min(maxWidth, ceil(bounds.width) + 2), height: ceil(bounds.height) + 2)
        return layer
    }

    static func width(_ text: String, _ font: UIFont, kern: CGFloat = 0) -> CGFloat {
        ceil(NSAttributedString(string: text, attributes: [.font: font, .kern: kern]).size().width)
    }

    /// Puts `layer` in the middle of `box` (its own coordinates).
    static func centre(_ layer: CALayer, in box: CGRect) {
        layer.frame.origin = CGPoint(x: box.minX + (box.width - layer.frame.width) / 2, y: box.minY + (box.height - layer.frame.height) / 2)
    }

    static func picture(_ image: CGImage, frame: CGRect, radius: CGFloat = 0) -> CALayer {
        let layer = CALayer()
        layer.contents = image
        layer.contentsGravity = .resizeAspect
        layer.frame = frame
        if radius > 0 { layer.cornerRadius = radius; layer.masksToBounds = true }
        return layer
    }

    /// Gaffer's own icon, from the web app's files bundled in the iPhone app.
    static let appIcon: CGImage? = {
        for name in ["icon-512", "icon-192"] {
            if let url = Bundle.main.url(forResource: name, withExtension: "png", subdirectory: "public/icons"),
               let image = UIImage(contentsOfFile: url.path)?.cgImage { return image }
        }
        return nil
    }()

    /// The Apple logo, white, from the phone's own symbols.
    static func appleLogo(side: CGFloat) -> CGImage? {
        guard side >= 2, let symbol = UIImage(systemName: "apple.logo", withConfiguration: UIImage.SymbolConfiguration(pointSize: side, weight: .regular)) else { return nil }
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = false
        let canvas = CGSize(width: ceil(side), height: ceil(side))
        return UIGraphicsImageRenderer(size: canvas, format: format).image { _ in
            let tinted = symbol.withTintColor(.white, renderingMode: .alwaysOriginal)
            let k = min(canvas.width / max(1, tinted.size.width), canvas.height / max(1, tinted.size.height))
            let w = tinted.size.width * k, h = tinted.size.height * k
            tinted.draw(in: CGRect(x: (canvas.width - w) / 2, y: (canvas.height - h) / 2, width: w, height: h))
        }.cgImage
    }

    static func darker(_ color: UIColor, by amount: CGFloat) -> UIColor {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        guard color.getRed(&r, green: &g, blue: &b, alpha: &a) else { return color }
        return UIColor(red: r * amount, green: g * amount, blue: b * amount, alpha: 1)
    }

    // MARK: - Timing (seconds into the video)

    /// Shown only from `from` to `to`, switching on and off at once (the clock's digits, the score).
    static func during(_ layer: CALayer, from: Double, to: Double) {
        layer.opacity = 0
        let on = CABasicAnimation(keyPath: "opacity")
        on.fromValue = 1
        on.toValue = 1
        on.beginTime = AVCoreAnimationBeginTimeAtZero + max(0, from)
        on.duration = max(0.01, to - from)
        on.isRemovedOnCompletion = false
        layer.add(on, forKey: "during")
    }

    /// A quick swell, for the score when it changes.
    static func pop(_ layer: CALayer, at: Double) {
        let swell = CAKeyframeAnimation(keyPath: "transform.scale")
        swell.values = [1, 1.28, 1]
        swell.keyTimes = [0, 0.35, 1]
        swell.duration = 0.7
        swell.beginTime = AVCoreAnimationBeginTimeAtZero + max(0, at)
        swell.isRemovedOnCompletion = false
        layer.add(swell, forKey: "pop-\(at)")
    }

    /// Slides in from `dx` to the left (and `dy` below) while fading in, starting at `at`; hidden until then.
    static func arrive(_ layer: CALayer, at: Double, dx: CGFloat = 0, dy: CGFloat = 0, duration: Double = 0.4) {
        let fade = CABasicAnimation(keyPath: "opacity")
        fade.fromValue = 0
        fade.toValue = 1
        fade.beginTime = AVCoreAnimationBeginTimeAtZero + max(0, at)
        fade.duration = duration * 0.6
        fade.fillMode = .backwards
        fade.isRemovedOnCompletion = false
        layer.add(fade, forKey: "arrive-fade")
        let move = CABasicAnimation(keyPath: "position")
        move.fromValue = NSValue(cgPoint: CGPoint(x: layer.position.x - dx, y: layer.position.y - dy))
        move.toValue = NSValue(cgPoint: layer.position)
        move.beginTime = fade.beginTime
        move.duration = duration
        move.timingFunction = CAMediaTimingFunction(controlPoints: 0.2, 0.9, 0.2, 1)
        move.fillMode = .backwards
        move.isRemovedOnCompletion = false
        layer.add(move, forKey: "arrive-move")
    }

    // MARK: - The score box

    /// From `from` for `dur` seconds of the video.
    static func scoreBug(_ bug: ReelBug, look: ReelLook, from: Double, dur: Double, u: CGFloat, size: CGSize, margin: CGFloat) -> CALayer {
        let h = u * 7
        let nameFont = UIFont.systemFont(ofSize: u * 3.3, weight: .heavy)
        let scoreFont = UIFont.monospacedDigitSystemFont(ofSize: u * 3.8, weight: .heavy)
        let clockFont = UIFont.monospacedDigitSystemFont(ofSize: u * 3.3, weight: .bold)
        let pad = u * 1.8
        let bar = CALayer()
        bar.backgroundColor = UIColor(white: 0.05, alpha: 0.88).cgColor
        bar.cornerRadius = u * 1.3
        bar.masksToBounds = true
        var x: CGFloat = 0

        // the crest on the team's colour, or a stripe of it
        let lead = CALayer()
        lead.backgroundColor = look.color.cgColor
        if let crest = look.crest {
            lead.frame = CGRect(x: 0, y: 0, width: h, height: h)
            lead.addSublayer(picture(crest, frame: lead.bounds.insetBy(dx: u * 0.9, dy: u * 0.9)))
        } else {
            lead.frame = CGRect(x: 0, y: 0, width: u * 1.1, height: h)
        }
        bar.addSublayer(lead)
        x = lead.frame.width

        func name(_ text: String) {
            let words = line(text, font: nameFont, color: .white, kern: u * 0.12)
            let w = words.frame.width + pad * 2
            centre(words, in: CGRect(x: x, y: 0, width: w, height: h))
            bar.addSublayer(words)
            x += w
        }
        name(look.home)

        // the score, in the team's colour, changing as the goals go in
        let scoreW = width("88 – 88", scoreFont) + pad * 1.6
        let scoreBox = CALayer()
        scoreBox.frame = CGRect(x: x, y: 0, width: scoreW, height: h)
        scoreBox.backgroundColor = look.color.cgColor
        bar.addSublayer(scoreBox)
        x += scoreW
        var states: [(at: Double, text: String)] = [(at: 0, text: "\(bug.us) – \(bug.them)")]
        for change in bug.changes where change.at < dur { states.append((at: max(0, change.at), text: "\(change.us) – \(change.them)")) }
        for (i, state) in states.enumerated() {
            let end = i + 1 < states.count ? states[i + 1].at : dur
            guard end > state.at else { continue }
            let digits = line(state.text, font: scoreFont, color: look.ink)
            centre(digits, in: scoreBox.bounds)
            scoreBox.addSublayer(digits)
            during(digits, from: from + state.at, to: from + end)
            if i > 0 { pop(digits, at: from + state.at) }
        }

        name(look.away)

        // the match clock, a second at a time
        let clockW = width("188:88", clockFont) + pad * 2
        let clockBox = CALayer()
        clockBox.frame = CGRect(x: x, y: 0, width: clockW, height: h)
        clockBox.backgroundColor = UIColor(white: 1, alpha: 0.94).cgColor
        bar.addSublayer(clockBox)
        x += clockW
        var t = 0.0, value = floor(bug.clock), count = 0
        while t < dur && count < 600 {
            let next = min(dur, value + 1 - bug.clock)
            let seconds = Int(value)
            let digits = line(String(format: "%d:%02d", seconds / 60, seconds % 60), font: clockFont, color: UIColor(white: 0.08, alpha: 1))
            centre(digits, in: clockBox.bounds)
            clockBox.addSublayer(digits)
            during(digits, from: from + t, to: from + next)
            t = next
            value += 1
            count += 1
        }

        bar.frame = CGRect(x: margin, y: size.height - margin - h, width: x, height: h)
        during(bar, from: from, to: from + dur)
        return bar
    }

    // MARK: - The bar along the bottom

    /// The bar's text and how big it comes out: the tag's box, the panel beside it and the height.
    static func barParts(tag tagText: String, title titleText: String, sub subText: String, ink: UIColor, u: CGFloat, size: CGSize, margin: CGFloat)
        -> (tag: CATextLayer, title: CATextLayer, sub: CATextLayer?, textH: CGFloat, tagW: CGFloat, panelW: CGFloat, height: CGFloat) {
        let padX = u * 2.2, padY = u * 1.5, gap = u * 0.3
        let tag = line(tagText, font: UIFont.systemFont(ofSize: u * 3.2, weight: .black), color: ink, kern: u * 0.25)
        let room = max(u * 20, size.width - margin * 2 - tag.frame.width - padX * 4)
        let title = block(titleText, font: UIFont.systemFont(ofSize: u * 4.6, weight: .heavy), color: .white, maxWidth: room, centred: false)
        let sub = subText.isEmpty ? nil : block(subText, font: UIFont.systemFont(ofSize: u * 2.9, weight: .semibold), color: UIColor(white: 1, alpha: 0.78), maxWidth: room, centred: false)
        let textH = title.frame.height + (sub.map { gap + $0.frame.height } ?? 0)
        let height = max(u * 9, textH + padY * 2)
        let tagW = tagText.isEmpty ? u * 1.2 : tag.frame.width + padX * 2
        let panelW = max(title.frame.width, sub?.frame.width ?? 0) + padX * 2
        return (tag, title, sub, textH, tagW, panelW, height)
    }

    static func lowerThird(_ lower: ReelLower, look: ReelLook?, from: Double, dur: Double, u: CGFloat, size: CGSize, margin: CGFloat) -> CALayer {
        let accent = lower.color ?? look?.color ?? UIColor(red: 0.36, green: 0.16, blue: 0.53, alpha: 1)
        let accentInk = lower.ink ?? look?.ink ?? .white
        let padX = u * 2.2, gap = u * 0.3
        let parts = barParts(tag: lower.tag, title: lower.title, sub: lower.sub, ink: accentInk, u: u, size: size, margin: margin)
        let tag = parts.tag, title = parts.title, sub = parts.sub, textH = parts.textH, tagW = parts.tagW
        var height = parts.height, panelW = parts.panelW
        if let old = lower.over { // drawn over the old bar: at least as tall and as long (with a little to spare), and solid
            let was = barParts(tag: old.tag, title: old.title, sub: old.sub, ink: accentInk, u: u, size: size, margin: margin)
            height = max(height, was.height + u * 0.4)
            panelW = max(panelW, was.tagW + was.panelW + u * 1.5 - tagW)
        }

        let group = CALayer()
        group.frame = CGRect(x: margin, y: margin, width: tagW + panelW, height: height)
        group.cornerRadius = u * 1.3
        group.masksToBounds = true
        let tagBox = CALayer()
        tagBox.frame = CGRect(x: 0, y: 0, width: tagW, height: height)
        tagBox.backgroundColor = accent.cgColor
        if !lower.tag.isEmpty { centre(tag, in: tagBox.bounds); tagBox.addSublayer(tag) }
        group.addSublayer(tagBox)
        let panel = CALayer()
        panel.frame = CGRect(x: tagW, y: 0, width: panelW, height: height)
        panel.backgroundColor = UIColor(white: 0.05, alpha: lower.over == nil ? 0.88 : 1).cgColor
        let top = (height + textH) / 2 // the text block, centred up and down
        title.frame.origin = CGPoint(x: padX, y: top - title.frame.height)
        panel.addSublayer(title)
        if let sub = sub { sub.frame.origin = CGPoint(x: padX, y: top - title.frame.height - gap - sub.frame.height); panel.addSublayer(sub) }
        group.addSublayer(panel)

        // in just after the moment, until the clip ends
        let at = lower.at < dur - 1.5 ? max(0, lower.at) + 0.2 : max(0, dur - 3)
        let holder = CALayer() // (shown and hidden by the holder, slid in by the group, so the two animations don't fight)
        holder.frame = CGRect(origin: .zero, size: size)
        holder.addSublayer(group)
        during(holder, from: from + at, to: from + dur)
        arrive(group, at: from + at, dx: group.frame.maxX + u * 2, duration: 0.45)
        return holder
    }

    // MARK: - Gaffer's mark

    static func brand(_ text: String, u: CGFloat, size: CGSize, margin: CGFloat) -> CALayer {
        let h = u * 5.4, inset = u * 0.8, pad = u * 1.5
        let words = line(text.uppercased(), font: UIFont.systemFont(ofSize: u * 2.8, weight: .black), color: .white, kern: u * 0.3)
        let box = CALayer()
        box.backgroundColor = UIColor(white: 0, alpha: 0.5).cgColor
        box.cornerRadius = h / 2
        var x = pad
        if let icon = appIcon {
            let side = h - inset * 2
            box.addSublayer(picture(icon, frame: CGRect(x: inset, y: inset, width: side, height: side), radius: side * 0.24))
            x = inset + side + u * 1.0
        }
        centre(words, in: CGRect(x: x, y: 0, width: words.frame.width, height: h))
        box.addSublayer(words)
        let w = x + words.frame.width + pad
        box.frame = CGRect(x: size.width - margin - w, y: size.height - margin - h, width: w, height: h)
        box.opacity = 0.92
        return box
    }

    // MARK: - The end card

    /// "Download on the App Store", drawn the way Apple's badge looks.
    static func storeBadge(u: CGFloat) -> CALayer {
        let h = u * 8.6, padX = u * 2.2, gap = u * 1.2, logoSide = u * 4.8
        let small = line("Download on the", font: UIFont.systemFont(ofSize: u * 1.9, weight: .medium), color: .white)
        let big = line("App Store", font: UIFont.systemFont(ofSize: u * 3.8, weight: .semibold), color: .white, kern: -u * 0.06)
        let textW = max(small.frame.width, big.frame.width)
        let box = CALayer()
        box.frame = CGRect(x: 0, y: 0, width: padX + logoSide + gap + textW + padX, height: h)
        box.backgroundColor = UIColor.black.cgColor
        box.cornerRadius = u * 1.7
        box.borderColor = UIColor(white: 0.65, alpha: 1).cgColor
        box.borderWidth = max(1, u * 0.18)
        if let logo = appleLogo(side: logoSide) {
            box.addSublayer(picture(logo, frame: CGRect(x: padX, y: (h - logoSide) / 2 + u * 0.15, width: logoSide, height: logoSide)))
        }
        let overlap = u * 0.7
        let blockH = small.frame.height + big.frame.height - overlap
        let bottom = (h - blockH) / 2
        big.frame.origin = CGPoint(x: padX + logoSide + gap, y: bottom)
        small.frame.origin = CGPoint(x: padX + logoSide + gap + u * 0.1, y: bottom + big.frame.height - overlap)
        box.addSublayer(big)
        box.addSublayer(small)
        return box
    }

    /// The whole end card, shown from `at`: { kicker?, sponsor?, title, sub, color, ink, crest? } from JS. `sponsor` is the
    /// "presented by" name under the kicker (Goal of the Week); none, no line.
    static func endCard(_ outro: [String: Any], at: Double, u base: CGFloat, size: CGSize, margin: CGFloat) -> CALayer {
        let background = color(outro["color"] as? String, fallback: UIColor(red: 0.36, green: 0.16, blue: 0.53, alpha: 1))
        let ink = color(outro["ink"] as? String, fallback: .white)
        let crest = picture(outro["crest"])
        let kicker = (outro["kicker"] as? String ?? "Highlights").uppercased()
        let sponsor = (outro["sponsor"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let card = CALayer()
        card.frame = CGRect(origin: .zero, size: size)
        card.masksToBounds = true

        let wash = CAGradientLayer()
        wash.frame = card.bounds
        wash.colors = [background.cgColor, darker(background, by: 0.32).cgColor]
        wash.startPoint = CGPoint(x: 0, y: 1)
        wash.endPoint = CGPoint(x: 1, y: 0)
        card.addSublayer(wash)

        // faint pitch markings: the halfway line and the centre circle
        let lines = CAShapeLayer()
        let path = UIBezierPath()
        let radius = min(size.width, size.height) * 0.34
        path.append(UIBezierPath(ovalIn: CGRect(x: size.width / 2 - radius, y: size.height / 2 - radius, width: radius * 2, height: radius * 2)))
        path.move(to: CGPoint(x: 0, y: size.height / 2))
        path.addLine(to: CGPoint(x: size.width, y: size.height / 2))
        lines.path = path.cgPath
        lines.fillColor = UIColor.clear.cgColor
        lines.strokeColor = ink.withAlphaComponent(0.07).cgColor
        lines.lineWidth = base * 0.5
        card.addSublayer(lines)

        // the stack of things on it, shrunk until it fits
        var u = base
        var items: [(layer: CALayer, gap: CGFloat)] = []
        for _ in 0..<5 {
            items = []
            func add(_ layer: CALayer, _ gap: CGFloat) { items.append((layer: layer, gap: gap)) }
            let width = size.width - margin * 2
            if let crest = crest { add(picture(crest, frame: CGRect(x: 0, y: 0, width: u * 15, height: u * 15)), u * 2.4) }
            add(line(kicker, font: UIFont.systemFont(ofSize: u * 2.6, weight: .heavy), color: ink.withAlphaComponent(0.75), kern: u * 0.45), u * 1.0)
            if !sponsor.isEmpty { add(line("PRESENTED BY " + sponsor.uppercased(), font: UIFont.systemFont(ofSize: u * 2.0, weight: .bold), color: ink.withAlphaComponent(0.6), kern: u * 0.3), u * 1.4) }
            add(block(outro["title"] as? String ?? "", font: UIFont.systemFont(ofSize: u * 6.6, weight: .black), color: ink, maxWidth: width, centred: true), u * 1.0)
            let sub = outro["sub"] as? String ?? ""
            if !sub.isEmpty { add(block(sub, font: UIFont.systemFont(ofSize: u * 3.1, weight: .semibold), color: ink.withAlphaComponent(0.8), maxWidth: width, centred: true), 0) }
            items[items.count - 1].gap = u * 4
            let rule = CALayer()
            rule.frame = CGRect(x: 0, y: 0, width: u * 22, height: max(1, u * 0.3))
            rule.backgroundColor = ink.withAlphaComponent(0.3).cgColor
            add(rule, u * 4)
            if let icon = appIcon { add(picture(icon, frame: CGRect(x: 0, y: 0, width: u * 12, height: u * 12), radius: u * 2.7), u * 1.8) }
            add(block(outro["app"] as? String ?? "Gaffer: Small-Sided Football", font: UIFont.systemFont(ofSize: u * 3.4, weight: .heavy), color: ink, maxWidth: width, centred: true), u * 2.2)
            add(storeBadge(u: u), 0)
            let total = items.reduce(CGFloat(0)) { $0 + $1.layer.frame.height + $1.gap }
            if total <= size.height - margin * 2 { break }
            u *= max(0.6, (size.height - margin * 2) / total * 0.97)
        }
        let total = items.reduce(CGFloat(0)) { $0 + $1.layer.frame.height + $1.gap }
        var top = (size.height + total) / 2
        for (i, item) in items.enumerated() {
            let layer = item.layer
            layer.frame.origin = CGPoint(x: (size.width - layer.frame.width) / 2, y: top - layer.frame.height)
            top -= layer.frame.height + item.gap
            card.addSublayer(layer)
            arrive(layer, at: at + 0.15 + Double(i) * 0.09, dy: u * 3, duration: 0.5)
        }
        return card
    }
}
