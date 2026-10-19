import AVFoundation
import Capacitor
import CoreImage
import Foundation
import Photos
import PhotosUI
import UIKit
import UniformTypeIdentifiers

/// Cuts highlight clips out of a match video, on the phone.
///
/// JS calls, in order:
///   pickVideo()  -> { path, duration, created? }   the person picks the recording from Photos
///   fetchVideo({ url, key, size? })  -> { path, duration, created? }   or downloads it (a GoPro share link's video, the
///                                                  address from the gopro-link edge function), carrying on in the
///                                                  background; "progress" events { stage: "download", p }
///   cut({ path, clips: [{ start, dur, caption, file, bug?, lower? }], watermark, look?, outro: { kicker, title, sub, color, ink, crest }, reelFile, reelCleanFile?, quality? })
///                (quality "4k": the Gaffer tier's sharp clips, 4K from 4K footage, else 1080p; see `sharpness`)
///                -> { clips: [{ file, path, size }], reel: { path, size, marks }, reelClean?: { path, size, marks } }
///   share({ path })                                the share sheet (save to Photos, send to a chat)
///   shareText({ text, url })                       the share sheet for a message with a link
///   joinReel({ items: [{ url, voice?, voiceAt? }], outro, file })   a reel from clips already made -> { path, size, marks }
///   relabel({ url, lower, look?, voice?, voiceAt?, file })   a goal put right after the clips were made: that one clip
///                                                  again, its bar along the bottom drawn over with the right names
///                                                  (lower.over is the old bar), and with a new commentary line if one
///                                                  is sent -> { path, size, voiced?: { path, size } }
///   upload({ path, url, contentType? })            sends a file to an upload link in the background (it carries on with
///                                                  the app put away or closed) -> { status, ok }; "upload" events { p }
///   beatEdit({ items: [{ url }], music, loop, segs, fx, len, outroAt, outro, file })   a beat edit cut to one of Gaffer's own
///                                                  tracks, tall for Instagram, exactly as JS planned it (beatPlan in
///                                                  index.html) -> { path, size }; "progress" { stage: "fetch" | "beat" | "card", p }
///   bgStart({ title, subtitle }) -> { started }    iOS's own progress card (iOS 26 and later) while highlights are cut, so
///                                                  the cut carries on with Gaffer put away (ContinuedWork.swift); started
///                                                  is false on an older iOS or if iOS says no. bgUpdate({ title?, subtitle, p })
///                                                  keeps it up to date and bgEnd({ ok }) takes it away. Stopped from the
///                                                  card: the cut stops at its next clip or export and a "bg" event
///                                                  { state: "stopped" } is sent
///   cleanup()                                      deletes the working files
/// While working it emits "progress" events: { stage: "copy" | "cut" | "reel", i, n, p }.
@objc(ReelCutterPlugin)
public class ReelCutterPlugin: CAPPlugin, CAPBridgedPlugin, PHPickerViewControllerDelegate {
    public let identifier = "ReelCutterPlugin"
    public let jsName = "ReelCutter"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "pickVideo", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "fetchVideo", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cut", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "share", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "joinReel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "shareText", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "upload", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "relabel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "beatEdit", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "bgStart", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "bgUpdate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "bgEnd", returnType: CAPPluginReturnPromise),
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

    /// A match video downloaded instead of picked from Photos (from a GoPro share link: the gopro-link edge function gives
    /// the address). iOS's background transfer service fetches it, so it keeps going with Gaffer put away; the same `key`
    /// again joins a download already going, or hands back the file if it's already here.
    @objc public func fetchVideo(_ call: CAPPluginCall) {
        guard let link = call.getString("url"), let url = URL(string: link), let key = call.getString("key"),
              key.range(of: "^[A-Za-z0-9_-]{1,80}$", options: .regularExpression) != nil else {
            call.reject("That video's address didn't come through. Paste the link again."); return
        }
        let downloads = BackgroundDownloads.shared
        let need = Int64(call.getDouble("size") ?? 0)
        if need > 0, !FileManager.default.fileExists(atPath: downloads.file(key).path),
           let free = try? downloads.folder.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey]).volumeAvailableCapacityForImportantUsage,
           free < need + 500_000_000 {
            let gb = { (n: Int64) in String(format: "%.1f GB", Double(n) / 1_000_000_000) }
            call.reject("That video is \(gb(need)) and this phone only has \(gb(max(0, free))) free. Free up some space (or share just the half you need from GoPro Quik) and try again.")
            return
        }
        downloads.progress = { [weak self] k, p in if k == key { self?.notifyListeners("progress", data: ["stage": "download", "p": p]) } }
        notifyListeners("progress", data: ["stage": "download", "p": 0])
        downloads.start(url, key: key) { file, error in
            guard let file = file else { call.reject(error ?? "The download stopped."); return }
            let asset = AVURLAsset(url: file)
            let seconds = CMTimeGetSeconds(asset.duration)
            guard seconds.isFinite, seconds > 0 else {
                try? FileManager.default.removeItem(at: file)
                call.reject("What GoPro sent isn't a video Gaffer can open. Check it plays in GoPro Quik, then try again.")
                return
            }
            var result: [String: Any] = ["path": file.path, "duration": seconds]
            if let made = asset.creationDate?.dateValue { result["created"] = made.timeIntervalSince1970 * 1000 }
            call.resolve(result)
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
        let sharp = call.getString("quality") == "4k"

        var spare: UIBackgroundTaskIdentifier = .invalid
        let begin = { spare = UIApplication.shared.beginBackgroundTask(withName: "Cutting highlights") { UIApplication.shared.endBackgroundTask(spare) } }
        if Thread.isMainThread { begin() } else { DispatchQueue.main.sync(execute: begin) } // (a little time to finish if the phone is locked mid-cut)
        let finished = { DispatchQueue.main.async { if spare != .invalid { UIApplication.shared.endBackgroundTask(spare); spare = .invalid } } }
        queue.async {
            self.stopForget("cut") // (a stop from an earlier cut's card doesn't carry over)
            self.stopNow = { self.stopAsked("cut") } // (stopped from iOS's progress card: bgStart)
            defer { finished(); self.stopNow = nil; self.stopForget("cut") }
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
                    try self.checkStop()
                    let out = dir.appendingPathComponent(files[index])
                    var clean = segment
                    clean.voice = nil
                    let size = ReelCutterPlugin.sharpness(segment.asset, sharp: sharp)
                    try self.export(segments: [clean], watermark: watermark, outro: nil, to: out, look: look, preset: size.preset) { fraction in
                        self.notifyListeners("progress", data: ["stage": "cut", "i": index, "n": segments.count, "p": segment.voice == nil ? fraction : fraction / 2])
                    }
                    self.shrink(out, bitRate: size.bitRate)
                    var entry: [String: Any] = ["file": files[index], "path": out.path, "size": self.fileSize(out)]
                    if segment.voice != nil {
                        let name = (files[index] as NSString).deletingPathExtension + "v.mp4"
                        let voicedOut = dir.appendingPathComponent(name)
                        do {
                            try self.export(segments: [segment], watermark: watermark, outro: nil, to: voicedOut, look: look, preset: size.preset) { fraction in
                                self.notifyListeners("progress", data: ["stage": "cut", "i": index, "n": segments.count, "p": 0.5 + fraction / 2])
                            }
                            self.shrink(voicedOut, bitRate: size.bitRate)
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
                        let size = ReelCutterPlugin.sharpness(pieces[0].asset, sharp: true) // (as sharp as the clips just made)
                        try self.export(segments: pieces, watermark: "", outro: outro, to: out, intro: withVoices ? intro : nil, signOff: withVoices ? signOff : nil, preset: size.preset) { fraction in
                            self.notifyListeners("progress", data: ["stage": "reel", "i": 0, "n": 1, "p": from + fraction * share])
                        }
                        self.shrink(out, bitRate: size.bitRate) // (it's uploaded for the team to watch, like the clips)
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
    /// Emits "progress" { stage: "fetch", i, n, p, job } while fetching the clips, then { stage: "reel", p, job } (`job`: the call's own).
    /// Cancel on a reel or beat edit being made (Ethan asked): `cancel({job})` names the `job` it was started with. A job
    /// still waiting on the queue is stopped before it starts; one under way stops at its next clip or its export.
    private let stopLock = NSLock()
    private var stopJobs = Set<String>()
    /// Asked by `run` and the clip fetching while a job is under way (only touched on `queue`, one job at a time).
    private var stopNow: (() -> Bool)?
    @objc public func bgStart(_ call: CAPPluginCall) {
        let title = call.getString("title") ?? "Cutting highlights", subtitle = call.getString("subtitle") ?? ""
        ContinuedWork.shared.onStop = { [weak self] in
            guard let self = self else { return }
            self.stopLock.lock(); self.stopJobs.insert("cut"); self.stopLock.unlock()
            self.notifyListeners("bg", data: ["state": "stopped"])
        }
        DispatchQueue.main.async {
            let started = ContinuedWork.shared.start(prefix: (Bundle.main.bundleIdentifier ?? "") + ".work", title: title, subtitle: subtitle)
            call.resolve(["started": started])
        }
    }
    @objc public func bgUpdate(_ call: CAPPluginCall) {
        ContinuedWork.shared.update(title: call.getString("title"), subtitle: call.getString("subtitle") ?? "", p: call.getDouble("p") ?? 0)
        call.resolve()
    }
    @objc public func bgEnd(_ call: CAPPluginCall) {
        ContinuedWork.shared.end(ok: call.getBool("ok") ?? false)
        call.resolve()
    }
    @objc public func cancel(_ call: CAPPluginCall) {
        let job = call.getString("job") ?? ""
        guard !job.isEmpty else { call.reject("Nothing to stop"); return }
        stopLock.lock(); stopJobs.insert(job); stopLock.unlock()
        call.resolve()
    }
    private func stopAsked(_ job: String) -> Bool {
        guard !job.isEmpty else { return false }
        stopLock.lock(); defer { stopLock.unlock() }
        return stopJobs.contains(job)
    }
    private func stopForget(_ job: String) { stopLock.lock(); stopJobs.remove(job); stopLock.unlock() }
    private func checkStop() throws { if stopNow?() == true { throw CutError(message: "Stopped. Nothing was made.") } }

    @objc public func joinReel(_ call: CAPPluginCall) {
        guard let raw = call.options["items"] as? [[String: Any]], !raw.isEmpty else { call.reject("No clips to join"); return }
        let outro = call.options["outro"] as? [String: Any]
        let name = (call.getString("file") ?? "reel.mp4").replacingOccurrences(of: "/", with: "-")
        let tag = call.getString("job") ?? "" // (said back with its progress, so two joins waiting on each other don't mix their words)
        var spare: UIBackgroundTaskIdentifier = .invalid
        let begin = { spare = UIApplication.shared.beginBackgroundTask(withName: "Joining a reel") { UIApplication.shared.endBackgroundTask(spare) } }
        if Thread.isMainThread { begin() } else { DispatchQueue.main.sync(execute: begin) } // (time to finish if the app is put away)
        let finished = { DispatchQueue.main.async { if spare != .invalid { UIApplication.shared.endBackgroundTask(spare); spare = .invalid } } }
        queue.async {
            defer { finished(); self.stopNow = nil; self.stopForget(tag) }
            self.stopNow = { self.stopAsked(tag) }
            var job: URL?
            do {
                try self.checkStop()
                let dir = try WorkFolders.fresh("reel", in: self.ensureWorkDir()) // (its own: another join must never delete this one's video)
                job = dir
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
                    try self.checkStop()
                    guard let where_ = item["url"] as? String, !where_.isEmpty else { marks.append(NSNull()); continue }
                    var local: URL
                    if where_.hasPrefix("http") {
                        guard let remote = URL(string: where_) else { marks.append(NSNull()); continue }
                        local = dir.appendingPathComponent(String(format: "clip_%03d.mp4", index))
                        try self.fetch(remote, to: local) { p in
                            self.notifyListeners("progress", data: ["stage": "fetch", "i": index, "n": raw.count, "p": p, "job": tag])
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
                let size = ReelCutterPlugin.sharpness(pieces[0].asset, sharp: true) // (4K clips stay 4K in the reel; the usual ones as before)
                try self.export(segments: pieces, watermark: "", outro: outro, to: out, intro: voice(call.options["introVoice"]), signOff: voice(call.options["outroVoice"]), preset: size.preset) { fraction in
                    self.notifyListeners("progress", data: ["stage": "reel", "i": 0, "n": 1, "p": fraction, "job": tag])
                }
                if call.getBool("shrink") ?? false { self.shrink(out, bitRate: size.bitRate) } // (one that's uploaded for the team to watch, like the cut's reel)
                WorkFolders.tidy(dir, keeping: [out]) // (the fetched clips aren't needed any more)
                call.resolve(["path": out.path, "size": self.fileSize(out), "marks": marks])
            } catch {
                if let job = job { try? FileManager.default.removeItem(at: job) }
                call.reject(error.localizedDescription)
            }
        }
    }

    /// One clip made again after a goal was put right (who scored or set it up): the finished clip, fetched from its
    /// address, with the new bar along the bottom drawn over the old one at the same moment, so nothing else about it
    /// changes and the rest of the game's clips are left alone. With a commentary line, a second copy has it spoken over.
    @objc public func relabel(_ call: CAPPluginCall) {
        guard let link = call.getString("url"), !link.isEmpty, let lower = ReelGraphics.lower(call.options["lower"]) else {
            call.reject("Nothing to put right"); return
        }
        let look = ReelGraphics.look(call.options["look"])
        let name = (call.getString("file") ?? "fixed.mp4").replacingOccurrences(of: "/", with: "-")
        let voiceAt = (call.options["voiceAt"] as? NSNumber)?.doubleValue ?? 0.7
        var spare: UIBackgroundTaskIdentifier = .invalid
        let begin = { spare = UIApplication.shared.beginBackgroundTask(withName: "Putting a clip right") { UIApplication.shared.endBackgroundTask(spare) } }
        if Thread.isMainThread { begin() } else { DispatchQueue.main.sync(execute: begin) }
        let finished = { DispatchQueue.main.async { if spare != .invalid { UIApplication.shared.endBackgroundTask(spare); spare = .invalid } } }
        queue.async {
            defer { finished() }
            do {
                let dir = try self.ensureWorkDir().appendingPathComponent("fix", isDirectory: true)
                try? FileManager.default.removeItem(at: dir)
                try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
                let local: URL
                if link.hasPrefix("http") {
                    guard let remote = URL(string: link) else { throw CutError(message: "That clip's address isn't right.") }
                    local = dir.appendingPathComponent("was.mp4")
                    try self.fetch(remote, to: local) { p in self.notifyListeners("progress", data: ["stage": "fetch", "i": 0, "n": 1, "p": p]) }
                } else {
                    local = URL(fileURLWithPath: link)
                }
                let clip = AVURLAsset(url: local)
                let length = CMTimeGetSeconds(clip.duration)
                guard length.isFinite, length > 0.5 else { throw CutError(message: "That clip couldn't be read. Check your signal and try again.") }
                var plain = Segment(asset: clip, start: 0, dur: length, caption: "")
                plain.lower = lower
                let base = (name as NSString).deletingPathExtension
                let out = dir.appendingPathComponent(base + ".mp4")
                let size = ReelCutterPlugin.sharpness(clip, sharp: true) // (a 4K clip is put right in 4K)
                try self.export(segments: [plain], watermark: "", outro: nil, to: out, look: look, preset: size.preset) { fraction in
                    self.notifyListeners("progress", data: ["stage": "fix", "i": 0, "n": 1, "p": fraction])
                }
                self.shrink(out, bitRate: size.bitRate)
                var result: [String: Any] = ["path": out.path, "size": self.fileSize(out)]
                if let text = call.getString("voice"), let data = Data(base64Encoded: text), data.count > 200 {
                    let line = dir.appendingPathComponent("line.mp3")
                    try data.write(to: line)
                    var spoken = plain
                    spoken.voice = AVURLAsset(url: line)
                    spoken.voiceAt = voiceAt
                    let voicedOut = dir.appendingPathComponent(base + "v.mp4")
                    do {
                        try self.export(segments: [spoken], watermark: "", outro: nil, to: voicedOut, look: look, preset: size.preset) { _ in }
                        self.shrink(voicedOut, bitRate: size.bitRate)
                        result["voiced"] = ["path": voicedOut.path, "size": self.fileSize(voicedOut)]
                    } catch {} // (the clip without commentary is still put right)
                }
                call.resolve(result)
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    // MARK: - A beat edit (anyone's phone)

    /// The team's clips cut to one of Gaffer's own tracks (bundled with the web files, public/music), tall for Instagram:
    /// every stretch exactly where JS planned it (on the beat, sped up or slowed down), the effects drawn over each frame,
    /// the music under it all, then the end card over the last bars while the music plays out.
    @objc public func beatEdit(_ call: CAPPluginCall) {
        guard let raw = call.options["items"] as? [[String: Any]], !raw.isEmpty,
              let plan = BeatPlan.parse(segs: call.options["segs"] as? [[String: Any]] ?? [], fx: call.options["fx"] as? [[String: Any]] ?? [],
                                        len: (call.options["len"] as? NSNumber)?.doubleValue ?? 0, outroAt: (call.options["outroAt"] as? NSNumber)?.doubleValue ?? 0) else {
            call.reject("Nothing to make the edit from"); return
        }
        let track = (call.getString("music") ?? "").filter { $0.isLetter || $0.isNumber || $0 == "-" }
        guard !track.isEmpty, let music = Bundle.main.url(forResource: track, withExtension: "m4a", subdirectory: "public/music") else {
            call.reject("That track isn't in this version of Gaffer. Update the app from TestFlight or the App Store and try again."); return
        }
        let outro = call.options["outro"] as? [String: Any]
        // the bars of the music to play again so every moment fits (JS beatFit): from and to in seconds, how many times
        let loopRaw = call.options["loop"] as? [String: Any]
        let loop = loopRaw.flatMap { raw -> (from: Double, to: Double, times: Int)? in
            guard let from = (raw["from"] as? NSNumber)?.doubleValue, let to = (raw["to"] as? NSNumber)?.doubleValue,
                  let times = (raw["times"] as? NSNumber)?.intValue, times > 0, times <= 12, to > from + 0.5, from >= 0 else { return nil }
            return (from, to, times)
        }
        let name = (call.getString("file") ?? "beat-edit.mp4").replacingOccurrences(of: "/", with: "-")
        let tag = call.getString("job") ?? ""
        var spare: UIBackgroundTaskIdentifier = .invalid
        let begin = { spare = UIApplication.shared.beginBackgroundTask(withName: "Making a beat edit") { UIApplication.shared.endBackgroundTask(spare) } }
        if Thread.isMainThread { begin() } else { DispatchQueue.main.sync(execute: begin) }
        let finished = { DispatchQueue.main.async { if spare != .invalid { UIApplication.shared.endBackgroundTask(spare); spare = .invalid } } }
        queue.async {
            defer { finished(); self.stopNow = nil; self.stopForget(tag) }
            self.stopNow = { self.stopAsked(tag) }
            do {
                try self.checkStop()
                let dir = try self.ensureWorkDir().appendingPathComponent("beat", isDirectory: true)
                try? FileManager.default.removeItem(at: dir)
                try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
                var clips: [AVURLAsset] = []
                for (index, item) in raw.enumerated() {
                    try self.checkStop()
                    guard let where_ = item["url"] as? String, !where_.isEmpty else { throw CutError(message: "A clip is missing. Pull down to refresh and try again.") }
                    var local = URL(fileURLWithPath: where_)
                    if where_.hasPrefix("http") {
                        guard let remote = URL(string: where_) else { throw CutError(message: "A clip's address isn't right.") }
                        local = dir.appendingPathComponent(String(format: "clip_%03d.mp4", index))
                        try self.fetch(remote, to: local) { p in self.notifyListeners("progress", data: ["stage": "fetch", "i": index, "n": raw.count, "p": p]) }
                    }
                    clips.append(AVURLAsset(url: local))
                }
                let cut = dir.appendingPathComponent("cut.mp4")
                try self.beatPass(plan, clips: clips, music: AVURLAsset(url: music), loop: loop, to: cut) { p in
                    self.notifyListeners("progress", data: ["stage": "beat", "i": 0, "n": 1, "p": p])
                }
                let out = dir.appendingPathComponent(name.hasSuffix(".mp4") ? name : name + ".mp4")
                if let outro = outro {
                    let made = AVURLAsset(url: cut)
                    let length = CMTimeGetSeconds(made.duration)
                    try self.export(segments: [Segment(asset: made, start: 0, dur: length, caption: "", voiced: true)], watermark: "", outro: outro, to: out,
                                    outroOver: max(1, length - plan.outroAt), preset: AVAssetExportPresetHighestQuality) { p in
                        self.notifyListeners("progress", data: ["stage": "card", "i": 0, "n": 1, "p": p])
                    }
                } else {
                    try FileManager.default.moveItem(at: cut, to: out)
                }
                self.shrink(out, bitRate: 4_000_000)
                call.resolve(["path": out.path, "size": self.fileSize(out)])
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    /// The edit itself: each stretch of each clip put where the plan says and squeezed or stretched to fit (so every cut
    /// is on the beat), the music laid under it, and every frame drawn tall with the plan's zooms, shakes and flashes.
    private func beatPass(_ plan: BeatPlan, clips: [AVURLAsset], music: AVURLAsset, loop: (from: Double, to: Double, times: Int)? = nil, to out: URL, progress: @escaping (Double) -> Void) throws {
        let composition = AVMutableComposition()
        guard let video = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid) else {
            throw CutError(message: "Couldn't set up the video")
        }
        let scale: CMTimeScale = 6000
        var cursor = CMTime.zero
        for seg in plan.segs {
            guard seg.i >= 0, seg.i < clips.count, let source = clips[seg.i].tracks(withMediaType: .video).first else {
                throw CutError(message: "A clip couldn't be read. Check your signal and try again.")
            }
            let total = CMTimeGetSeconds(clips[seg.i].duration)
            guard total.isFinite, total > 0.2 else { throw CutError(message: "A clip couldn't be read. Check your signal and try again.") }
            let from = max(0, min(seg.from, total - 0.1))
            let range = CMTimeRange(start: CMTime(seconds: from, preferredTimescale: scale), duration: CMTime(seconds: max(0.05, min(seg.len, total - from)), preferredTimescale: scale))
            try video.insertTimeRange(range, of: source, at: cursor)
            // where this stretch ends comes from the plan, not from adding up, so rounding never pushes a cut off the beat
            let end = CMTime(seconds: seg.t + seg.out, preferredTimescale: scale)
            let want = CMTimeSubtract(end, cursor)
            if CMTimeCompare(want, .zero) > 0 {
                video.scaleTimeRange(CMTimeRange(start: cursor, duration: range.duration), toDuration: want)
                cursor = end
            } else {
                cursor = CMTimeAdd(cursor, range.duration)
            }
        }
        if let audio = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) {
            guard let tune = music.tracks(withMediaType: .audio).first else { throw CutError(message: "The music couldn't be read. Update the app and try again.") }
            if let loop = loop, loop.to < CMTimeGetSeconds(music.duration) {
                // the track up to the end of its drop, the drop again as many times as the plan needs, then the rest
                let at = { (s: Double) in CMTime(seconds: s, preferredTimescale: 44100) }
                var place = CMTime.zero
                var parts = [CMTimeRange(start: .zero, end: at(loop.to))]
                for _ in 0..<loop.times { parts.append(CMTimeRange(start: at(loop.from), end: at(loop.to))) }
                parts.append(CMTimeRange(start: at(loop.to), end: music.duration))
                for part in parts { try audio.insertTimeRange(part, of: tune, at: place); place = CMTimeAdd(place, part.duration) }
                if CMTimeCompare(place, cursor) > 0 { audio.removeTimeRange(CMTimeRange(start: cursor, end: place)) }
            } else {
                try audio.insertTimeRange(CMTimeRange(start: .zero, duration: CMTimeMinimum(music.duration, cursor)), of: tune, at: .zero)
            }
        }
        let frame = CGRect(x: 0, y: 0, width: 720, height: 1280)
        let videoComposition = AVMutableVideoComposition(asset: composition) { request in
            let look = plan.frame(at: CMTimeGetSeconds(request.compositionTime))
            request.finish(with: ReelCutterPlugin.beatDraw(request.sourceImage, look: look, in: frame), context: nil)
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

    /// One frame of a beat edit: the clip across the width, zoomed and shaken as planned, over a blurred, darker copy of
    /// itself filling the tall frame; black and white or with the colour turned up; then any blur and flash.
    static func beatDraw(_ source: CIImage, look: BeatFrame, in frame: CGRect) -> CIImage {
        let picture = source.transformed(by: CGAffineTransform(translationX: -source.extent.minX, y: -source.extent.minY))
        let w = picture.extent.width, h = picture.extent.height
        guard w > 1, h > 1, w.isFinite, h.isFinite else { return CIImage(color: CIColor.black).cropped(to: frame) }
        let fill = max(frame.width / w, frame.height / h) * 1.08
        let back = picture.transformed(by: CGAffineTransform(scaleX: fill, y: fill))
            .transformed(by: CGAffineTransform(translationX: (frame.width - w * fill) / 2, y: (frame.height - h * fill) / 2))
            .clampedToExtent().applyingGaussianBlur(sigma: 28).cropped(to: frame)
            .applyingFilter("CIColorControls", parameters: [kCIInputBrightnessKey: -0.18, kCIInputSaturationKey: 1.1])
        let s = frame.width / w * CGFloat(look.zoom)
        let x = (frame.width - w * s) / 2 + CGFloat(look.dx) * frame.width
        let y = (frame.height - h * s) / 2 + CGFloat(look.dy) * frame.width
        let front = picture.transformed(by: CGAffineTransform(scaleX: s, y: s)).transformed(by: CGAffineTransform(translationX: x, y: y))
        var image = front.composited(over: back).cropped(to: frame)
        image = look.mono ? image.applyingFilter("CIPhotoEffectNoir")
            : image.applyingFilter("CIColorControls", parameters: [kCIInputSaturationKey: 1.18, kCIInputContrastKey: 1.08])
        image = image.applyingFilter("CIVignette", parameters: [kCIInputIntensityKey: 0.8, kCIInputRadiusKey: 1.4]).cropped(to: frame)
        if look.blur > 0.01 { image = image.clampedToExtent().applyingGaussianBlur(sigma: look.blur * 24).cropped(to: frame) }
        if look.flash > 0.01 { // towards white: each colour c becomes c * (1 - f) + f
            let f = CGFloat(min(1, look.flash))
            image = image.applyingFilter("CIColorMatrix", parameters: [
                "inputRVector": CIVector(x: 1 - f, y: 0, z: 0, w: 0), "inputGVector": CIVector(x: 0, y: 1 - f, z: 0, w: 0),
                "inputBVector": CIVector(x: 0, y: 0, z: 1 - f, w: 0), "inputAVector": CIVector(x: 0, y: 0, z: 0, w: 1),
                "inputBiasVector": CIVector(x: f, y: f, z: f, w: 0)
            ])
        }
        return image
    }

    /// Sends a finished file to its upload link through iOS's background transfer service, so it keeps going when the
    /// app is put away or closed (a whole match's reel can take minutes on mobile data).
    @objc public func upload(_ call: CAPPluginCall) {
        guard let path = call.getString("path"), let link = call.getString("url"), let url = URL(string: link) else {
            call.reject("Nothing to upload"); return
        }
        let uploads = BackgroundUploads.shared
        uploads.progress = { [weak self] _, p in self?.notifyListeners("upload", data: ["p": p]) }
        do {
            _ = try uploads.start(file: URL(fileURLWithPath: path), to: url, contentType: call.getString("contentType") ?? "video/mp4") { status, error in
                if let error = error { call.reject("The upload stopped: " + error) }
                else { call.resolve(["status": status, "ok": (200..<300).contains(status)]) }
            }
        } catch {
            call.reject("That file couldn't be got ready to upload: " + error.localizedDescription)
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
    /// `outroOver`: the end card covers the last that many seconds of the footage instead of being added after it (a beat
    /// edit, whose music carries on under the card).
    private func export(segments: [Segment], watermark: String, outro: [String: Any]?, to out: URL, intro: AVURLAsset? = nil, signOff: AVURLAsset? = nil,
                        look: ReelLook? = nil, outroOver: Double? = nil, preset: String = AVAssetExportPreset960x540, progress: @escaping (Double) -> Void) throws {
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
        if outro != nil, let over = outroOver {
            outroAt = max(0, CMTimeGetSeconds(cursor) - over)
        } else if outro != nil, let first = segments.first {
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
        guard let session = AVAssetExportSession(asset: composition, presetName: preset) else {
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
        try run(session, progress: progress)
    }

    /// Runs an export to the end, reporting how far it's got, and stops it if it gets nowhere for three minutes.
    private func run(_ session: AVAssetExportSession, progress: @escaping (Double) -> Void) throws {
        let done = DispatchSemaphore(value: 0)
        session.exportAsynchronously { done.signal() }
        var best: Float = -1, movedAt = Date()
        while done.wait(timeout: .now() + 0.3) == .timedOut {
            if stopNow?() == true { // (Cancel was tapped)
                session.cancelExport()
                _ = done.wait(timeout: .now() + 10)
                throw CutError(message: "Stopped. Nothing was made.")
            }
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

    /// How big a clip is made. Usually 960×540 at about 2 Mbit/s (small to keep and quick to watch). With `sharp` (the
    /// Gaffer tier's 4K, Ethan, October 2026; and when joining or putting right clips that were made that way, which are
    /// bigger than 960 across): 4K at about 16 Mbit/s from footage bigger than 1080p, else 1080p at about 6 Mbit/s.
    static func sharpness(_ asset: AVAsset, sharp: Bool) -> (preset: String, bitRate: Int) {
        let usual = (preset: AVAssetExportPreset960x540, bitRate: 2_000_000)
        guard sharp, let track = asset.tracks(withMediaType: .video).first else { return usual }
        let box = upright(track), long = max(abs(box.width), abs(box.height))
        if long > 1920 { return (preset: AVAssetExportPreset3840x2160, bitRate: 16_000_000) }
        if long > 960 { return (preset: AVAssetExportPreset1920x1080, bitRate: 6_000_000) }
        return usual
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
