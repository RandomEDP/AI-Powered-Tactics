import AVFoundation
import Capacitor
import CoreGraphics
import CoreImage
import Foundation
import OnnxRuntimeBindings
import UIKit

/// Highlights made vertical (9:16) for Reels and TikTok, all on the phone (Ethan, November 2026: "a way to one exporting
/// highlights in vertical phone mode all on device"). Nothing is uploaded or sent anywhere.
///
/// 1. Look: a few times a second the phone looks at the picture. The player detector already in the app (YOLOX-S, the one
///    player tracking uses) finds the players and, when it can see it clearly, the ball; and the picture is compared with
///    the last look to see where things are moving. FollowPath works out where a tall frame should sit to keep the play in
///    it, smoothed into a steady pan, jumping only where one clip ends and the next begins.
/// 2. Tall: every frame is cut to that tall window at full height (1080×1920, or 720×1280 from smaller footage). The clips
///    already have the score box, the bar and Gaffer's mark drawn on them for a wide screen, so the strips along the top
///    and bottom where those sit are softly blurred.
/// 3. Graphics: the score box, the bar and the mark are drawn again for a tall screen (export, as for any clip), and the end
///    card is drawn tall over the wide one. The video's own sound (and any commentary in it) is kept as it is.
extension ReelCutterPlugin {
    @objc public func verticalVideo(_ call: CAPPluginCall) {
        let link = call.getString("url") ?? "", path = call.getString("path") ?? ""
        guard !link.isEmpty || !path.isEmpty else { call.reject("There's no video to make vertical"); return }
        let name = (call.getString("file") ?? "gaffer-vertical.mp4").replacingOccurrences(of: "/", with: "-")
        let tag = call.getString("job") ?? ""
        let aim = FollowAim(rawValue: call.getString("aim") ?? "auto") ?? .auto
        let rawSpans = (call.options["spans"] as? [[String: Any]]) ?? []
        let outro = call.options["outro"] as? [String: Any]
        let outroAt = (call.options["outroAt"] as? NSNumber)?.doubleValue
        let blurBands = call.getBool("bands") ?? true
        var spare: UIBackgroundTaskIdentifier = .invalid
        let begin = { spare = UIApplication.shared.beginBackgroundTask(withName: "Making a vertical video") { UIApplication.shared.endBackgroundTask(spare) } }
        if Thread.isMainThread { begin() } else { DispatchQueue.main.sync(execute: begin) }
        let finished = { DispatchQueue.main.async { if spare != .invalid { UIApplication.shared.endBackgroundTask(spare); spare = .invalid } } }
        queue.async {
            defer { finished(); self.stopNow = nil; self.stopForget(tag) }
            self.stopNow = { self.stopAsked(tag) }
            var job: URL?
            func say(_ stage: String, _ p: Double) { self.notifyListeners("progress", data: ["stage": stage, "i": 0, "n": 1, "p": p, "job": tag]) }
            do {
                try self.checkStop()
                let dir = try WorkFolders.fresh("vertical", in: self.ensureWorkDir())
                job = dir
                var local = URL(fileURLWithPath: path)
                if path.isEmpty {
                    guard link.hasPrefix("http"), let remote = URL(string: link) else { throw CutError(message: "That video's address isn't right.") }
                    local = dir.appendingPathComponent("wide.mp4")
                    try self.fetch(remote, to: local, wait: 1800) { p in say("fetch", p) }
                }
                let source = AVURLAsset(url: local)
                guard let track = source.tracks(withMediaType: .video).first else { throw CutError(message: ReelCutterPlugin.unreadable) }
                let total = CMTimeGetSeconds(source.duration)
                guard total.isFinite, total > 0.5 else { throw CutError(message: ReelCutterPlugin.unreadable) }

                // what's in each clip, and where the clips join
                let spans: [VerticalSpan] = rawSpans.compactMap { VerticalSpan($0) }.filter { $0.at < total }.sorted { $0.at < $1.at }
                let cuts = spans.map { $0.at }.filter { $0 > 0.05 } + (outroAt.map { [$0] } ?? [])
                let moments = spans.compactMap { s in s.lower.map { s.at + $0.at } }

                // 1. look
                let box = ReelCutterPlugin.upright(track)
                let width = Double(abs(box.width)), height = Double(abs(box.height))
                let window = FollowPath.window(width: width, height: height)
                var route: [FollowPoint] = []
                if window < 0.98 {
                    let lookUntil = min(total, outroAt ?? total) // (nothing to follow on the end card)
                    let samples = try VerticalLook.samples(source, until: lookUntil, step: FollowPath.step(for: lookUntil), aim: aim, stop: { self.stopNow?() == true }) { p in say("look", p) }
                    route = FollowPath.plan(samples, window: window, cuts: cuts, moments: moments, aim: aim)
                }
                try self.checkStop()

                // 2. tall
                let tallFile = dir.appendingPathComponent("tall.mp4")
                let small = height < 900
                let frame = small ? CGRect(x: 0, y: 0, width: 720, height: 1280) : CGRect(x: 0, y: 0, width: 1080, height: 1920)
                try self.verticalPass(source, path: route, window: window, cuts: cuts, bands: blurBands, frame: frame, to: tallFile) { p in say("tall", p) }
                try self.checkStop()

                // 3. graphics, drawn for a tall screen, and the end card
                let made = AVURLAsset(url: tallFile)
                let length = CMTimeGetSeconds(made.duration)
                guard length.isFinite, length > 0.5 else { throw CutError(message: ReelCutterPlugin.unreadable) }
                var segments: [Segment] = []
                var cursor = 0.0
                let cardAt = outro != nil ? outroAt.flatMap { (v: Double) -> Double? in v > 1 && v < length - 1 ? v : nil } : nil
                let stopAt = cardAt ?? length
                func plain(_ from: Double, _ to: Double) {
                    if to - from > 0.04 { segments.append(Segment(asset: made, start: from, dur: to - from, caption: "", voiced: true)) }
                }
                for (i, span) in spans.enumerated() where span.at < stopAt - 0.5 {
                    let from = i == 0 && span.at < 1 ? 0 : span.at // (a reel's first clip starts it)
                    let next = i + 1 < spans.count ? min(spans[i + 1].at, stopAt) : stopAt
                    plain(cursor, from)
                    let lead = span.at - from
                    segments.append(Segment(asset: made, start: from, dur: next - from, caption: "", voiced: true,
                                            bug: span.bug.map { $0.shifted(by: lead) }, lower: span.lower.map { $0.shifted(by: lead) }, look: span.look))
                    cursor = next
                }
                plain(cursor, stopAt)
                if let cardAt = cardAt { segments.append(Segment(asset: made, start: cardAt, dur: length - cardAt, caption: "", voiced: true)) }
                // export wants each stretch a second or more: a sliver is joined onto the stretch before it
                var joined: [Segment] = []
                for s in segments {
                    if s.dur < 1.0, let last = joined.last, abs(last.start + last.dur - s.start) < 0.01 {
                        joined[joined.count - 1] = Segment(asset: made, start: last.start, dur: last.dur + s.dur, caption: "", voiced: true, bug: last.bug, lower: last.lower, look: last.look)
                    } else { joined.append(s) }
                }
                if joined.count > 1, joined[0].dur < 1.0 { // (a sliver at the very start goes onto the stretch after it)
                    let a = joined[0], b = joined[1], lead = b.start - a.start
                    joined[1] = Segment(asset: made, start: a.start, dur: a.dur + b.dur, caption: "", voiced: true,
                                        bug: b.bug.map { $0.shifted(by: lead) }, lower: b.lower.map { $0.shifted(by: lead) }, look: b.look)
                    joined.removeFirst()
                }
                if joined.isEmpty { joined = [Segment(asset: made, start: 0, dur: length, caption: "", voiced: true)] }
                let out = dir.appendingPathComponent(name.hasSuffix(".mp4") ? name : name + ".mp4")
                try self.export(segments: joined, watermark: "Gaffer", outro: cardAt == nil ? nil : outro, to: out,
                                outroOver: cardAt.map { length - $0 }, preset: AVAssetExportPresetHighestQuality) { p in say("card", p) }
                self.shrink(out, bitRate: small ? 4_000_000 : 7_000_000)
                WorkFolders.tidy(dir, keeping: [out])
                call.resolve(["path": out.path, "size": self.fileSize(out)])
            } catch {
                if let job = job { try? FileManager.default.removeItem(at: job) }
                call.reject(error.localizedDescription)
            }
        }
    }

    /// Every frame cut to the tall window where the path says, at full height, with the old graphics' strips blurred.
    func verticalPass(_ source: AVAsset, path: [FollowPoint], window: Double, cuts: [Double], bands: Bool, frame: CGRect, to out: URL,
                      progress: @escaping (Double) -> Void) throws {
        guard let track = source.tracks(withMediaType: .video).first else { throw CutError(message: ReelCutterPlugin.unreadable) }
        let composition = AVMutableComposition()
        guard let video = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid) else {
            throw CutError(message: "Couldn't set up the video")
        }
        let range = CMTimeRange(start: .zero, duration: source.duration)
        try video.insertTimeRange(range, of: track, at: .zero)
        video.preferredTransform = track.preferredTransform
        if let sound = source.tracks(withMediaType: .audio).first, let audio = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) {
            try? audio.insertTimeRange(range, of: sound, at: .zero)
        }
        let mask = bands ? VerticalLook.bandMask(frame) : nil
        let videoComposition = AVMutableVideoComposition(asset: composition) { request in
            let t = CMTimeGetSeconds(request.compositionTime)
            let x = FollowPath.centre(at: t, in: path, window: window, cuts: cuts)
            request.finish(with: VerticalLook.draw(request.sourceImage, centre: x, in: frame, mask: mask), context: nil)
        }
        videoComposition.renderSize = frame.size
        videoComposition.frameDuration = CMTime(value: 1, timescale: 30)
        videoComposition.colorPrimaries = AVVideoColorPrimaries_ITU_R_709_2
        videoComposition.colorTransferFunction = AVVideoTransferFunction_ITU_R_709_2
        videoComposition.colorYCbCrMatrix = AVVideoYCbCrMatrix_ITU_R_709_2
        try? FileManager.default.removeItem(at: out)
        guard let session = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetHighestQuality) else {
            throw CutError(message: "This phone can't export that video")
        }
        session.videoComposition = videoComposition
        session.outputURL = out
        session.outputFileType = .mp4
        session.shouldOptimizeForNetworkUse = true
        try run(session, progress: progress)
    }
}

/// One clip in the video being made vertical: where it starts, and its score box and bar (as JS works them out for the
/// clips, clipLook in index.html), with its own teams and colours.
struct VerticalSpan {
    let at: Double
    let bug: ReelBug?
    let lower: ReelLower?
    let look: ReelLook?

    init?(_ raw: [String: Any]) {
        guard let at = (raw["at"] as? NSNumber)?.doubleValue, at.isFinite, at >= 0 else { return nil }
        self.at = at
        look = ReelGraphics.look(raw["look"])
        bug = look == nil ? nil : ReelGraphics.bug(raw["bug"])
        lower = ReelGraphics.lower(raw["lower"])
    }
}

extension ReelBug {
    /// The same score box for a stretch starting `lead` seconds earlier (the clock starts that much sooner).
    func shifted(by lead: Double) -> ReelBug {
        guard lead > 0.001 else { return self }
        return ReelBug(clock: max(0, clock - lead), us: us, them: them, changes: changes.map { (at: $0.at + lead, us: $0.us, them: $0.them) })
    }
}

extension ReelLower {
    func shifted(by lead: Double) -> ReelLower {
        guard lead > 0.001 else { return self }
        var bar = ReelLower(at: at + lead, tag: tag, title: title, sub: sub, color: color, ink: ink)
        bar.over = over
        return bar
    }
}

/// Looking at the picture (players, the ball, movement) and drawing the tall frame.
enum VerticalLook {
    /// Looks at the video every `step` seconds up to `until`. With a fixed aim there's nothing to look for.
    static func samples(_ asset: AVAsset, until: Double, step: Double, aim: FollowAim, stop: () -> Bool, progress: (Double) -> Void) throws -> [FollowSample] {
        var times: [Double] = []
        var t = 0.0
        while t < until { times.append(t); t += step }
        if aim != .auto { return times.map { FollowSample(t: $0) } }
        let reader = AVAssetImageGenerator(asset: asset)
        reader.appliesPreferredTrackTransform = true
        reader.maximumSize = CGSize(width: 640, height: 640)
        let tolerance = CMTime(seconds: min(0.1, step / 2), preferredTimescale: 600)
        reader.requestedTimeToleranceBefore = tolerance
        reader.requestedTimeToleranceAfter = tolerance
        let spotter = Spotter()
        var out: [FollowSample] = []
        var before: [Double]? = nil
        for (i, at) in times.enumerated() {
            if stop() { throw StopAsked() }
            if i % 10 == 0 { progress(Double(i) / Double(max(1, times.count))) }
            guard let image = try? reader.copyCGImage(at: CMTime(seconds: at, preferredTimescale: 600), actualTime: nil) else { continue }
            var sample = FollowSample(t: at)
            let found = spotter.look(image)
            sample.people = found.people
            sample.balls = found.balls
            let grey = greys(image)
            if let before = before, before.count == grey.count { sample.motion = movement(before, grey) }
            before = grey
            out.append(sample)
        }
        progress(1)
        return out
    }

    struct StopAsked: LocalizedError { var errorDescription: String? { "Stopped. Nothing was made." } }

    static let gw = 64, gh = 36

    /// The picture shrunk to 64×36 shades of grey.
    static func greys(_ image: CGImage) -> [Double] {
        var bytes = [UInt8](repeating: 0, count: gw * gh)
        let ok: Bool = bytes.withUnsafeMutableBytes { raw in
            guard let context = CGContext(data: raw.baseAddress, width: gw, height: gh, bitsPerComponent: 8, bytesPerRow: gw,
                                          space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue) else { return false }
            context.interpolationQuality = .low
            context.draw(image, in: CGRect(x: 0, y: 0, width: gw, height: gh))
            return true
        }
        return ok ? bytes.map { Double($0) } : []
    }

    /// How much changed in each of 32 strips, left to right (small flickers ignored).
    static func movement(_ a: [Double], _ b: [Double]) -> [Double] {
        let strips = 32
        var out = [Double](repeating: 0, count: strips)
        for y in 0..<gh {
            for x in 0..<gw {
                let d = abs(a[y * gw + x] - b[y * gw + x])
                if d > 18 { out[x * strips / gw] += d }
            }
        }
        return out
    }

    /// Where the old graphics sit on a frame cut tall from a wide clip: the top strip (the score box and mark) and the
    /// bottom strip (the bar), white in the mask, fading into the picture.
    static func bandMask(_ frame: CGRect) -> CIImage {
        let h = frame.height
        let top = CIFilter(name: "CISmoothLinearGradient", parameters: [
            "inputPoint0": CIVector(x: 0, y: h * 0.865), "inputPoint1": CIVector(x: 0, y: h * 0.895),
            "inputColor0": CIColor(red: 0, green: 0, blue: 0), "inputColor1": CIColor(red: 1, green: 1, blue: 1)
        ])?.outputImage
        let bottom = CIFilter(name: "CISmoothLinearGradient", parameters: [
            "inputPoint0": CIVector(x: 0, y: h * 0.19), "inputPoint1": CIVector(x: 0, y: h * 0.225),
            "inputColor0": CIColor(red: 1, green: 1, blue: 1), "inputColor1": CIColor(red: 0, green: 0, blue: 0)
        ])?.outputImage
        guard let a = top, let b = bottom else { return CIImage(color: CIColor(red: 0, green: 0, blue: 0)).cropped(to: frame) }
        return a.applyingFilter("CIMaximumCompositing", parameters: [kCIInputBackgroundImageKey: b]).cropped(to: frame)
    }

    /// One tall frame: the window around `centre` (a fraction of the width) at full height, scaled to fill the frame. A
    /// picture that's already tall is drawn across the frame over a blurred copy instead (as a post shared to social media).
    static func draw(_ source: CIImage, centre: Double, in frame: CGRect, mask: CIImage?) -> CIImage {
        let picture = source.transformed(by: CGAffineTransform(translationX: -source.extent.minX, y: -source.extent.minY))
        let w = picture.extent.width, h = picture.extent.height
        guard w > 1, h > 1, w.isFinite, h.isFinite else { return CIImage(color: CIColor.black).cropped(to: frame) }
        let cw = h * frame.width / frame.height
        if cw >= w * 0.98 {
            return ReelCutterPlugin.tallDraw(source, look: BeatFrame(zoom: 1, dx: 0, dy: 0, flash: 0, blur: 0, mono: false), in: frame)
        }
        let x0 = min(w - cw, max(0, CGFloat(centre) * w - cw / 2))
        let s = frame.height / h
        let sharp = picture.cropped(to: CGRect(x: x0, y: 0, width: cw, height: h))
            .transformed(by: CGAffineTransform(translationX: -x0, y: 0))
            .transformed(by: CGAffineTransform(scaleX: s, y: s))
            .cropped(to: frame)
        guard let mask = mask else { return sharp }
        let soft = sharp.clampedToExtent().applyingGaussianBlur(sigma: 22).cropped(to: frame)
            .applyingFilter("CIColorControls", parameters: [kCIInputBrightnessKey: -0.12, kCIInputSaturationKey: 0.9])
        return soft.applyingFilter("CIBlendWithMask", parameters: [kCIInputBackgroundImageKey: sharp, kCIInputMaskImageKey: mask]).cropped(to: frame)
    }
}

/// The player detector (YOLOX-S, already in the app for player tracking) used to find the players and the ball in one
/// picture. If it can't be loaded, nothing is found and the frame follows the movement alone.
final class Spotter {
    private var session: ORTSession?
    private var env: ORTEnv?
    private var inputName = "images"
    private var outputName = "output"
    private var grid: [(Float, Float, Float)] = []
    private var tried = false
    static let size = 640

    private func model() -> ORTSession? {
        if tried { return session }
        tried = true
        guard let url = Bundle.module.url(forResource: "yolox_s", withExtension: "onnx") else { return nil }
        do {
            let env = try ORTEnv(loggingLevel: ORTLoggingLevel.warning)
            let options = try ORTSessionOptions()
            try options.setIntraOpNumThreads(4)
            try? options.appendCoreMLExecutionProvider(with: ORTCoreMLExecutionProviderOptions())
            let made = try ORTSession(env: env, modelPath: url.path, sessionOptions: options)
            if let name = try made.inputNames().first { inputName = name }
            if let name = try made.outputNames().first { outputName = name }
            var cells: [(Float, Float, Float)] = []
            for stride in [8, 16, 32] {
                let n = Spotter.size / stride
                for row in 0..<n { for column in 0..<n { cells.append((Float(column), Float(row), Float(stride))) } }
            }
            grid = cells
            self.env = env
            session = made
        } catch { session = nil }
        return session
    }

    /// Players and balls as (middle across, as a fraction of the width; how sure).
    func look(_ image: CGImage) -> (people: [(x: Double, score: Double)], balls: [(x: Double, score: Double)]) {
        guard let model = model() else { return ([], []) }
        let n = Spotter.size, w = image.width, h = image.height
        guard w > 0, h > 0 else { return ([], []) }
        let scale = Double(n) / Double(max(w, h))
        // the picture at the top left of a grey square, as the detector was trained
        var rgba = [UInt8](repeating: 114, count: n * n * 4)
        let drawn: Bool = rgba.withUnsafeMutableBytes { raw in
            guard let context = CGContext(data: raw.baseAddress, width: n, height: n, bitsPerComponent: 8, bytesPerRow: n * 4,
                                          space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { return false }
            let dw = Double(w) * scale, dh = Double(h) * scale
            context.draw(image, in: CGRect(x: 0, y: Double(n) - dh, width: dw, height: dh))
            return true
        }
        guard drawn else { return ([], []) }
        var input = [Float](repeating: 0, count: 3 * n * n)
        for i in 0..<(n * n) { // blue, green, red planes
            input[i] = Float(rgba[i * 4 + 2])
            input[n * n + i] = Float(rgba[i * 4 + 1])
            input[2 * n * n + i] = Float(rgba[i * 4])
        }
        let data = input.withUnsafeBufferPointer { NSMutableData(bytes: $0.baseAddress, length: $0.count * MemoryLayout<Float>.size) }
        guard let tensor = try? ORTValue(tensorData: data, elementType: ORTTensorElementDataType.float, shape: [1, 3, NSNumber(value: n), NSNumber(value: n)]),
              let result = try? model.run(withInputs: [inputName: tensor], outputNames: [outputName], runOptions: nil),
              let answer = result[outputName], let raw = try? answer.tensorData() else { return ([], []) }
        let fields = 85
        let values = UnsafeBufferPointer(start: raw.bytes.assumingMemoryBound(to: Float.self), count: raw.length / MemoryLayout<Float>.size)
        let count = min(grid.count, values.count / fields)
        var people: [Box] = [], balls: [Box] = []
        for index in 0..<count {
            let at = index * fields
            let seen = values[at + 4]
            if seen < 0.2 { continue }
            let person = Double(seen * values[at + 5]), ball = Double(seen * values[at + 5 + 32]) // (COCO's "sports ball")
            if person < 0.3 && ball < 0.25 { continue }
            let cell = grid[index]
            let cx = Double((values[at] + cell.0) * cell.2) / scale, cy = Double((values[at + 1] + cell.1) * cell.2) / scale
            let bw = Double(exp(values[at + 2]) * cell.2) / scale, bh = Double(exp(values[at + 3]) * cell.2) / scale
            let box = Box(x1: cx - bw / 2, y1: cy - bh / 2, x2: cx + bw / 2, y2: cy + bh / 2, score: max(person, ball))
            if person >= 0.3 { people.append(Box(x1: box.x1, y1: box.y1, x2: box.x2, y2: box.y2, score: person)) }
            if ball >= 0.25 { balls.append(Box(x1: box.x1, y1: box.y1, x2: box.x2, y2: box.y2, score: ball)) }
        }
        let width = Double(w)
        return (Box.keep(people).map { (x: ($0.x1 + $0.x2) / 2 / width, score: $0.score) },
                Box.keep(balls).map { (x: ($0.x1 + $0.x2) / 2 / width, score: $0.score) })
    }

    struct Box {
        var x1, y1, x2, y2, score: Double
        func overlap(_ o: Box) -> Double {
            let iw = max(0, min(x2, o.x2) - max(x1, o.x1)), ih = max(0, min(y2, o.y2) - max(y1, o.y1)), inter = iw * ih
            let union = (x2 - x1) * (y2 - y1) + (o.x2 - o.x1) * (o.y2 - o.y1) - inter
            return union > 0 ? inter / union : 0
        }
        /// The best of each group of boxes on the same thing.
        static func keep(_ boxes: [Box]) -> [Box] {
            var kept: [Box] = []
            for b in boxes.sorted(by: { $0.score > $1.score }) where !kept.contains(where: { $0.overlap(b) > 0.5 }) {
                kept.append(b)
                if kept.count >= 40 { break }
            }
            return kept
        }
    }
}
