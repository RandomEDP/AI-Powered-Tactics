import AVFoundation
import Capacitor
import CoreMotion
import Foundation
import HaishinKit
import Photos
import RTMPHaishinKit
import UIKit
import VideoToolbox

/// Films the game with this iPhone's own camera: it streams it live through the team's camera link (the same Cloudflare
/// link a GoPro or a streaming app would use) and, at the same time, records it in full quality to Photos. The recording
/// doesn't depend on the stream, so a game filmed with no signal is still recorded, and highlights can be cut from it.
///
///   start({ url, title })  open the camera screen and start filming; url is the camera link (rtmps://…/live/<key>)
///   show()                 bring the camera screen back (after "Back to Gaffer")
///   stop()                 stop filming: the stream ends and the recording goes to Photos. { saved, seconds, note }
///   state()                { state, shown, rec, seconds }
///
/// Events, "state": { state: starting | connecting | live | retrying | ending | ended, shown, rec, note }. "ended" carries
/// by: "user" when the gaffer ended it on the camera screen (the web app then switches the camera link off), and saved.
@objc(LiveCamPlugin)
public class LiveCamPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LiveCamPlugin"
    public let jsName = "LiveCam"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "show", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "state", returnType: CAPPluginReturnPromise)
    ]

    private weak var screen: CamScreen?

    override public func load() {
        Task { @MainActor in
            let rig = CamRig.shared
            rig.onEvent = { [weak self] data in self?.notifyListeners("state", data: data) }
            rig.rescue() // a recording left behind by an app that was closed mid-game still goes to Photos
        }
    }

    @objc public func start(_ call: CAPPluginCall) {
        let url = (call.getString("url") ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let title = call.getString("title") ?? ""
        guard url.hasPrefix("rtmps://") || url.hasPrefix("rtmp://"), URL(string: url) != nil else {
            call.reject("The camera link isn't ready yet. Close this and open Stream this game again.")
            return
        }
        Task { @MainActor in
            let rig = CamRig.shared
            if rig.running {
                guard rig.url == url else {
                    call.reject("This iPhone is already filming. End that stream first.")
                    return
                }
                self.present()
                call.resolve(rig.snapshot(shown: true))
                return
            }
            do {
                try await rig.start(url: url, title: title)
                self.present()
                call.resolve(rig.snapshot(shown: true))
            } catch {
                call.reject((error as? CamRig.Said)?.words ?? "Couldn't start the camera. Close Gaffer fully and try again.")
            }
        }
    }

    @objc public func show(_ call: CAPPluginCall) {
        Task { @MainActor in
            guard CamRig.shared.running else { call.resolve(["shown": false]); return }
            self.present()
            call.resolve(["shown": true])
        }
    }

    @objc public func stop(_ call: CAPPluginCall) {
        Task { @MainActor in
            let out = await self.finish(by: "app")
            call.resolve(out)
        }
    }

    @objc public func state(_ call: CAPPluginCall) {
        Task { @MainActor in call.resolve(CamRig.shared.snapshot(shown: self.screen != nil)) }
    }

    @MainActor private func present() {
        if screen != nil { return }
        guard let host = bridge?.viewController else { return }
        let s = CamScreen(rig: CamRig.shared)
        s.modalPresentationStyle = .fullScreen
        s.onHide = { [weak self] in
            guard let self = self else { return }
            self.screen?.dismiss(animated: true)
            self.screen = nil
            CamRig.shared.tell(shown: false)
        }
        s.onEnd = { [weak self] in
            guard let self = self else { return }
            Task { @MainActor in _ = await self.finish(by: "user") }
        }
        screen = s
        (host.presentedViewController ?? host).present(s, animated: true)
        CamRig.shared.tell(shown: true)
    }

    @MainActor private func finish(by: String) async -> [String: Any] {
        let rig = CamRig.shared
        guard rig.running else { return ["saved": false, "none": true] }
        let out = await rig.stop()
        screen?.dismiss(animated: true)
        screen = nil
        var event = out
        event["state"] = "ended"
        event["by"] = by
        event["shown"] = false
        rig.onEvent?(event)
        return out
    }
}

// MARK: - The camera, the stream and the recording

@MainActor
final class CamRig {
    static let shared = CamRig()

    /// Something to tell the gaffer, in words they can act on.
    struct Said: Error { let words: String }

    enum Phase: String { case idle, starting, connecting, live, retrying, ending }

    private(set) var phase: Phase = .idle
    private(set) var url = ""
    private(set) var title = ""
    private(set) var startedAt = Date()
    private(set) var liveSince: Date?
    private(set) var recording = false
    private(set) var recNote = ""      // why it isn't recording, if it isn't
    private(set) var note = ""         // why it isn't live yet, if it isn't
    private(set) var orientation: AVCaptureVideoOrientation = .landscapeRight
    private(set) var ultraWide = false
    let hasUltraWide = AVCaptureDevice.default(.builtInUltraWideCamera, for: .video, position: .back) != nil
    var running: Bool { phase != .idle && phase != .ending }
    var onEvent: (([String: Any]) -> Void)?
    var onChange: (() -> Void)?        // the camera screen
    let preview: MTHKView = {
        let v = MTHKView(frame: .zero)
        v.videoGravity = .resizeAspect
        v.backgroundColor = .black
        return v
    }()

    private var mixer: MediaMixer?
    private var session: (any Session)?
    private var recorder: CamRecorder?
    private var watcher: Task<Void, Never>?
    private var redial: Task<Void, Never>?
    private var awake: Timer?
    private var everLive = false
    private var shown = false

    nonisolated static let streamBitRate = 2_500_000      // what goes up the mobile signal: 720p
    nonisolated static let recordBitRate = 8_000_000      // what's kept on the phone: 1080p, like the Camera app

    // MARK: start

    func start(url: String, title: String) async throws {
        guard phase == .idle else { return }
        guard await AVCaptureDevice.requestAccess(for: .video) else {
            throw Said(words: "Gaffer isn't allowed to use the camera. Turn it on in Settings, Gaffer, Camera, then try again.")
        }
        let sound = await AVCaptureDevice.requestAccess(for: .audio)
        let photos = await PHPhotoLibrary.requestAuthorization(for: .addOnly)
        guard let camera = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back) else {
            throw Said(words: "This iPhone's camera isn't available. Close any other app using it and try again.")
        }

        self.url = url
        self.title = title
        startedAt = Date()
        liveSince = nil
        everLive = false
        note = ""
        ultraWide = false
        set(.starting)

        let audio = AVAudioSession.sharedInstance()
        try? audio.setCategory(.playAndRecord, mode: .videoRecording, options: [.defaultToSpeaker])
        try? audio.setActive(true)

        let mixer = MediaMixer(captureSessionMode: .single)
        self.mixer = mixer
        await mixer.setSessionPreset(.hd1920x1080)
        await mixer.setVideoOrientation(orientation)
        do {
            try await mixer.attachVideo(camera, track: 0)
        } catch {
            await teardown()
            phase = .idle
            throw Said(words: "Couldn't start the camera. Close any other app using it and try again.")
        }
        if sound { try? await mixer.attachAudio(AVCaptureDevice.default(for: .audio)) }

        // the recording, kept on the phone in full quality, whatever happens to the stream
        recNote = ""
        if !(photos == .authorized || photos == .limited) {
            recNote = "Not recording: Gaffer isn't allowed to save to Photos (Settings, Gaffer, Photos)."
        } else if Self.freeSpace() < 1_500_000_000 {
            recNote = "Not recording: this iPhone is nearly full."
        } else if let dir = Self.folder() {
            let rec = CamRecorder(sound: sound)
            let file = dir.appendingPathComponent("game-\(Int(startedAt.timeIntervalSince1970)).mov")
            do {
                try rec.start(file, at: startedAt)
                recorder = rec
                await mixer.addOutput(rec)
            } catch {
                recNote = "Not recording: \(error.localizedDescription)"
            }
        }
        recording = recorder != nil
        await mixer.addOutput(preview)
        await mixer.startRunning()

        // the stream
        await SessionBuilderFactory.shared.register(RTMPSessionFactory())
        do {
            guard let made = try await SessionBuilderFactory.shared.make(URL(string: url)).setMode(.publish).build() else {
                throw Said(words: "")
            }
            session = made
            var video = await made.stream.videoSettings
            video.videoSize = CGSize(width: 1280, height: 720)
            video.bitRate = Self.streamBitRate
            video.profileLevel = kVTProfileLevel_H264_High_AutoLevel as String
            video.maxKeyFrameIntervalDuration = 2
            try? await made.stream.setVideoSettings(video)
            var sounds = await made.stream.audioSettings
            sounds.bitRate = 128_000
            try? await made.stream.setAudioSettings(sounds)
            await made.stream.setBitRateStrategy(StreamVideoAdaptiveBitRateStrategy(mamimumVideoBitrate: Self.streamBitRate))
            await mixer.addOutput(made.stream)
            watcher = Task { [weak self] in
                for await state in await made.readyState {
                    guard let self = self else { return }
                    self.ready(state)
                }
            }
        } catch {
            note = "Couldn't set up the stream. The recording carries on."
        }

        UIApplication.shared.isIdleTimerDisabled = true
        UIDevice.current.isBatteryMonitoringEnabled = true
        awake?.invalidate()
        awake = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { _ in
            // something else in the app may let the screen sleep (that would stop the camera), so keep saying no
            Task { @MainActor in if CamRig.shared.running { UIApplication.shared.isIdleTimerDisabled = true } }
        }
        set(.connecting)
        dial()
    }

    // MARK: the stream getting through, dropping and coming back

    private func dial() {
        redial?.cancel()
        redial = nil
        guard running, let session = session else { return }
        Task { [weak self] in
            do {
                try await session.connect {
                    Task { @MainActor in CamRig.shared.dropped() }
                }
            } catch {
                self?.failed(error)
            }
        }
    }

    private func ready(_ state: SessionReadyState) {
        guard running else { return }
        switch state {
        case .open:
            everLive = true
            if liveSince == nil { liveSince = Date() }
            note = ""
            set(.live)
        case .connecting:
            set(everLive ? .retrying : .connecting)
        default:
            break
        }
    }

    fileprivate func dropped() {
        guard running else { return }
        note = "The signal dropped. Gaffer keeps trying, and the recording carries on."
        set(.retrying)
        later()
    }

    private func failed(_ error: Error) {
        guard running else { return }
        let said = String(describing: error)
        if said.contains("requestFailed") || said.contains("Rejected") || said.contains("BadName") || said.contains("unsupportedCommand") {
            note = "Cloudflare turned the camera away. In Gaffer, check Stream this game says the link is ready. Gaffer keeps trying."
        } else {
            note = "Can't get through to Cloudflare from here. Check your signal: Gaffer keeps trying, and the recording carries on."
        }
        set(everLive ? .retrying : .connecting)
        later()
    }

    private func later() {
        redial?.cancel()
        redial = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            if Task.isCancelled { return }
            self?.dial()
        }
    }

    // MARK: what the camera sees

    func setOrientation(_ o: AVCaptureVideoOrientation) {
        guard o != orientation else { return }
        orientation = o
        guard let mixer = mixer else { return }
        Task { await mixer.setVideoOrientation(o) }
    }

    func toggleLens() {
        guard running, let mixer = mixer else { return }
        let wide = !ultraWide
        let type: AVCaptureDevice.DeviceType = wide ? .builtInUltraWideCamera : .builtInWideAngleCamera
        guard let device = AVCaptureDevice.default(type, for: .video, position: .back) else { return }
        ultraWide = wide
        onChange?()
        let o = orientation
        Task {
            try? await mixer.attachVideo(device, track: 0)
            await mixer.setVideoOrientation(o)
        }
    }

    func pausePreview(_ paused: Bool) {
        guard let mixer = mixer else { return }
        let view = preview
        Task {
            if paused { await mixer.removeOutput(view) } else { await mixer.addOutput(view) }
        }
    }

    // MARK: stop

    func stop() async -> [String: Any] {
        guard running else { return ["saved": false, "none": true] }
        let seconds = Int(Date().timeIntervalSince(startedAt))
        set(.ending)
        redial?.cancel()
        redial = nil
        if let session = session { try? await session.close() }
        let rec = recorder
        await teardown()
        var out: [String: Any] = ["seconds": seconds, "saved": false]
        if let rec = rec {
            let (file, why) = await rec.finish()
            if let file = file {
                let (ok, said) = await Self.toPhotos(file, at: startedAt)
                out["saved"] = ok
                if !ok { out["note"] = said }
            } else if let why = why {
                out["note"] = why
            }
        } else if !recNote.isEmpty {
            out["note"] = recNote
        }
        phase = .idle
        url = ""
        return out
    }

    private func teardown() async {
        watcher?.cancel()
        watcher = nil
        awake?.invalidate()
        awake = nil
        if let mixer = mixer {
            if let session = session { await mixer.removeOutput(await session.stream) }
            if let rec = recorder { await mixer.removeOutput(rec) }
            await mixer.removeOutput(preview)
            await mixer.stopRunning()
            try? await mixer.attachAudio(nil)
            try? await mixer.attachVideo(nil, track: 0)
        }
        mixer = nil
        session = nil
        recorder = nil
        recording = false
        UIApplication.shared.isIdleTimerDisabled = false
        try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
    }

    // MARK: telling the web app and the screen

    private func set(_ p: Phase) {
        let was = phase
        phase = p
        onChange?()
        if was != p { tell(shown: nil) }
    }

    func tell(shown: Bool?) {
        if let shown = shown { self.shown = shown }
        guard phase != .idle else { return }
        onEvent?(snapshot(shown: self.shown))
    }

    func snapshot(shown: Bool) -> [String: Any] {
        var out: [String: Any] = [
            "state": phase.rawValue, "shown": shown, "rec": recording,
            "seconds": phase == .idle ? 0 : Int(Date().timeIntervalSince(startedAt))
        ]
        if !note.isEmpty { out["note"] = note }
        if !recNote.isEmpty { out["recNote"] = recNote }
        return out
    }

    // MARK: recordings on disk

    nonisolated static func folder() -> URL? {
        guard let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else { return nil }
        let dir = base.appendingPathComponent("GafferCamera", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    nonisolated static func freeSpace() -> Int64 {
        let home = URL(fileURLWithPath: NSHomeDirectory())
        let values = try? home.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey])
        return values?.volumeAvailableCapacityForImportantUsage ?? Int64.max
    }

    nonisolated static func toPhotos(_ file: URL, at date: Date) async -> (Bool, String) {
        await withCheckedContinuation { (done: CheckedContinuation<(Bool, String), Never>) in
            PHPhotoLibrary.shared().performChanges({
                let request = PHAssetCreationRequest.forAsset()
                let options = PHAssetResourceCreationOptions()
                options.shouldMoveFile = true
                request.addResource(with: .video, fileURL: file, options: options)
                request.creationDate = date
            }, completionHandler: { ok, error in
                if ok { try? FileManager.default.removeItem(at: file) }
                done.resume(returning: (ok, ok ? "" : "The recording couldn't be saved to Photos (\(error?.localizedDescription ?? "no reason given")). Gaffer tries again next time it opens."))
            })
        }
    }

    /// Recordings left in Gaffer's folder (the app was closed mid-game, or Photos said no) go to Photos when they can.
    func rescue() {
        guard !running, let dir = Self.folder() else { return }
        let status = PHPhotoLibrary.authorizationStatus(for: .addOnly)
        guard status == .authorized || status == .limited else { return }
        let files = (try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.fileSizeKey, .creationDateKey])) ?? []
        for file in files where file.pathExtension.lowercased() == "mov" {
            let values = try? file.resourceValues(forKeys: [.fileSizeKey, .creationDateKey])
            if (values?.fileSize ?? 0) < 1_000_000 { try? FileManager.default.removeItem(at: file); continue }
            let when = values?.creationDate ?? Date()
            Task { _ = await Self.toPhotos(file, at: when) }
        }
    }
}

// MARK: - The recording

/// Writes what the camera and microphone pick up to a movie file, in full quality, with the time it started (so
/// highlights can line it up with the game). It's written in pieces every 10 seconds, so a game cut short by the app
/// being closed is still kept. Buffers are handled in the order they come, on one queue.
final class CamRecorder: MediaMixerOutput, @unchecked Sendable {
    let videoTrackId: UInt8? = UInt8.max
    let audioTrackId: UInt8? = UInt8.max

    private let queue = DispatchQueue(label: "gaffer.camera.recording")
    private let sound: Bool
    private var writer: AVAssetWriter?
    private var videoIn: AVAssetWriterInput?
    private var audioIn: AVAssetWriterInput?
    private var videoFormat: CMFormatDescription?
    private var audioFormat: CMFormatDescription?
    private var firstVideo: CMTime = .invalid
    private var began: CMTime = .invalid
    private var ended = false

    init(sound: Bool) { self.sound = sound }

    func selectTrack(_ id: UInt8?, mediaType: CMFormatDescription.MediaType) {}

    func start(_ file: URL, at date: Date) throws {
        try? FileManager.default.removeItem(at: file)
        let w = try AVAssetWriter(outputURL: file, fileType: .mov)
        w.movieFragmentInterval = CMTime(seconds: 10, preferredTimescale: 600)
        w.shouldOptimizeForNetworkUse = false
        let made = AVMutableMetadataItem()
        made.identifier = .quickTimeMetadataCreationDate
        made.dataType = kCMMetadataBaseDataType_UTF8 as String
        made.value = ISO8601DateFormatter.string(from: date, timeZone: .current, formatOptions: [.withInternetDateTime]) as NSString
        let by = AVMutableMetadataItem()
        by.identifier = .quickTimeMetadataSoftware
        by.dataType = kCMMetadataBaseDataType_UTF8 as String
        by.value = "Gaffer" as NSString
        w.metadata = [made, by]
        queue.sync { writer = w }
    }

    func mixer(_ mixer: MediaMixer, didOutput sampleBuffer: CMSampleBuffer) {
        queue.async { self.take(sampleBuffer, video: true) }
    }

    func mixer(_ mixer: MediaMixer, didOutput buffer: AVAudioPCMBuffer, when: AVAudioTime) {
        guard sound, let sample = Self.sample(buffer, when) else { return } // (copied now: the mixer reuses its buffers)
        queue.async { self.take(sample, video: false) }
    }

    private func take(_ sample: CMSampleBuffer, video: Bool) {
        guard let w = writer, !ended else { return }
        let at = CMSampleBufferGetPresentationTimeStamp(sample)
        if w.status == .unknown {
            // Wait until both the picture and the sound have been seen (each input needs their formats), then start on a
            // picture. If the sound never comes, start without it after two seconds.
            if video {
                if videoFormat == nil { videoFormat = CMSampleBufferGetFormatDescription(sample) }
                if !firstVideo.isValid { firstVideo = at }
            } else if audioFormat == nil {
                audioFormat = CMSampleBufferGetFormatDescription(sample)
            }
            let waited = firstVideo.isValid && CMTimeGetSeconds(CMTimeSubtract(at, firstVideo)) > 2
            guard video, videoFormat != nil, audioFormat != nil || !sound || waited else { return }
            guard makeInputs(w), w.startWriting() else { return }
            w.startSession(atSourceTime: at)
            began = at
        }
        guard w.status == .writing, began.isValid, CMTimeCompare(at, began) >= 0 else { return }
        if video {
            if let input = videoIn, input.isReadyForMoreMediaData { input.append(sample) }
        } else {
            if let input = audioIn, input.isReadyForMoreMediaData { input.append(sample) }
        }
    }

    private func makeInputs(_ w: AVAssetWriter) -> Bool {
        guard let vf = videoFormat else { return false }
        let dims = CMVideoFormatDescriptionGetDimensions(vf)
        var settings: [String: Any] = [
            AVVideoCodecKey: AVVideoCodecType.hevc,
            AVVideoWidthKey: Int(dims.width),
            AVVideoHeightKey: Int(dims.height),
            AVVideoCompressionPropertiesKey: [
                AVVideoAverageBitRateKey: CamRig.recordBitRate,
                AVVideoExpectedSourceFrameRateKey: 30,
                AVVideoMaxKeyFrameIntervalDurationKey: 2
            ]
        ]
        if !w.canApply(outputSettings: settings, forMediaType: .video) {
            settings[AVVideoCodecKey] = AVVideoCodecType.h264
            settings[AVVideoCompressionPropertiesKey] = [AVVideoAverageBitRateKey: 10_000_000, AVVideoExpectedSourceFrameRateKey: 30]
        }
        let v = AVAssetWriterInput(mediaType: .video, outputSettings: settings, sourceFormatHint: vf)
        v.expectsMediaDataInRealTime = true
        guard w.canAdd(v) else { return false }
        w.add(v)
        videoIn = v
        if let af = audioFormat, let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(af)?.pointee {
            let a = AVAssetWriterInput(mediaType: .audio, outputSettings: [
                AVFormatIDKey: kAudioFormatMPEG4AAC,
                AVSampleRateKey: asbd.mSampleRate,
                AVNumberOfChannelsKey: max(1, min(2, Int(asbd.mChannelsPerFrame))),
                AVEncoderBitRateKey: 128_000
            ], sourceFormatHint: af)
            a.expectsMediaDataInRealTime = true
            if w.canAdd(a) { w.add(a); audioIn = a }
        }
        return true
    }

    /// Finishes the file: its address, or why there's nothing.
    func finish() async -> (URL?, String?) {
        await withCheckedContinuation { (done: CheckedContinuation<(URL?, String?), Never>) in
            queue.async {
                self.ended = true
                guard let w = self.writer else { done.resume(returning: (nil, nil)); return }
                self.writer = nil
                let file = w.outputURL
                guard w.status == .writing else {
                    let why = w.status == .unknown ? "Nothing was recorded: the camera never got going." : "The recording stopped early (\(w.error?.localizedDescription ?? "no reason given"))."
                    let size = (try? file.resourceValues(forKeys: [.fileSizeKey]))?.fileSize ?? 0
                    done.resume(returning: (size > 1_000_000 ? file : nil, why)) // (what was written before it stopped is still kept)
                    return
                }
                self.videoIn?.markAsFinished()
                self.audioIn?.markAsFinished()
                w.finishWriting {
                    if w.status == .completed { done.resume(returning: (file, nil)); return }
                    let size = (try? file.resourceValues(forKeys: [.fileSizeKey]))?.fileSize ?? 0
                    done.resume(returning: (size > 1_000_000 ? file : nil, "The recording didn't finish cleanly (\(w.error?.localizedDescription ?? "no reason given"))."))
                }
            }
        }
    }

    /// The microphone's sound as a sample buffer the writer takes, stamped with the same clock as the camera.
    static func sample(_ buffer: AVAudioPCMBuffer, _ when: AVAudioTime) -> CMSampleBuffer? {
        var out: CMSampleBuffer?
        let at = CMTime(seconds: AVAudioTime.seconds(forHostTime: when.hostTime), preferredTimescale: 1_000_000_000)
        guard CMAudioSampleBufferCreateWithPacketDescriptions(
            allocator: nil, dataBuffer: nil, dataReady: false, makeDataReadyCallback: nil, refcon: nil,
            formatDescription: buffer.format.formatDescription, sampleCount: Int(buffer.frameLength),
            presentationTimeStamp: at, packetDescriptions: nil, sampleBufferOut: &out) == noErr, let sample = out else { return nil }
        guard CMSampleBufferSetDataBufferFromAudioBufferList(sample, blockBufferAllocator: kCFAllocatorDefault,
            blockBufferMemoryAllocator: kCFAllocatorDefault, flags: 0, bufferList: buffer.audioBufferList) == noErr else { return nil }
        return sample
    }
}

// MARK: - The camera screen

/// Full screen, laid out for an iPhone on its side (the app itself stays upright, so the screen turns its contents to
/// match how the phone is held). Shows the picture, whether it's live, that it's recording, and End / Back to Gaffer.
final class CamScreen: UIViewController {
    var onHide: (() -> Void)?
    var onEnd: (() -> Void)?

    private let rig: CamRig
    private let stage = UIView()
    private let status = UIButton(type: .custom)
    private let detail = UILabel()
    private let middle = UILabel()
    private let endButton = UIButton(type: .system)
    private let backButton = UIButton(type: .system)
    private let dimButton = UIButton(type: .system)
    private let lensButton = UIButton(type: .system)
    private let shade = UIControl()
    private let motion = CMMotionManager()
    private var tick: Timer?
    private var armedUntil: Date?
    private var angle: CGFloat = .pi / 2
    private var upright = false          // held upright, not on its side
    private var brightness: CGFloat?
    private let opened = Date()

    init(rig: CamRig) {
        self.rig = rig
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("not from a storyboard") }

    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .portrait }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        view.addSubview(stage)
        stage.backgroundColor = .black

        let preview = rig.preview
        preview.removeFromSuperview()
        preview.translatesAutoresizingMaskIntoConstraints = false
        stage.addSubview(preview)

        status.isUserInteractionEnabled = false
        detail.font = .systemFont(ofSize: 14, weight: .semibold)
        detail.textColor = .white
        detail.numberOfLines = 2
        detail.layer.shadowColor = UIColor.black.cgColor
        detail.layer.shadowOpacity = 0.8
        detail.layer.shadowRadius = 3
        detail.layer.shadowOffset = .zero
        middle.font = .systemFont(ofSize: 17, weight: .semibold)
        middle.textColor = .white
        middle.numberOfLines = 0
        middle.textAlignment = .center
        middle.backgroundColor = UIColor.black.withAlphaComponent(0.6)
        middle.layer.cornerRadius = 12
        middle.clipsToBounds = true

        style(endButton, "End stream", UIColor(red: 0.85, green: 0.15, blue: 0.2, alpha: 1))
        style(backButton, "Back to Gaffer", UIColor.black.withAlphaComponent(0.55))
        style(dimButton, "Dim screen", UIColor.black.withAlphaComponent(0.55))
        style(lensButton, "0.5×", UIColor.black.withAlphaComponent(0.55))
        lensButton.isHidden = !rig.hasUltraWide
        endButton.addTarget(self, action: #selector(endTapped), for: .touchUpInside)
        backButton.addTarget(self, action: #selector(backTapped), for: .touchUpInside)
        dimButton.addTarget(self, action: #selector(dimTapped), for: .touchUpInside)
        lensButton.addTarget(self, action: #selector(lensTapped), for: .touchUpInside)

        shade.backgroundColor = UIColor.black.withAlphaComponent(0.94)
        shade.isHidden = true
        shade.addTarget(self, action: #selector(wakeTapped), for: .touchUpInside)
        let wake = UILabel()
        wake.text = "Still filming. Tap to wake the screen."
        wake.textColor = UIColor(white: 0.6, alpha: 1)
        wake.font = .systemFont(ofSize: 15, weight: .medium)
        wake.translatesAutoresizingMaskIntoConstraints = false
        shade.addSubview(wake)

        for v in [status, detail, middle, endButton, backButton, dimButton, lensButton, shade] as [UIView] {
            v.translatesAutoresizingMaskIntoConstraints = false
            stage.addSubview(v)
        }
        let side: CGFloat = 54, edge: CGFloat = 18
        NSLayoutConstraint.activate([
            preview.leadingAnchor.constraint(equalTo: stage.leadingAnchor),
            preview.trailingAnchor.constraint(equalTo: stage.trailingAnchor),
            preview.topAnchor.constraint(equalTo: stage.topAnchor),
            preview.bottomAnchor.constraint(equalTo: stage.bottomAnchor),
            status.leadingAnchor.constraint(equalTo: stage.leadingAnchor, constant: side),
            status.topAnchor.constraint(equalTo: stage.topAnchor, constant: edge),
            detail.leadingAnchor.constraint(equalTo: stage.leadingAnchor, constant: side + 4),
            detail.topAnchor.constraint(equalTo: status.bottomAnchor, constant: 8),
            detail.trailingAnchor.constraint(lessThanOrEqualTo: lensButton.leadingAnchor, constant: -12),
            lensButton.trailingAnchor.constraint(equalTo: stage.trailingAnchor, constant: -side),
            lensButton.topAnchor.constraint(equalTo: stage.topAnchor, constant: edge),
            middle.centerXAnchor.constraint(equalTo: stage.centerXAnchor),
            middle.centerYAnchor.constraint(equalTo: stage.centerYAnchor),
            middle.widthAnchor.constraint(lessThanOrEqualTo: stage.widthAnchor, multiplier: 0.6),
            backButton.leadingAnchor.constraint(equalTo: stage.leadingAnchor, constant: side),
            backButton.bottomAnchor.constraint(equalTo: stage.bottomAnchor, constant: -edge),
            dimButton.leadingAnchor.constraint(equalTo: backButton.trailingAnchor, constant: 10),
            dimButton.bottomAnchor.constraint(equalTo: stage.bottomAnchor, constant: -edge),
            endButton.trailingAnchor.constraint(equalTo: stage.trailingAnchor, constant: -side),
            endButton.bottomAnchor.constraint(equalTo: stage.bottomAnchor, constant: -edge),
            shade.leadingAnchor.constraint(equalTo: stage.leadingAnchor),
            shade.trailingAnchor.constraint(equalTo: stage.trailingAnchor),
            shade.topAnchor.constraint(equalTo: stage.topAnchor),
            shade.bottomAnchor.constraint(equalTo: stage.bottomAnchor),
            wake.centerXAnchor.constraint(equalTo: shade.centerXAnchor),
            wake.centerYAnchor.constraint(equalTo: shade.centerYAnchor)
        ])
        rig.onChange = { [weak self] in self?.refresh() }
        refresh()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        tick = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.refresh() }
        }
        if motion.isAccelerometerAvailable {
            motion.accelerometerUpdateInterval = 0.3
            motion.startAccelerometerUpdates(to: .main) { [weak self] data, _ in
                guard let a = data?.acceleration else { return }
                self?.tilted(x: a.x, y: a.y)
            }
        }
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        tick?.invalidate()
        tick = nil
        motion.stopAccelerometerUpdates()
        if !shade.isHidden { wakeTapped() }
        if rig.onChange != nil { rig.onChange = nil }
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        let size = view.bounds.size
        stage.transform = .identity
        stage.bounds = CGRect(x: 0, y: 0, width: max(size.width, size.height), height: min(size.width, size.height))
        stage.center = CGPoint(x: view.bounds.midX, y: view.bounds.midY)
        stage.transform = CGAffineTransform(rotationAngle: angle)
    }

    /// Which way up the phone is. On its side either way round, the picture and this screen turn to match; held upright,
    /// it asks to be turned (a pitch is wide).
    private func tilted(x: Double, y: Double) {
        if abs(x) > 0.6 && abs(x) > abs(y) {
            upright = false
            // top of the phone to the left: the camera's "home button on the right"; to the right: the other way
            let o: AVCaptureVideoOrientation = x < 0 ? .landscapeRight : .landscapeLeft
            let a: CGFloat = x < 0 ? .pi / 2 : -.pi / 2
            rig.setOrientation(o)
            if a != angle {
                angle = a
                UIView.animate(withDuration: 0.25) { self.stage.transform = CGAffineTransform(rotationAngle: a) }
            }
        } else if abs(y) > 0.75 {
            upright = true
        }
        refresh()
    }

    private func refresh() {
        let red = UIColor(red: 0.85, green: 0.15, blue: 0.2, alpha: 1), amber = UIColor(red: 0.85, green: 0.55, blue: 0.1, alpha: 1)
        let grey = UIColor.black.withAlphaComponent(0.55)
        switch rig.phase {
        case .live:
            let s = Int(Date().timeIntervalSince(rig.liveSince ?? Date()))
            pill(String(format: "●  LIVE  %d:%02d", s / 60, s % 60), red)
        case .connecting: pill("Connecting…", amber)
        case .retrying: pill("Signal lost · reconnecting…", amber)
        case .starting: pill("Starting the camera…", grey)
        case .ending: pill("Ending…", grey)
        case .idle: pill("Stopped", grey)
        }
        var bits: [String] = []
        if !rig.title.isEmpty { bits.append(rig.title) }
        bits.append(rig.recording ? "Recording to Photos" : "Not recording")
        let battery = UIDevice.current.batteryLevel
        if battery >= 0 { bits.append("Battery \(Int((battery * 100).rounded()))%") }
        var lines = bits.joined(separator: " · ")
        let heat = ProcessInfo.processInfo.thermalState
        if heat == .serious || heat == .critical { lines += "\nThis iPhone is getting hot. Keep it out of the sun if you can." }
        detail.text = lines

        var say = ""
        if upright { say = "Turn your iPhone on its side to film the pitch." }
        else if !rig.recNote.isEmpty && Date().timeIntervalSince(opened) < 8 { say = rig.recNote }
        else if rig.phase != .live && !rig.note.isEmpty { say = rig.note }
        else if Date().timeIntervalSince(opened) < 6 { say = "Keep Gaffer open on this screen. Locking the iPhone stops the picture." }
        middle.text = say.isEmpty ? nil : "  \(say)  "
        middle.isHidden = say.isEmpty
        lensButton.configuration?.title = rig.ultraWide ? "1×" : "0.5×"
        let armed = (armedUntil ?? .distantPast) > Date()
        endButton.configuration?.title = armed ? "Tap again to end" : "End stream"
    }

    private func pill(_ text: String, _ colour: UIColor) {
        var c = status.configuration ?? UIButton.Configuration.filled()
        c.title = text
        c.baseBackgroundColor = colour
        c.baseForegroundColor = .white
        c.cornerStyle = .capsule
        c.contentInsets = NSDirectionalEdgeInsets(top: 6, leading: 12, bottom: 6, trailing: 12)
        status.configuration = c
    }

    private func style(_ b: UIButton, _ title: String, _ colour: UIColor) {
        var c = UIButton.Configuration.filled()
        c.title = title
        c.baseBackgroundColor = colour
        c.baseForegroundColor = .white
        c.cornerStyle = .capsule
        c.contentInsets = NSDirectionalEdgeInsets(top: 10, leading: 18, bottom: 10, trailing: 18)
        b.configuration = c
    }

    @objc private func endTapped() {
        if let until = armedUntil, until > Date() {
            armedUntil = nil
            endButton.isEnabled = false
            onEnd?()
            return
        }
        armedUntil = Date().addingTimeInterval(3)
        refresh()
    }

    @objc private func backTapped() { onHide?() }

    @objc private func lensTapped() { rig.toggleLens() }

    @objc private func dimTapped() {
        shade.isHidden = false
        rig.pausePreview(true)
        if let screen = view.window?.windowScene?.screen {
            brightness = screen.brightness
            screen.brightness = 0.05
        }
    }

    @objc private func wakeTapped() {
        shade.isHidden = true
        rig.pausePreview(false)
        if let b = brightness, let screen = view.window?.windowScene?.screen { screen.brightness = b }
        brightness = nil
    }
}
