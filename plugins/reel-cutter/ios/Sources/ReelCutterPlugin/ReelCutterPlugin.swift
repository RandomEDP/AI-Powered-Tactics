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
///   cut({ path, clips: [{ start, dur, caption, file, bug?, lower? }], watermark, look?, outro: { kicker, title, sub, color, ink, crest }, reelFile, reelCleanFile? })
///                -> { clips: [{ file, path, size }], reel: { path, size, marks }, reelClean?: { path, size, marks } }
///   share({ path })                                the share sheet (save to Photos, send to a chat)
///   shareText({ text, url })                       the share sheet for a message with a link
///   joinReel({ items: [{ url, voice?, voiceAt? }], outro, file })   a reel from clips already made -> { path, size, marks }
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
        CAPPluginMethod(name: "joinReel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "shareText", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cleanup", returnType: CAPPluginReturnPromise)
    ]

    private var pickCall: CAPPluginCall?
    private var pickSlot = 1
    private var copyObservation: NSKeyValueObservation?
    private let queue = DispatchQueue(label: "reelcutter.work", qos: .userInitiated)
    /// Videos used where they are in Photos, by path. iOS only lets the app read such a file while Photos' own handle on it
    /// (this asset) is kept: let go of it and opening the path again finds no video in it. Only touched on `queue`.
    private var picked: [String: AVURLAsset] = [:]

    private struct Segment {
        let asset: AVAsset
        let start: Double
        let dur: Double
        let caption: String
        var voice: AVURLAsset? = nil   // a spoken line to lay over this stretch
        var voiceAt: Double = 0        // seconds into the stretch at which it should start
        var voiced = false             // the line is already in the footage's own sound (a finished clip), so it isn't laid again
        var bug: ReelBug? = nil        // the score box with the match clock (ReelGraphics.swift)
        var lower: ReelLower? = nil    // the bar along the bottom saying what the moment is
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
        // With full access to Photos the video is used where it is, instead of being copied first (a whole game can be many
        // gigabytes, and copying it took minutes). iOS asks once; without it, the video is copied as before.
        if PHPhotoLibrary.authorizationStatus(for: .readWrite) == .notDetermined {
            PHPhotoLibrary.requestAuthorization(for: .readWrite) { _ in self.presentPicker(call) }
        } else {
            presentPicker(call)
        }
    }

    private func presentPicker(_ call: CAPPluginCall) {
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
        let copy = { self.load(provider, kinds, 0, assetId: picked.assetIdentifier, slot: slot, call: call, lastError: nil) }
        if let id = picked.assetIdentifier, PHPhotoLibrary.authorizationStatus(for: .readWrite) == .authorized {
            inPlace(id, call: call) { used in if !used { copy() } }
        } else {
            copy()
        }
    }

    /// The video straight from the photo library, without copying it: the file Photos keeps (fetched from iCloud first if
    /// that's where it is). The version as it looks in Photos (trimmed, if it was), or the original if that has no file
    /// of its own (a slow-motion video). `done(false)` if it can't be had this way.
    private func inPlace(_ assetId: String, call: CAPPluginCall, done: @escaping (Bool) -> Void) {
        guard let asset = PHAsset.fetchAssets(withLocalIdentifiers: [assetId], options: nil).firstObject else { done(false); return }
        func ask(_ version: PHVideoRequestOptionsVersion, then: @escaping (AVURLAsset?) -> Void) {
            let options = PHVideoRequestOptions()
            options.isNetworkAccessAllowed = true
            options.deliveryMode = .highQualityFormat
            options.version = version
            options.progressHandler = { [weak self] p, _, _, _ in self?.notifyListeners("progress", data: ["stage": "copy", "p": p]) }
            PHImageManager.default().requestAVAsset(forVideo: asset, options: options) { video, _, _ in then(video as? AVURLAsset) }
        }
        let use: (AVURLAsset) -> Void = { video in
            self.queue.sync { self.picked[video.url.path] = video } // (kept, or the file can't be read again later)
            var result: [String: Any] = ["path": video.url.path, "duration": CMTimeGetSeconds(video.duration), "inPlace": true]
            if let made = video.creationDate?.dateValue ?? asset.creationDate { result["created"] = made.timeIntervalSince1970 * 1000 }
            call.resolve(result)
            done(true)
        }
        ask(.current) { video in
            if let video = video, FileManager.default.isReadableFile(atPath: video.url.path) { use(video); return }
            ask(.original) { video in
                if let video = video, FileManager.default.isReadableFile(atPath: video.url.path) { use(video) } else { done(false) }
            }
        }
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
        let reelCleanFile = call.getString("reelCleanFile") // (with commentary: a second reel without it, for "Commentary off")
        let look = ReelGraphics.look(call.options["look"])

        var spare: UIBackgroundTaskIdentifier = .invalid
        let begin = { spare = UIApplication.shared.beginBackgroundTask(withName: "Cutting highlights") { UIApplication.shared.endBackgroundTask(spare) } }
        if Thread.isMainThread { begin() } else { DispatchQueue.main.sync(execute: begin) } // (a little time to finish if the phone is locked mid-cut)
        let finished = { DispatchQueue.main.async { if spare != .invalid { UIApplication.shared.endBackgroundTask(spare); spare = .invalid } } }
        queue.async {
            defer { finished() }
            do {
                let dir = try self.ensureWorkDir()
                // Each clip can name its own video, for games filmed as one file per half.
                var assets: [String: AVURLAsset] = [:]
                func asset(_ file: String) -> AVURLAsset {
                    if let known = assets[file] { return known }
                    let made = self.picked[file] ?? AVURLAsset(url: URL(fileURLWithPath: file))
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
                    var segment = Segment(asset: asset(raw["path"] as? String ?? path), start: start, dur: dur, caption: raw["caption"] as? String ?? "",
                                          voice: voice(raw["voice"]), voiceAt: (raw["voiceAt"] as? NSNumber)?.doubleValue ?? 0)
                    segment.bug = ReelGraphics.bug(raw["bug"])
                    segment.lower = ReelGraphics.lower(raw["lower"])
                    segments.append(segment)
                    files.append(raw["file"] as? String ?? String(format: "clip_%02d.mp4", index + 1))
                }

                // Each clip is made without commentary, and (when there's a line for it) again with it: the app plays one
                // or the other, as two sounds can't play at once on an iPhone. Each is made smaller for uploading.
                var made: [[String: Any]] = []
                for (index, segment) in segments.enumerated() {
                    let out = dir.appendingPathComponent(files[index])
                    var clean = segment
                    clean.voice = nil
                    try self.export(segments: [clean], watermark: watermark, outro: nil, to: out, look: look) { fraction in
                        self.notifyListeners("progress", data: ["stage": "cut", "i": index, "n": segments.count, "p": segment.voice == nil ? fraction : fraction / 2])
                    }
                    self.shrink(out)
                    var entry: [String: Any] = ["file": files[index], "path": out.path, "size": self.fileSize(out)]
                    if segment.voice != nil {
                        let name = (files[index] as NSString).deletingPathExtension + "v.mp4"
                        let voicedOut = dir.appendingPathComponent(name)
                        do {
                            try self.export(segments: [segment], watermark: watermark, outro: nil, to: voicedOut, look: look) { fraction in
                                self.notifyListeners("progress", data: ["stage": "cut", "i": index, "n": segments.count, "p": 0.5 + fraction / 2])
                            }
                            self.shrink(voicedOut)
                            entry["voiced"] = ["file": name, "path": voicedOut.path, "size": self.fileSize(voicedOut)]
                        } catch {
                            // the clip without commentary is still good
                        }
                    }
                    made.append(entry)
                }

                var result: [String: Any] = ["clips": made]
                if let reelFile = reelFile {
                    // The reel is joined from the clips just made (small, with their watermark, captions and commentary
                    // already in), not cut again from the whole game's video, which was slow enough to look stuck.
                    // marks: where each clip starts in the reel, in seconds (null for one that couldn't be read back), so
                    // the app can skip straight to any moment in it.
                    func join(withVoices: Bool, name: String, from: Double, share: Double) throws -> [String: Any] {
                        var pieces: [Segment] = []
                        var marks: [Any] = []
                        var at = 0.0
                        for (index, segment) in segments.enumerated() {
                            let voiced = withVoices ? (made[index]["voiced"] as? [String: Any])?["path"] as? String : nil
                            let clip = AVURLAsset(url: URL(fileURLWithPath: voiced ?? made[index]["path"] as? String ?? ""))
                            let length = CMTimeGetSeconds(clip.duration)
                            guard length.isFinite, length > 0.5 else { marks.append(NSNull()); continue }
                            marks.append(at)
                            at += length
                            pieces.append(Segment(asset: clip, start: 0, dur: length, caption: "", voice: voiced == nil ? nil : segment.voice, voiceAt: segment.voiceAt, voiced: true))
                        }
                        let out = dir.appendingPathComponent(name)
                        guard !pieces.isEmpty else { throw CutError(message: "none of the clips could be read back") }
                        try self.export(segments: pieces, watermark: "", outro: outro, to: out, intro: withVoices ? intro : nil, signOff: withVoices ? signOff : nil) { fraction in
                            self.notifyListeners("progress", data: ["stage": "reel", "i": 0, "n": 1, "p": from + fraction * share])
                        }
                        self.shrink(out) // (it's uploaded for the team to watch, like the clips)
                        return ["path": out.path, "size": self.fileSize(out), "marks": marks]
                    }
                    let clean = made.contains { $0["voiced"] != nil } ? reelCleanFile : nil
                    do {
                        result["reel"] = try join(withVoices: true, name: reelFile, from: 0, share: clean == nil ? 1 : 0.5)
                        if let clean = clean {
                            do { result["reelClean"] = try join(withVoices: false, name: clean, from: 0.5, share: 0.5) } catch {} // (the reel with commentary still plays)
                        }
                    } catch {
                        result["reelError"] = error.localizedDescription // the clips are fine: they're still uploaded
                    }
                }
                call.resolve(result)
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    /// Makes a finished clip smaller (about 2 Mbit/s, which looks the same on a phone) by encoding it again, if it's
    /// bigger than that. The export the clip comes from runs at about 5 Mbit/s, which filled the team's storage fast.
    /// If anything goes wrong the clip is left as it was.
    private func shrink(_ file: URL, bitRate: Int = 2_000_000) {
        let asset = AVURLAsset(url: file)
        let seconds = CMTimeGetSeconds(asset.duration)
        guard seconds.isFinite, seconds > 0, Double(fileSize(file)) * 8 / seconds > Double(bitRate) * 1.3,
              let track = asset.tracks(withMediaType: .video).first else { return }
        let smaller = file.deletingLastPathComponent().appendingPathComponent("small-" + file.lastPathComponent)
        try? FileManager.default.removeItem(at: smaller)
        do {
            let reader = try AVAssetReader(asset: asset)
            let writer = try AVAssetWriter(outputURL: smaller, fileType: .mp4)
            writer.shouldOptimizeForNetworkUse = true
            let pictures = AVAssetReaderTrackOutput(track: track, outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange])
            pictures.alwaysCopiesSampleData = false
            guard reader.canAdd(pictures) else { return }
            reader.add(pictures)
            let size = track.naturalSize
            let pictureIn = AVAssetWriterInput(mediaType: .video, outputSettings: [
                AVVideoCodecKey: AVVideoCodecType.h264,
                AVVideoWidthKey: Int(size.width), AVVideoHeightKey: Int(size.height),
                AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: bitRate, AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel, AVVideoMaxKeyFrameIntervalDurationKey: 2]
            ])
            pictureIn.transform = track.preferredTransform
            guard writer.canAdd(pictureIn) else { return }
            writer.add(pictureIn)
            var pairs: [(AVAssetWriterInput, AVAssetReaderOutput)] = [(pictureIn, pictures)]
            if let soundTrack = asset.tracks(withMediaType: .audio).first, let hint = soundTrack.formatDescriptions.first {
                let sound = AVAssetReaderTrackOutput(track: soundTrack, outputSettings: nil) // the sound as it is
                let soundIn = AVAssetWriterInput(mediaType: .audio, outputSettings: nil, sourceFormatHint: (hint as! CMFormatDescription))
                if reader.canAdd(sound), writer.canAdd(soundIn) { reader.add(sound); writer.add(soundIn); pairs.append((soundIn, sound)) }
            }
            guard reader.startReading(), writer.startWriting() else { return }
            writer.startSession(atSourceTime: .zero)
            let group = DispatchGroup()
            for (index, pair) in pairs.enumerated() {
                group.enter()
                let lane = DispatchQueue(label: "reelcutter.shrink.\(index)")
                var finished = false
                pair.0.requestMediaDataWhenReady(on: lane) {
                    while !finished && pair.0.isReadyForMoreMediaData {
                        if let sample = pair.1.copyNextSampleBuffer(), pair.0.append(sample) { continue }
                        finished = true
                        pair.0.markAsFinished()
                        group.leave()
                    }
                }
            }
            guard group.wait(timeout: .now() + 600) == .success, reader.status == .completed else { reader.cancelReading(); writer.cancelWriting(); return }
            let done = DispatchSemaphore(value: 0)
            writer.finishWriting { done.signal() }
            _ = done.wait(timeout: .now() + 120)
            guard writer.status == .completed, fileSize(smaller) > 0, fileSize(smaller) < fileSize(file) else { try? FileManager.default.removeItem(at: smaller); return }
            try FileManager.default.removeItem(at: file)
            try FileManager.default.moveItem(at: smaller, to: file)
        } catch {
            try? FileManager.default.removeItem(at: smaller)
        }
    }

    // MARK: - A reel from clips already made (anyone's phone)

    /// Joins clips (web addresses of the team's uploaded clips, or files on the phone) into one reel with the outro card,
    /// optionally with new commentary lines laid over them, and hands back where it is so it can be shared or saved.
    ///   joinReel({ items: [{ url, voice?, voiceAt? }], introVoice?, outroVoice?, outro: { title, sub, color, ink }, file })
    ///     -> { path, size }
    /// Emits "progress" { stage: "fetch", i, n, p } while fetching the clips, then { stage: "reel", p }.
    @objc public func joinReel(_ call: CAPPluginCall) {
        guard let raw = call.options["items"] as? [[String: Any]], !raw.isEmpty else { call.reject("No clips to join"); return }
        let outro = call.options["outro"] as? [String: Any]
        let name = (call.getString("file") ?? "reel.mp4").replacingOccurrences(of: "/", with: "-")
        queue.async {
            do {
                let dir = try self.ensureWorkDir().appendingPathComponent("reel", isDirectory: true)
                try? FileManager.default.removeItem(at: dir)
                try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
                var lines = 0
                func voice(_ value: Any?) -> AVURLAsset? {
                    guard let text = value as? String, let data = Data(base64Encoded: text), data.count > 200 else { return nil }
                    lines += 1
                    let url = dir.appendingPathComponent(String(format: "line_%02d.mp3", lines))
                    do { try data.write(to: url) } catch { return nil }
                    return AVURLAsset(url: url)
                }
                var pieces: [Segment] = []
                var marks: [Any] = [] // where each item starts in the reel, in seconds (null for one left out), to skip to it
                var at = 0.0
                for (index, item) in raw.enumerated() {
                    guard let where_ = item["url"] as? String, !where_.isEmpty else { marks.append(NSNull()); continue }
                    var local: URL
                    if where_.hasPrefix("http") {
                        guard let remote = URL(string: where_) else { marks.append(NSNull()); continue }
                        local = dir.appendingPathComponent(String(format: "clip_%03d.mp4", index))
                        try self.fetch(remote, to: local) { p in
                            self.notifyListeners("progress", data: ["stage": "fetch", "i": index, "n": raw.count, "p": p])
                        }
                    } else {
                        local = URL(fileURLWithPath: where_)
                    }
                    let clip = AVURLAsset(url: local)
                    let length = CMTimeGetSeconds(clip.duration)
                    guard length.isFinite, length > 0.5 else { marks.append(NSNull()); continue }
                    marks.append(at)
                    at += length
                    let line = voice(item["voice"])
                    pieces.append(Segment(asset: clip, start: 0, dur: length, caption: "", voice: line, voiceAt: (item["voiceAt"] as? NSNumber)?.doubleValue ?? 0.7, voiced: line == nil))
                }
                guard !pieces.isEmpty else { throw CutError(message: "None of the clips could be fetched. Check your signal and try again.") }
                let out = dir.appendingPathComponent(name.hasSuffix(".mp4") ? name : name + ".mp4")
                try self.export(segments: pieces, watermark: "", outro: outro, to: out, intro: voice(call.options["introVoice"]), signOff: voice(call.options["outroVoice"])) { fraction in
                    self.notifyListeners("progress", data: ["stage": "reel", "i": 0, "n": 1, "p": fraction])
                }
                call.resolve(["path": out.path, "size": self.fileSize(out), "marks": marks])
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    /// Downloads a file, waiting for it (this runs on the cutting queue, never the main thread).
    private func fetch(_ remote: URL, to local: URL, progress: @escaping (Double) -> Void) throws {
        let done = DispatchSemaphore(value: 0)
        var failure: Error?
        let task = URLSession.shared.downloadTask(with: remote) { file, response, error in
            defer { done.signal() }
            if let error = error { failure = error; return }
            guard let file = file, ((response as? HTTPURLResponse)?.statusCode ?? 200) < 400 else { failure = CutError(message: "A clip couldn't be fetched (it may have been deleted)."); return }
            do { try? FileManager.default.removeItem(at: local); try FileManager.default.moveItem(at: file, to: local) } catch { failure = error }
        }
        let watch = task.progress.observe(\.fractionCompleted) { value, _ in progress(value.fractionCompleted) }
        task.resume()
        if done.wait(timeout: .now() + 300) == .timedOut { task.cancel(); watch.invalidate(); throw CutError(message: "Fetching the clips took too long. Check your signal and try again.") }
        watch.invalidate()
        if let failure = failure { throw failure }
    }

    private func fileSize(_ url: URL) -> Int {
        let attributes = try? FileManager.default.attributesOfItem(atPath: url.path)
        return (attributes?[.size] as? NSNumber)?.intValue ?? 0
    }

    /// Joins the given stretches of the source video into one file, drawing the watermark over all of it,
    /// each stretch's caption while it plays, and (for a reel) an outro card at the end.
    private func export(segments: [Segment], watermark: String, outro: [String: Any]?, to out: URL, intro: AVURLAsset? = nil, signOff: AVURLAsset? = nil,
                        look: ReelLook? = nil, progress: @escaping (Double) -> Void) throws {
        guard let firstAsset = segments.first?.asset, let firstVideo = firstAsset.tracks(withMediaType: .video).first else {
            throw CutError(message: ReelCutterPlugin.unreadable)
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
        var spans: [(at: Double, dur: Double, caption: String, bug: ReelBug?, lower: ReelLower?)] = []
        var placed: [(at: CMTime, track: AVAssetTrack)] = [] // which camera's footage starts where, for fitting each into the frame
        for segment in segments {
            guard let sourceVideo = segment.asset.tracks(withMediaType: .video).first else {
                throw CutError(message: ReelCutterPlugin.unreadable)
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
            spans.append((at: CMTimeGetSeconds(cursor), dur: dur, caption: segment.caption, bug: segment.bug, lower: segment.lower))
            placed.append((at: cursor, track: sourceVideo))
            if !segment.voiced { say(segment.voice, at: CMTimeGetSeconds(cursor) + segment.voiceAt, before: CMTimeGetSeconds(cursor) + dur) }
            else if segment.voice != nil { speechEnd = max(speechEnd, CMTimeGetSeconds(cursor) + segment.voiceAt + length(segment.voice) + 0.15) } // (keep the sign-off clear of it)
            cursor = CMTimeAdd(cursor, range.duration)
        }
        if let audio = audio, audio.segments.isEmpty { composition.removeTrack(audio) }
        let sourceVideo = firstVideo
        let total = CMTimeGetSeconds(firstAsset.duration)

        // The outro card is drawn over a few silent seconds of footage, which it covers completely.
        var outroAt: Double?
        if outro != nil, let first = segments.first {
            let dur = min(max(4.5, min(7, length(signOff) + 0.9)), total - 0.1) // long enough to read, and for the sign-off to be said
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

        if !watermark.isEmpty { parent.addSublayer(ReelGraphics.brand(watermark, u: unit, size: size, margin: margin)) }

        for span in spans {
            if let bug = span.bug, let look = look {
                parent.addSublayer(ReelGraphics.scoreBug(bug, look: look, from: span.at, dur: span.dur, u: unit, size: size, margin: margin))
            }
            if let lower = span.lower {
                parent.addSublayer(ReelGraphics.lowerThird(lower, look: look, from: span.at, dur: span.dur, u: unit, size: size, margin: margin))
            } else if !span.caption.isEmpty {
                let caption = pill(text: span.caption, fontSize: unit * 4.2, weight: .bold, maxWidth: size.width * 0.8, unit: unit)
                caption.frame.origin = CGPoint(x: margin, y: margin)
                show(caption, from: span.at, to: outroAt == nil && span.at + span.dur >= CMTimeGetSeconds(cursor) - 0.01 ? nil : span.at + span.dur)
                parent.addSublayer(caption)
            }
        }

        if let outro = outro, let outroAt = outroAt {
            let card = ReelGraphics.endCard(outro, at: outroAt, u: unit, size: size, margin: margin * 1.6)
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
        var best: Float = -1, movedAt = Date()
        while done.wait(timeout: .now() + 0.3) == .timedOut {
            progress(Double(session.progress))
            if session.progress > best + 0.001 { best = session.progress; movedAt = Date() }
            else if Date().timeIntervalSince(movedAt) > 180 { // three minutes without getting anywhere: it isn't going to
                session.cancelExport()
                _ = done.wait(timeout: .now() + 10)
                throw CutError(message: "It stopped making progress, so it was stopped. Keep Gaffer open on screen while it works, and try again.")
            }
        }
        guard session.status == .completed else {
            if session.status == .cancelled { throw CutError(message: "It was stopped before it finished. Keep Gaffer open on screen while it works.") }
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

    static let unreadable = "Gaffer can't open that video any more. Go back to the cameras, choose it again with Change video, and cut straight away. If it still won't open, check it plays in the Photos app."

    /// Which of these videos can't be opened (so it's found out before any commentary is recorded): { bad: [path] }.
    @objc public func readable(_ call: CAPPluginCall) {
        let paths = call.getArray("paths", String.self) ?? []
        queue.async {
            let bad = paths.filter { path in
                let video = self.picked[path] ?? AVURLAsset(url: URL(fileURLWithPath: path))
                return video.tracks(withMediaType: .video).isEmpty
            }
            call.resolve(["bad": bad])
        }
    }

    /// The share sheet for a message and a link (the link to a game's highlights, for the guests who played in it).
    @objc public func shareText(_ call: CAPPluginCall) {
        var items: [Any] = []
        if let text = call.getString("text"), !text.isEmpty { items.append(text) }
        if let link = call.getString("url"), let url = URL(string: link) { items.append(url) }
        guard !items.isEmpty else { call.reject("Nothing to share"); return }
        DispatchQueue.main.async {
            guard let host = self.bridge?.viewController else { call.reject("Couldn't open the share sheet"); return }
            let sheet = UIActivityViewController(activityItems: items, applicationActivities: nil)
            sheet.popoverPresentationController?.sourceView = host.view
            sheet.completionWithItemsHandler = { _, completed, _, _ in call.resolve(["completed": completed]) }
            host.present(sheet, animated: true)
        }
    }

    @objc public func cleanup(_ call: CAPPluginCall) {
        try? FileManager.default.removeItem(at: workDir)
        call.resolve()
    }
}
