import AVFoundation
import Capacitor
import Foundation
import UIKit

/// Your own commentary over a highlight reel: the microphone, while the reel plays on screen, then your voice laid over
/// the reel with the game's own sound turned down while you talk (VoiceSpans.swift says when that is).
///
/// JS calls, in order:
///   permission()  -> { state: "granted" | "denied" | "ask" }
///   prepare()     -> { ok }            asks for the microphone if it hasn't been yet (rejects with code "denied"), and
///                                      gets the recorder ready, so recording starts the moment the count-in ends
///   start()       -> { at }            records; `at` is when it started (ms since 1970), to line the reel up with it
///   level()       -> { level }         0 to 1, how loud it is now (for the meter)
///   stop()        -> { path, dur, spans: [{ from, to }] }   the take, and when there was talking in it
///   discard()                          stops without keeping anything
///   mix({ path, voice, lead, spans, file, job })  -> { path, size }   the reel with the voice over it: `lead` is how far
///                                      into the recording the reel started playing; "progress" events { p, job }
///   settings()                         opens Gaffer's page in the Settings app (the microphone switch is there)
@objc(VoiceOverPlugin)
public class VoiceOverPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "VoiceOverPlugin"
    public let jsName = "VoiceOver"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "permission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "prepare", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "level", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "discard", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "mix", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "settings", returnType: CAPPluginReturnPromise)
    ]

    private let step = 0.05 // how often the level is read, in seconds
    private var recorder: AVAudioRecorder?
    private var meter: Timer?
    private var levels: [Float] = []
    private var latest: Float = 0
    private var prior: (category: AVAudioSession.Category, mode: AVAudioSession.Mode, options: AVAudioSession.CategoryOptions)?
    private let work = DispatchQueue(label: "voiceover.mix", qos: .userInitiated)

    private func folder() throws -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("voiceover", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    private enum Mic { case granted, denied, ask }
    private func mic() -> Mic {
        if #available(iOS 17.0, *) {
            switch AVAudioApplication.shared.recordPermission {
            case .granted: return .granted
            case .denied: return .denied
            default: return .ask
            }
        }
        switch AVAudioSession.sharedInstance().recordPermission {
        case .granted: return .granted
        case .denied: return .denied
        default: return .ask
        }
    }
    private func askMic(_ done: @escaping (Bool) -> Void) {
        if #available(iOS 17.0, *) { AVAudioApplication.requestRecordPermission { ok in DispatchQueue.main.async { done(ok) } } }
        else { AVAudioSession.sharedInstance().requestRecordPermission { ok in DispatchQueue.main.async { done(ok) } } }
    }

    @objc public func permission(_ call: CAPPluginCall) {
        switch mic() {
        case .granted: call.resolve(["state": "granted"])
        case .denied: call.resolve(["state": "denied"])
        case .ask: call.resolve(["state": "ask"])
        }
    }

    @objc public func prepare(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let ready = {
                do { try self.makeRecorder(); call.resolve(["ok": true]) }
                catch { self.restoreSession(); call.reject("The microphone couldn't be started: \(error.localizedDescription)", "failed") }
            }
            switch self.mic() {
            case .granted: ready()
            case .denied: call.reject("Gaffer isn't allowed to use the microphone.", "denied")
            case .ask: self.askMic { ok in if ok { ready() } else { call.reject("Gaffer isn't allowed to use the microphone.", "denied") } }
            }
        }
    }

    private func makeRecorder() throws {
        stopMeter()
        recorder?.stop()
        let session = AVAudioSession.sharedInstance()
        if prior == nil { prior = (session.category, session.mode, session.categoryOptions) }
        // Play and record: the reel plays (muted) while you talk. Bluetooth headsets' microphones are allowed, and the
        // speaker (not the earpiece) is used for anything played.
        try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetooth])
        try session.setActive(true)
        let url = try folder().appendingPathComponent("take-\(Int(Date().timeIntervalSince1970 * 1000)).m4a")
        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 44_100,
            AVNumberOfChannelsKey: 1,
            AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue
        ]
        let made = try AVAudioRecorder(url: url, settings: settings)
        made.isMeteringEnabled = true
        guard made.prepareToRecord() else { throw NSError(domain: "VoiceOver", code: 1, userInfo: [NSLocalizedDescriptionKey: "the recorder couldn't get ready"]) }
        recorder = made
    }

    @objc public func start(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if self.recorder == nil { do { try self.makeRecorder() } catch { call.reject("The microphone couldn't be started: \(error.localizedDescription)", "failed"); return } }
            guard let recorder = self.recorder, recorder.record() else {
                self.restoreSession()
                call.reject("The microphone couldn't be started. If another app is using it (a call, or a voice note), close that and try again.", "failed")
                return
            }
            let at = Date().timeIntervalSince1970 * 1000
            self.levels = []
            self.latest = 0
            let timer = Timer(timeInterval: self.step, repeats: true) { [weak self] _ in self?.read() }
            RunLoop.main.add(timer, forMode: .common)
            self.meter = timer
            call.resolve(["at": at])
        }
    }

    private func read() {
        guard let recorder = recorder, recorder.isRecording else { return }
        recorder.updateMeters()
        let power = recorder.averagePower(forChannel: 0)
        levels.append(power)
        latest = Float(max(0, min(1, (Double(power) + 50) / 50))) // -50 dB and below reads as silence
    }

    @objc public func level(_ call: CAPPluginCall) {
        DispatchQueue.main.async { call.resolve(["level": Double(self.latest)]) }
    }

    @objc public func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let recorder = self.recorder else { call.reject("Nothing was being recorded.", "none"); return }
            let dur = recorder.currentTime
            recorder.stop()
            self.stopMeter()
            self.recorder = nil
            self.restoreSession()
            let spans = VoiceSpans.speaking(levels: self.levels, step: self.step).map { ["from": $0.from, "to": $0.to] }
            call.resolve(["path": recorder.url.path, "dur": dur, "spans": spans])
        }
    }

    @objc public func discard(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if let recorder = self.recorder { recorder.stop(); recorder.deleteRecording() }
            self.recorder = nil
            self.stopMeter()
            self.restoreSession()
            call.resolve()
        }
    }

    private func stopMeter() { meter?.invalidate(); meter = nil }

    private func restoreSession() {
        let session = AVAudioSession.sharedInstance()
        if let prior = prior { try? session.setCategory(prior.category, mode: prior.mode, options: prior.options) }
        prior = nil
        try? session.setActive(false, options: [.notifyOthersOnDeactivation])
    }

    @objc public func settings(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
            call.resolve()
        }
    }

    /// The reel, with the voice laid over it from the moment the reel started playing while it was recorded. The game's
    /// own sound dips to a quarter while you talk and comes back up between lines.
    @objc public func mix(_ call: CAPPluginCall) {
        guard let reelPath = call.getString("path"), let voicePath = call.getString("voice") else { call.reject("Nothing to put the voice on."); return }
        let lead = max(0, call.getDouble("lead") ?? 0)
        let job = call.getString("job") ?? ""
        let rawSpans = (call.options["spans"] as? [[String: Any]]) ?? []
        let name = (call.getString("file") ?? "reel-commentary.mp4").replacingOccurrences(of: "/", with: "-")
        work.async {
            do {
                let reel = AVURLAsset(url: URL(fileURLWithPath: reelPath))
                let voice = AVURLAsset(url: URL(fileURLWithPath: voicePath))
                guard let picture = reel.tracks(withMediaType: .video).first else { throw Failed("The reel couldn't be read. Make it again and try once more.") }
                guard let said = voice.tracks(withMediaType: .audio).first else { throw Failed("Your recording couldn't be read. Record it again.") }
                let reelLength = CMTimeGetSeconds(reel.duration), voiceLength = CMTimeGetSeconds(voice.duration)
                guard reelLength.isFinite, reelLength > 0, voiceLength.isFinite, voiceLength > lead + 0.2 else { throw Failed("Your recording is too short to use. Record it again.") }

                let composition = AVMutableComposition()
                let whole = CMTimeRange(start: .zero, duration: reel.duration)
                guard let video = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid) else { throw Failed("Couldn't set up the video.") }
                try video.insertTimeRange(whole, of: picture, at: .zero)
                video.preferredTransform = picture.preferredTransform
                var game: AVMutableCompositionTrack?
                if let sound = reel.tracks(withMediaType: .audio).first, let track = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) {
                    try track.insertTimeRange(whole, of: sound, at: .zero)
                    game = track
                }
                guard let speech = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) else { throw Failed("Couldn't set up the sound.") }
                let take = min(voiceLength - lead, reelLength)
                try speech.insertTimeRange(CMTimeRange(start: CMTime(seconds: lead, preferredTimescale: 600), duration: CMTime(seconds: take, preferredTimescale: 600)), of: said, at: .zero)

                let spans = rawSpans.compactMap { raw -> VoiceSpans.Span? in
                    guard let from = (raw["from"] as? NSNumber)?.doubleValue, let to = (raw["to"] as? NSNumber)?.doubleValue, to > from else { return nil }
                    return VoiceSpans.Span(from: from, to: to)
                }
                var params: [AVMutableAudioMixInputParameters] = []
                if let game = game {
                    let quiet: Float = 0.25
                    let levels = AVMutableAudioMixInputParameters(track: game)
                    for dip in VoiceSpans.dips(spans, lead: lead, voiceLength: voiceLength, reelLength: reelLength) {
                        let down = max(0, dip.from - 0.25)
                        levels.setVolumeRamp(fromStartVolume: 1, toEndVolume: quiet, timeRange: CMTimeRange(start: CMTime(seconds: down, preferredTimescale: 600), duration: CMTime(seconds: max(0.05, dip.from - down), preferredTimescale: 600)))
                        levels.setVolumeRamp(fromStartVolume: quiet, toEndVolume: 1, timeRange: CMTimeRange(start: CMTime(seconds: dip.to, preferredTimescale: 600), duration: CMTime(seconds: 0.35, preferredTimescale: 600)))
                    }
                    params.append(levels)
                }
                let voiceLevel = AVMutableAudioMixInputParameters(track: speech)
                voiceLevel.setVolume(1, at: .zero)
                params.append(voiceLevel)
                let mixer = AVMutableAudioMix()
                mixer.inputParameters = params

                // the same size as the reel (the usual 960×540, or a sharp one kept sharp)
                let size = picture.naturalSize.applying(picture.preferredTransform)
                let longest = max(abs(size.width), abs(size.height))
                let preset = longest > 1920 ? AVAssetExportPreset3840x2160 : longest > 960 ? AVAssetExportPreset1920x1080 : AVAssetExportPreset960x540
                guard let session = AVAssetExportSession(asset: composition, presetName: preset) else { throw Failed("This phone can't make that video.") }
                let out = try self.folder().appendingPathComponent(name.hasSuffix(".mp4") ? name : name + ".mp4")
                try? FileManager.default.removeItem(at: out)
                session.outputURL = out
                session.outputFileType = .mp4
                session.audioMix = mixer
                session.shouldOptimizeForNetworkUse = true

                var spare: UIBackgroundTaskIdentifier = .invalid
                DispatchQueue.main.sync { spare = UIApplication.shared.beginBackgroundTask(withName: "Adding your commentary") { UIApplication.shared.endBackgroundTask(spare); spare = .invalid } }
                defer { DispatchQueue.main.async { if spare != .invalid { UIApplication.shared.endBackgroundTask(spare) } } }
                let done = DispatchSemaphore(value: 0)
                session.exportAsynchronously { done.signal() }
                while done.wait(timeout: .now() + 0.3) == .timedOut {
                    self.notifyListeners("progress", data: ["p": Double(session.progress), "job": job])
                }
                guard session.status == .completed else {
                    throw Failed("Your commentary couldn't be added: \(session.error?.localizedDescription ?? "the video didn't finish"). Keep Gaffer open on screen and try again.")
                }
                let bytes = (try? FileManager.default.attributesOfItem(atPath: out.path)[.size] as? NSNumber)?.intValue ?? 0
                call.resolve(["path": out.path, "size": bytes])
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    private struct Failed: LocalizedError {
        let message: String
        init(_ message: String) { self.message = message }
        var errorDescription: String? { message }
    }
}
