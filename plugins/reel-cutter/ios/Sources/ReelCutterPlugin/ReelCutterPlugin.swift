import AVFoundation
import Capacitor
import Foundation
import Photos
import PhotosUI
import UIKit
import UniformTypeIdentifiers

/// Cuts highlight clips out of a match video, on the phone.
///
/// JS calls, in order:
///   pickVideo()  -> { path, duration, created? }   the person picks the recording from Photos
///   cut({ path, clips: [{ start, dur, caption, file }], watermark, outro: { title, sub, color, ink }, reelFile })
///                -> { clips: [{ file, path, size }], reel: { path, size } }
///   share({ path })                                the share sheet (save to Photos, send to a chat)
///   cleanup()                                      deletes the working files
/// While working it emits "progress" events: { stage: "copy" | "cut" | "reel", i, n, p }.
@objc(ReelCutterPlugin)
public class ReelCutterPlugin: CAPPlugin, CAPBridgedPlugin, PHPickerViewControllerDelegate {
    public let identifier = "ReelCutterPlugin"
    public let jsName = "ReelCutter"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "pickVideo", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cut", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "share", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cleanup", returnType: CAPPluginReturnPromise)
    ]

    private var pickCall: CAPPluginCall?
    private var pickSlot = 1
    private var copyObservation: NSKeyValueObservation?
    private let queue = DispatchQueue(label: "reelcutter.work", qos: .userInitiated)

    private struct Segment {
        let asset: AVAsset
        let start: Double
        let dur: Double
        let caption: String
        var voice: AVURLAsset? = nil   // a spoken line to lay over this stretch
        var voiceAt: Double = 0        // seconds into the stretch at which it should start
    }

    private struct CutError: LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }

    private var workDir: URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("reelcutter", isDirectory: true)
    }

    private func ensureWorkDir() throws -> URL {
        let dir = workDir
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    // MARK: - Pick the recording

    @objc public func pickVideo(_ call: CAPPluginCall) {
        pickCall = call
        pickSlot = call.getInt("slot") ?? 1 // 1 = the game (or its first half), 2 = a separate second-half video
        DispatchQueue.main.async {
            // (from the photo library itself, so each pick carries its Photos id: the way in when the file itself can't be had)
            var config = PHPickerConfiguration(photoLibrary: .shared())
            config.filter = .videos
            config.selectionLimit = 1
            config.preferredAssetRepresentationMode = .current // hand over the original file, without re-encoding it first
            let picker = PHPickerViewController(configuration: config)
            picker.delegate = self
            guard let host = self.bridge?.viewController else {
                self.pickCall = nil
                call.reject("Couldn't open the photo picker")
                return
            }
            host.present(picker, animated: true)
        }
    }

    public func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        picker.dismiss(animated: true)
        guard let call = pickCall else { return }
        pickCall = nil
        let slot = pickSlot
        guard let picked = results.first else {
            call.resolve(["cancelled": true])
            return
        }
        let provider = picked.itemProvider
        // Every kind of video the item says it can be, the most particular first (a QuickTime or MPEG-4 movie), then plain
        // "movie". Photos sometimes won't hand a video over as a plain movie but will as what it really is.
        var kinds = provider.registeredTypeIdentifiers.filter { UTType($0)?.conforms(to: .movie) == true }
        for extra in [UTType.quickTimeMovie.identifier, UTType.mpeg4Movie.identifier, UTType.movie.identifier] where !kinds.contains(extra) {
            if provider.hasItemConformingToTypeIdentifier(extra) { kinds.append(extra) }
        }
        guard !kinds.isEmpty || picked.assetIdentifier != nil else {
            call.reject("That doesn't look like a video. Choose the game's recording from your videos.")
            return
        }
        notifyListeners("progress", data: ["stage": "copy", "p": 0])
        load(provider, kinds, 0, assetId: picked.assetIdentifier, slot: slot, call: call, lastError: nil)
    }

    /// Tries each kind of file in turn; if Photos won't hand any of them over, fetches the video from the library instead.
    private func load(_ provider: NSItemProvider, _ kinds: [String], _ i: Int, assetId: String?, slot: Int, call: CAPPluginCall, lastError: Error?) {
        guard i < kinds.count else {
            fromLibrary(assetId, slot: slot, call: call, lastError: lastError)
            return
        }
        let progress = provider.loadFileRepresentation(forTypeIdentifier: kinds[i]) { [weak self] url, error in
            guard let self = self else { return }
            self.copyObservation = nil
            guard let url = url else {
                self.load(provider, kinds, i + 1, assetId: assetId, slot: slot, call: call, lastError: error ?? lastError)
                return
            }
            // The file we are handed is deleted when this block returns, so it's moved somewhere of our own first.
            self.keep(url, slot: slot, move: true, created: nil, call: call)
        }
        copyObservation = progress.observe(\.fractionCompleted) { [weak self] value, _ in
            self?.notifyListeners("progress", data: ["stage": "copy", "p": value.fractionCompleted])
        }
    }

    /// The video straight from the photo library (downloading it from iCloud if that's where it is), by its Photos id.
    private func fromLibrary(_ assetId: String?, slot: Int, call: CAPPluginCall, lastError: Error?) {
        let why = lastError.map { " (\($0.localizedDescription))" } ?? ""
        let failed = "Couldn't read that video from Photos\(why). If it's kept in iCloud, check you have signal, open it in the Photos app so it downloads, then choose it again."
        guard let assetId = assetId else { call.reject(failed); return }
        PHPhotoLibrary.requestAuthorization(for: .readWrite) { status in
            guard status == .authorized || status == .limited else {
                call.reject("Photos wouldn't hand that video over\(why), and Gaffer isn't allowed to read it from your library. Turn on Settings, Gaffer, Photos (Full Access), then choose it again.")
                return
            }
            guard let asset = PHAsset.fetchAssets(withLocalIdentifiers: [assetId], options: nil).firstObject else {
                call.reject("Photos wouldn't hand that video over\(why), and Gaffer can't see it in your library. In Settings, Gaffer, Photos, choose Full Access (or add this video to the ones Gaffer can see), then choose it again.")
                return
            }
            let options = PHVideoRequestOptions()
            options.isNetworkAccessAllowed = true   // fetch it from iCloud if it isn't on the phone
            options.deliveryMode = .highQualityFormat
            options.version = .original              // the file as recorded (a slow-motion video's edits aren't wanted)
            options.progressHandler = { [weak self] p, _, _, _ in
                self?.notifyListeners("progress", data: ["stage": "copy", "p": p])
            }
            PHImageManager.default().requestAVAsset(forVideo: asset, options: options) { [weak self] video, _, info in
                guard let self = self else { return }
                guard let file = (video as? AVURLAsset)?.url else {
                    let said = (info?[PHImageErrorKey] as? Error).map { " (\($0.localizedDescription))" } ?? why
                    call.reject("Couldn't read that video from Photos\(said). If it's kept in iCloud, check you have signal, open it in the Photos app so it downloads, then choose it again.")
                    return
                }
                self.keep(file, slot: slot, move: false, created: asset.creationDate, call: call)
            }
        }
    }

    /// Puts the picked video in Gaffer's working folder as this slot's source, and tells the web app about it.
    private func keep(_ url: URL, slot: Int, move: Bool, created: Date?, call: CAPPluginCall) {
        do {
            let dir = try ensureWorkDir()
            let ext = url.pathExtension.isEmpty ? "mov" : url.pathExtension
            for old in (try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)) ?? []
            where old.lastPathComponent.hasPrefix("source\(slot).") {
                try? FileManager.default.removeItem(at: old)
            }
            let dest = dir.appendingPathComponent("source\(slot)." + ext)
            try? FileManager.default.removeItem(at: dest)
            var moved = false
            if move { moved = (try? FileManager.default.moveItem(at: url, to: dest)) != nil }
            if !moved { try FileManager.default.copyItem(at: url, to: dest) } // (the library's own file is only ever copied)
            let asset = AVURLAsset(url: dest)
            var result: [String: Any] = [
                "path": dest.path,
                "duration": CMTimeGetSeconds(asset.duration)
            ]
            if let made = asset.creationDate?.dateValue ?? created {
                result["created"] = made.timeIntervalSince1970 * 1000
            }
            call.resolve(result)
        } catch {
            call.reject("There isn't enough free space on this phone to read that video")
        }
    }

    // MARK: - Cut

    @objc public func cut(_ call: CAPPluginCall) {
        guard let path = call.getString("path"),
              let rawClips = call.options["clips"] as? [[String: Any]], !rawClips.isEmpty else {
            call.reject("Nothing to cut")
            return
        }
        let watermark = call.getString("watermark") ?? ""
        let outro = call.options["outro"] as? [String: Any]
        let reelFile = call.getString("reelFile")

        queue.async {
            do {
                let dir = try self.ensureWorkDir()
                // Each clip can name its own video, for games filmed as one file per half.
                var assets: [String: AVURLAsset] = [:]
                func asset(_ file: String) -> AVURLAsset {
                    if let known = assets[file] { return known }
                    let made = AVURLAsset(url: URL(fileURLWithPath: file))
                    assets[file] = made
                    return made
                }
                // Spoken commentary arrives as base64 MP3 and is written to a file so it can be mixed in.
                var voiceCount = 0
                func voice(_ raw: Any?) -> AVURLAsset? {
                    guard let text = raw as? String, let data = Data(base64Encoded: text), data.count > 200 else { return nil }
                    voiceCount += 1
                    let url = dir.appendingPathComponent(String(format: "voice_%02d.mp3", voiceCount))
                    do { try data.write(to: url) } catch { return nil }
                    return AVURLAsset(url: url)
                }
                let intro = voice(call.options["introVoice"])
                let signOff = voice(call.options["outroVoice"])
                var segments: [Segment] = []
                var files: [String] = []
                for (index, raw) in rawClips.enumerated() {
                    let start = (raw["start"] as? NSNumber)?.doubleValue ?? 0
                    let dur = (raw["dur"] as? NSNumber)?.doubleValue ?? 20
                    segments.append(Segment(asset: asset(raw["path"] as? String ?? path), start: start, dur: dur, caption: raw["caption"] as? String ?? "",
                                            voice: voice(raw["voice"]), voiceAt: (raw["voiceAt"] as? NSNumber)?.doubleValue ?? 0))
                    files.append(raw["file"] as? String ?? String(format: "clip_%02d.mp4", index + 1))
                }

                var made: [[String: Any]] = []
                for (index, segment) in segments.enumerated() {
                    let out = dir.appendingPathComponent(files[index])
                    try self.export(segments: [segment], watermark: watermark, outro: nil, to: out) { fraction in
                        self.notifyListeners("progress", data: ["stage": "cut", "i": index, "n": segments.count, "p": fraction])
                    }
                    made.append(["file": files[index], "path": out.path, "size": self.fileSize(out)])
                }

                var result: [String: Any] = ["clips": made]
                if let reelFile = reelFile {
                    let out = dir.appendingPathComponent(reelFile)
                    try self.export(segments: segments, watermark: watermark, outro: outro, to: out, intro: intro, signOff: signOff) { fraction in
                        self.notifyListeners("progress", data: ["stage": "reel", "i": 0, "n": 1, "p": fraction])
                    }
                    result["reel"] = ["path": out.path, "size": self.fileSize(out)]
                }
                call.resolve(result)
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    private func fileSize(_ url: URL) -> Int {
        let attributes = try? FileManager.default.attributesOfItem(atPath: url.path)
        return (attributes?[.size] as? NSNumber)?.intValue ?? 0
    }

    /// Joins the given stretches of the source video into one file, drawing the watermark over all of it,
    /// each stretch's caption while it plays, and (for a reel) an outro card at the end.
    private func export(segments: [Segment], watermark: String, outro: [String: Any]?, to out: URL, intro: AVURLAsset? = nil, signOff: AVURLAsset? = nil,
                        progress: @escaping (Double) -> Void) throws {
        guard let firstAsset = segments.first?.asset, let firstVideo = firstAsset.tracks(withMediaType: .video).first else {
            throw CutError(message: "That file has no video in it")
        }

        let composition = AVMutableComposition()
        guard let video = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid) else {
            throw CutError(message: "Couldn't set up the video")
        }
        let audio = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid)
        let speech = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid)
        video.preferredTransform = firstVideo.preferredTransform

        // Spoken lines go on their own track, one after another, and the footage's own sound is turned down under each.
        var spoken: [(from: Double, to: Double)] = []
        var speechEnd = 0.0
        func length(_ line: AVURLAsset?) -> Double {
            guard let line = line, line.tracks(withMediaType: .audio).first != nil else { return 0 }
            let seconds = CMTimeGetSeconds(line.duration)
            return seconds.isFinite && seconds > 0.2 ? seconds : 0
        }
        func say(_ line: AVURLAsset?, at wanted: Double, before limit: Double) {
            let seconds = length(line)
            guard seconds > 0, let line = line, let speech = speech, let source = line.tracks(withMediaType: .audio).first else { return }
            let at = max(speechEnd, min(wanted, limit - seconds))
            do { try speech.insertTimeRange(CMTimeRange(start: .zero, duration: line.duration), of: source, at: CMTime(seconds: at, preferredTimescale: 600)) } catch { return }
            spoken.append((from: at, to: at + seconds))
            speechEnd = at + seconds + 0.15
        }
        if let first = segments.first, length(intro) > 0, first.voice == nil || 0.4 + length(intro) + 0.4 <= first.voiceAt {
            say(intro, at: 0.4, before: .greatestFiniteMagnitude)
        }

        let scale: CMTimeScale = 600
        var cursor = CMTime.zero
        var spans: [(at: Double, dur: Double, caption: String)] = []
        var placed: [(at: CMTime, track: AVAssetTrack)] = [] // which camera's footage starts where, for fitting each into the frame
        for segment in segments {
            guard let sourceVideo = segment.asset.tracks(withMediaType: .video).first else {
                throw CutError(message: "That file has no video in it")
            }
            let total = CMTimeGetSeconds(segment.asset.duration)
            guard total.isFinite, total > 1 else { throw CutError(message: "That video is too short to cut") }
            let start = max(0, min(segment.start, total - 1))
            let dur = max(1, min(segment.dur, total - start))
            let range = CMTimeRange(start: CMTime(seconds: start, preferredTimescale: scale), duration: CMTime(seconds: dur, preferredTimescale: scale))
            try video.insertTimeRange(range, of: sourceVideo, at: cursor)
            if let audio = audio, let sourceAudio = segment.asset.tracks(withMediaType: .audio).first {
                try? audio.insertTimeRange(range, of: sourceAudio, at: cursor)
            }
            spans.append((at: CMTimeGetSeconds(cursor), dur: dur, caption: segment.caption))
            placed.append((at: cursor, track: sourceVideo))
            say(segment.voice, at: CMTimeGetSeconds(cursor) + segment.voiceAt, before: CMTimeGetSeconds(cursor) + dur)
            cursor = CMTimeAdd(cursor, range.duration)
        }
        if let audio = audio, audio.segments.isEmpty { composition.removeTrack(audio) }
        let sourceVideo = firstVideo
        let total = CMTimeGetSeconds(firstAsset.duration)

        // The outro card is drawn over a few silent seconds of footage, which it covers completely.
        var outroAt: Double?
        if outro != nil, let first = segments.first {
            let dur = min(max(3.5, min(7, length(signOff) + 0.9)), total - 0.1) // long enough for the sign-off to be said
            let start = max(0, min(first.start, total - dur))
            let range = CMTimeRange(start: CMTime(seconds: start, preferredTimescale: scale), duration: CMTime(seconds: dur, preferredTimescale: scale))
            try video.insertTimeRange(range, of: sourceVideo, at: cursor)
            placed.append((at: cursor, track: sourceVideo))
            outroAt = CMTimeGetSeconds(cursor)
            say(signOff, at: CMTimeGetSeconds(cursor) + 0.3, before: CMTimeGetSeconds(cursor) + dur)
            cursor = CMTimeAdd(cursor, range.duration)
        }
        if let speech = speech, speech.segments.isEmpty { composition.removeTrack(speech) }

        // Footage from different cameras can differ in size and which way up it was filmed: then each stretch is turned
        // upright and scaled to fit a frame the size of the first, instead of only the first camera's being right.
        let mixed = placed.contains { $0.track.naturalSize != firstVideo.naturalSize || $0.track.preferredTransform != firstVideo.preferredTransform }
        if mixed { video.preferredTransform = .identity }
        let videoComposition = AVMutableVideoComposition(propertiesOf: composition)
        if mixed {
            let upright = ReelCutterPlugin.upright(firstVideo)
            let frame = CGSize(width: max(2, (abs(upright.width) / 2).rounded() * 2), height: max(2, (abs(upright.height) / 2).rounded() * 2))
            videoComposition.renderSize = frame
            let layer = AVMutableVideoCompositionLayerInstruction(assetTrack: video)
            for stretch in placed { layer.setTransform(ReelCutterPlugin.fit(stretch.track, in: frame), at: stretch.at) }
            let instruction = AVMutableVideoCompositionInstruction()
            instruction.timeRange = CMTimeRange(start: .zero, duration: composition.duration) // (must cover all of it, or the export is refused)
            instruction.layerInstructions = [layer]
            videoComposition.instructions = [instruction]
        }
        // Phones record HDR by default; these three settings make the result ordinary video that plays anywhere.
        videoComposition.colorPrimaries = AVVideoColorPrimaries_ITU_R_709_2
        videoComposition.colorTransferFunction = AVVideoTransferFunction_ITU_R_709_2
        videoComposition.colorYCbCrMatrix = AVVideoYCbCrMatrix_ITU_R_709_2
        let size = videoComposition.renderSize
        guard size.width > 0, size.height > 0 else { throw CutError(message: "Couldn't read the video's size") }

        // Layers are laid out with the origin at the bottom left.
        let parent = CALayer()
        parent.frame = CGRect(origin: .zero, size: size)
        let videoLayer = CALayer()
        videoLayer.frame = parent.frame
        parent.addSublayer(videoLayer)

        let unit = min(size.width, size.height) / 100 // 1% of the shorter side, so text scales with the footage
        let margin = unit * 3.5

        if !watermark.isEmpty {
            let mark = pill(text: watermark, fontSize: unit * 3.2, weight: .heavy, maxWidth: size.width * 0.5, unit: unit)
            mark.frame.origin = CGPoint(x: size.width - mark.frame.width - margin, y: size.height - mark.frame.height - margin)
            mark.opacity = 0.9
            parent.addSublayer(mark)
        }

        for span in spans where !span.caption.isEmpty {
            let caption = pill(text: span.caption, fontSize: unit * 4.2, weight: .bold, maxWidth: size.width * 0.8, unit: unit)
            caption.frame.origin = CGPoint(x: margin, y: margin)
            show(caption, from: span.at, to: outroAt == nil && span.at + span.dur >= CMTimeGetSeconds(cursor) - 0.01 ? nil : span.at + span.dur)
            parent.addSublayer(caption)
        }

        if let outro = outro, let outroAt = outroAt {
            let background = color(outro["color"] as? String, fallback: UIColor(red: 0.12, green: 0.42, blue: 0.29, alpha: 1))
            let ink = color(outro["ink"] as? String, fallback: .white)
            let card = CALayer()
            card.frame = parent.frame
            card.backgroundColor = background.cgColor
            let width = size.width * 0.84
            let title = label(text: outro["title"] as? String ?? "", fontSize: unit * 8, weight: .heavy, color: ink, maxWidth: width, centred: true)
            let sub = label(text: outro["sub"] as? String ?? "", fontSize: unit * 4, weight: .semibold, color: ink.withAlphaComponent(0.8), maxWidth: width, centred: true)
            let gap = unit * 3
            let block = title.frame.height + gap + sub.frame.height
            title.frame = CGRect(x: (size.width - width) / 2, y: (size.height - block) / 2 + sub.frame.height + gap, width: width, height: title.frame.height)
            sub.frame = CGRect(x: (size.width - width) / 2, y: (size.height - block) / 2, width: width, height: sub.frame.height)
            card.addSublayer(title)
            card.addSublayer(sub)
            show(card, from: outroAt, to: nil)
            parent.addSublayer(card)
        }

        videoComposition.animationTool = AVVideoCompositionCoreAnimationTool(postProcessingAsVideoLayer: videoLayer, in: parent)

        try? FileManager.default.removeItem(at: out)
        guard let session = AVAssetExportSession(asset: composition, presetName: AVAssetExportPreset960x540) else {
            throw CutError(message: "This phone can't export that video")
        }
        session.videoComposition = videoComposition
        if !spoken.isEmpty, let audio = audio, !audio.segments.isEmpty {
            // lines close together share one dip, so the crowd noise doesn't pump up and down between them
            var dips: [(from: Double, to: Double)] = []
            for line in spoken {
                if let last = dips.last, line.from - last.to < 1.0 { dips[dips.count - 1].to = line.to } else { dips.append(line) }
            }
            let quiet: Float = 0.22
            let levels = AVMutableAudioMixInputParameters(track: audio)
            for dip in dips {
                let down = max(0, dip.from - 0.25)
                levels.setVolumeRamp(fromStartVolume: 1, toEndVolume: quiet, timeRange: CMTimeRange(start: CMTime(seconds: down, preferredTimescale: 600), duration: CMTime(seconds: max(0.05, dip.from - down), preferredTimescale: 600)))
                levels.setVolumeRamp(fromStartVolume: quiet, toEndVolume: 1, timeRange: CMTimeRange(start: CMTime(seconds: dip.to, preferredTimescale: 600), duration: CMTime(seconds: 0.35, preferredTimescale: 600)))
            }
            let mix = AVMutableAudioMix()
            mix.inputParameters = [levels]
            session.audioMix = mix
        }
        session.outputURL = out
        session.outputFileType = .mp4
        session.shouldOptimizeForNetworkUse = true

        let done = DispatchSemaphore(value: 0)
        session.exportAsynchronously { done.signal() }
        while done.wait(timeout: .now() + 0.3) == .timedOut {
            progress(Double(session.progress))
        }
        guard session.status == .completed else {
            throw CutError(message: session.error?.localizedDescription ?? "The video couldn't be cut")
        }
        progress(1)
    }

    /// Where a track's frames land once turned the right way up (the rect can start off the origin).
    private static func upright(_ track: AVAssetTrack) -> CGRect {
        CGRect(origin: .zero, size: track.naturalSize).applying(track.preferredTransform)
    }

    /// Turns a track's frames the right way up and scales them to fit inside `frame`, centred (black bars if the shapes differ).
    private static func fit(_ track: AVAssetTrack, in frame: CGSize) -> CGAffineTransform {
        let box = upright(track)
        let w = abs(box.width), h = abs(box.height)
        guard w > 0, h > 0 else { return track.preferredTransform }
        let scale = min(frame.width / w, frame.height / h)
        return track.preferredTransform
            .concatenating(CGAffineTransform(translationX: -box.minX, y: -box.minY))
            .concatenating(CGAffineTransform(scaleX: scale, y: scale))
            .concatenating(CGAffineTransform(translationX: (frame.width - w * scale) / 2, y: (frame.height - h * scale) / 2))
    }

    // MARK: - Drawing helpers

    /// Makes a layer visible from `from` seconds into the video until `to` (or the end).
    private func show(_ layer: CALayer, from: Double, to: Double?) {
        layer.opacity = 0
        let appear = CABasicAnimation(keyPath: "opacity")
        appear.fromValue = 0
        appear.toValue = 1
        appear.duration = 0.2
        appear.beginTime = AVCoreAnimationBeginTimeAtZero + from
        appear.fillMode = .forwards
        appear.isRemovedOnCompletion = false
        layer.add(appear, forKey: "appear")
        if let to = to {
            let vanish = CABasicAnimation(keyPath: "opacity")
            vanish.fromValue = 1
            vanish.toValue = 0
            vanish.duration = 0.2
            vanish.beginTime = AVCoreAnimationBeginTimeAtZero + max(from + 0.3, to - 0.2)
            vanish.fillMode = .forwards
            vanish.isRemovedOnCompletion = false
            layer.add(vanish, forKey: "vanish")
        }
    }

    private func label(text: String, fontSize: CGFloat, weight: UIFont.Weight, color: UIColor, maxWidth: CGFloat, centred: Bool) -> CATextLayer {
        let font = UIFont.systemFont(ofSize: fontSize, weight: weight)
        let paragraph = NSMutableParagraphStyle()
        paragraph.alignment = centred ? .center : .left
        paragraph.lineBreakMode = .byWordWrapping
        let attributes: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: color, .paragraphStyle: paragraph]
        let string = NSAttributedString(string: text, attributes: attributes)
        let bounds = string.boundingRect(with: CGSize(width: maxWidth, height: .greatestFiniteMagnitude),
                                         options: [.usesLineFragmentOrigin, .usesFontLeading], context: nil)
        let layer = CATextLayer()
        layer.string = string
        layer.isWrapped = true
        layer.alignmentMode = centred ? .center : .left
        layer.contentsScale = 1
        layer.frame = CGRect(x: 0, y: 0, width: centred ? maxWidth : ceil(bounds.width) + 2, height: ceil(bounds.height) + 2)
        return layer
    }

    /// White text on a translucent dark rounded box, readable over any footage.
    private func pill(text: String, fontSize: CGFloat, weight: UIFont.Weight, maxWidth: CGFloat, unit: CGFloat) -> CALayer {
        let words = label(text: text, fontSize: fontSize, weight: weight, color: .white, maxWidth: maxWidth, centred: false)
        let padX = unit * 2.2
        let padY = unit * 1.4
        let box = CALayer()
        box.backgroundColor = UIColor.black.withAlphaComponent(0.55).cgColor
        box.cornerRadius = unit * 1.8
        box.frame = CGRect(x: 0, y: 0, width: words.frame.width + padX * 2, height: words.frame.height + padY * 2)
        words.frame.origin = CGPoint(x: padX, y: padY)
        box.addSublayer(words)
        return box
    }

    private func color(_ hex: String?, fallback: UIColor) -> UIColor {
        guard var value = hex?.trimmingCharacters(in: .whitespaces), !value.isEmpty else { return fallback }
        if value.hasPrefix("#") { value.removeFirst() }
        guard value.count == 6, let number = UInt32(value, radix: 16) else { return fallback }
        return UIColor(red: CGFloat((number >> 16) & 0xFF) / 255, green: CGFloat((number >> 8) & 0xFF) / 255, blue: CGFloat(number & 0xFF) / 255, alpha: 1)
    }

    // MARK: - Share and tidy up

    @objc public func share(_ call: CAPPluginCall) {
        guard let path = call.getString("path"), FileManager.default.fileExists(atPath: path) else {
            call.reject("That video is no longer on this phone")
            return
        }
        DispatchQueue.main.async {
            guard let host = self.bridge?.viewController else {
                call.reject("Couldn't open the share sheet")
                return
            }
            let sheet = UIActivityViewController(activityItems: [URL(fileURLWithPath: path)], applicationActivities: nil)
            sheet.popoverPresentationController?.sourceView = host.view
            sheet.completionWithItemsHandler = { _, completed, _, _ in
                call.resolve(["completed": completed])
            }
            host.present(sheet, animated: true)
        }
    }

    @objc public func cleanup(_ call: CAPPluginCall) {
        try? FileManager.default.removeItem(at: workDir)
        call.resolve()
    }
}
