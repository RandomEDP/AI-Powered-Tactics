import AVFoundation
import Capacitor
import CoreGraphics
import CoreImage
import Foundation
import UIKit
import OnnxRuntimeBindings
import Vision

/// Experimental: follows named players through a match recording, on the phone.
///
///   analyse({ path, players: [{ pid, number }], color, length, width?, from?, to?, rate? })
///     -> { duration, pitch: { width, length }, cameraHeight, players: [{ pid, number, seconds, metres, reads, heat }], team: { heat }, pieces, unknownSeconds,
///          ask: [{ piece, seconds, pictures: [jpeg as base64] }] }
///   name({ piece, number? })   says who the player in one of the `ask` pictures is (no number = not one of ours); returns the result again
///   cancel()
/// While working it emits "progress" events: { stage: "look" | "sort", p }.
///
/// How it works: a people detector (YOLOX-S, Apache 2.0, bundled as Resources/yolox_s.onnx and run with ONNX Runtime)
/// looks at about eight frames a second, as two overlapping square halves so distant players get more pixels.
/// Apple's Vision then reads shirt numbers from an enlarged crop of each of our players' backs.
/// People in the team's colour are placed on the pitch using their own height as the ruler, followed from frame to
/// frame, and the track is cut wherever two of them come close (which is where trackers swap people). Each clean piece
/// with a number read on it is fixed to that player; the rest go to whoever could have been there. Stretches it still
/// can't name come back as pictures in `ask`, so the person using it can say who that is.
@objc(MatchVisionPlugin)
public class MatchVisionPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MatchVisionPlugin"
    public let jsName = "MatchVision"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "analyse", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "name", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise)
    ]

    private let queue = DispatchQueue(label: "matchvision.work", qos: .userInitiated)
    private var cancelled = false
    private var env: ORTEnv?
    private var session: ORTSession?
    private var inputName = "images"
    private var outputName = "output"
    private let imageContext = CIContext(options: nil)
    private var grid: [(Float, Float, Float)] = []   // for each of the detector's 8400 guesses: column, row, and cell size
    private var last: Watched?                       // the most recent video looked at, kept so players can be named afterwards

    /// Everything worked out from watching a video, before deciding who is who.
    private struct Watched {
        var path: String
        var numbers: [Int]
        var pidFor: [Int: Int]
        var pieces: [Piece]
        var ours: [Det]
        var times: [Double]
        var dt: Double
        var duration: Double
        var frames: Int
        var pitchLength: Double
        var pitchWidth: Double
        var cameraHeight: Double
        var width: Double
        var told: [Int: Int] = [:]   // piece -> shirt number, as told by the person using it (-1 = not one of ours)
    }

    /// Loads the detector the first time it is needed.
    private func detector() throws -> ORTSession {
        if let session = session { return session }
        guard let url = Bundle.module.url(forResource: "yolox_s", withExtension: "onnx") else { throw Fail(message: "The player detector is missing from this build.") }
        let env = try ORTEnv(loggingLevel: ORTLoggingLevel.warning)
        let options = try ORTSessionOptions()
        try options.setIntraOpNumThreads(4)
        // the phone's neural chip where it can be used; otherwise the ordinary processor
        let chip = ORTCoreMLExecutionProviderOptions()
        try? options.appendCoreMLExecutionProvider(with: chip)
        let made = try ORTSession(env: env, modelPath: url.path, sessionOptions: options)
        if let name = try made.inputNames().first { inputName = name }
        if let name = try made.outputNames().first { outputName = name }
        var cells: [(Float, Float, Float)] = []
        for stride in [8, 16, 32] {
            let n = 640 / stride
            for row in 0..<n { for column in 0..<n { cells.append((Float(column), Float(row), Float(stride))) } }
        }
        grid = cells
        self.env = env
        session = made
        return made
    }

    private struct Fail: LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }

    /// One person found in one analysed frame. Pixels, with y running down the picture.
    private struct Det {
        var frame: Int
        var x1: Double
        var y1: Double
        var x2: Double
        var y2: Double
        var ours: Bool
        var number: Int?
        var gx: Double = 0   // metres across the pitch from the camera's centre line
        var gz: Double = 0   // metres up the pitch from the camera
        var height: Double { y2 - y1 }
    }

    private final class Track {
        var dets: [Det] = []
        var vx = 0.0
        var vz = 0.0
        var last: Int { dets[dets.count - 1].frame }
    }

    private final class Piece {
        var id = 0
        var dets: [Det]
        var who: Int?
        var read = false
        var told = false
        init(_ dets: [Det]) { self.dets = dets }
        var start: Int { dets[0].frame }
        var end: Int { dets[dets.count - 1].frame }
    }

    @objc public func cancel(_ call: CAPPluginCall) {
        cancelled = true
        call.resolve()
    }

    @objc public func analyse(_ call: CAPPluginCall) {
        guard let path = call.getString("path"), FileManager.default.fileExists(atPath: path) else {
            call.reject("That video is no longer on this phone. Choose it again.")
            return
        }
        let rawPlayers = call.options["players"] as? [[String: Any]] ?? []
        var numbers: [Int] = []
        var pidFor: [Int: Int] = [:]
        for raw in rawPlayers {
            guard let number = (raw["number"] as? NSNumber)?.intValue, let pid = (raw["pid"] as? NSNumber)?.intValue, !numbers.contains(number) else { continue }
            numbers.append(number)
            pidFor[number] = pid
        }
        guard numbers.count >= 1 else {
            call.reject("Tell it who is playing and their shirt numbers first.")
            return
        }
        let kit = MatchVisionPlugin.rgb(call.getString("color") ?? "#1f6b4a")
        let pitchLength = max(10, min(80, call.getDouble("length") ?? 30))
        let pitchWidth = max(6, min(60, call.getDouble("width") ?? pitchLength * 2 / 3))
        let rate = max(2, min(15, call.getDouble("rate") ?? 8))
        let from = max(0, call.getDouble("from") ?? 0)
        let to = call.getDouble("to")
        cancelled = false

        queue.async {
            do {
                let watched = try self.run(path: path, numbers: numbers, pidFor: pidFor, kit: kit, pitchLength: pitchLength, pitchWidth: pitchWidth, rate: rate, from: from, to: to)
                self.last = watched
                call.resolve(self.finish(watched))
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    @objc public func name(_ call: CAPPluginCall) {
        guard let piece = call.getInt("piece") else { call.reject("Which player?"); return }
        let number = call.getInt("number")
        queue.async {
            guard var watched = self.last, piece >= 0, piece < watched.pieces.count else {
                call.reject("That run is no longer in memory. Track the video again.")
                return
            }
            if let number = number, !watched.numbers.contains(number) { call.reject("That player wasn't ticked."); return }
            watched.told[piece] = number ?? -1
            self.last = watched
            call.resolve(self.finish(watched))
        }
    }

    // MARK: - The whole job

    private func run(path: String, numbers: [Int], pidFor: [Int: Int], kit: (Double, Double, Double), pitchLength: Double, pitchWidth: Double,
                     rate: Double, from: Double, to: Double?) throws -> Watched {
        let model = try detector()
        let asset = AVURLAsset(url: URL(fileURLWithPath: path))
        guard let track = asset.tracks(withMediaType: .video).first else { throw Fail(message: "That file has no video in it.") }
        let transform = track.preferredTransform
        if abs(transform.b) > 0.5 || abs(transform.c) > 0.5 {
            throw Fail(message: "That video was filmed upright. Film in landscape, with the whole pitch in view.")
        }
        let total = CMTimeGetSeconds(asset.duration)
        let end = min(total, to ?? total)
        guard end - from > 3 else { throw Fail(message: "Pick at least a few seconds of video.") }

        // 1) look at about `rate` frames a second: find people, note who is in our colour, try to read numbers
        let natural = track.naturalSize
        let width = min(1920.0, Double(natural.width))
        let height = (width / Double(natural.width) * Double(natural.height)).rounded()
        let reader = try AVAssetReader(asset: asset)
        reader.timeRange = CMTimeRange(start: CMTime(seconds: from, preferredTimescale: 600), end: CMTime(seconds: end, preferredTimescale: 600))
        let output = AVAssetReaderTrackOutput(track: track, outputSettings: [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            kCVPixelBufferWidthKey as String: Int(width),
            kCVPixelBufferHeightKey as String: Int(height)
        ])
        output.alwaysCopiesSampleData = false
        guard reader.canAdd(output) else { throw Fail(message: "This phone can't read that video.") }
        reader.add(output)
        guard reader.startReading() else { throw Fail(message: reader.error?.localizedDescription ?? "This phone can't read that video.") }

        var dets: [Det] = []
        var times: [Double] = []
        var frame = 0
        var nextAt = from
        var W = width
        var H = height
        let flipped = transform.a < 0 // filmed with the phone the other way up
        let step = 1.0 / rate
        while let sample = output.copyNextSampleBuffer() {
            if cancelled { reader.cancelReading(); throw Fail(message: "Stopped.") }
            let time = CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sample))
            if time + 0.001 < nextAt { continue }
            nextAt = max(nextAt + step, time + step * 0.5)
            guard let buffer = CMSampleBufferGetImageBuffer(sample) else { continue }
            autoreleasepool {
                W = Double(CVPixelBufferGetWidth(buffer))
                H = Double(CVPixelBufferGetHeight(buffer))
                let found = self.look(buffer, model: model, frame: frame, kit: kit, numbers: numbers, flipped: flipped, readNumbers: true)
                dets.append(contentsOf: found)
            }
            times.append(time)
            frame += 1
            if frame % 8 == 0 {
                notifyListeners("progress", data: ["stage": "look", "p": min(1, (time - from) / (end - from))])
            }
        }
        if reader.status == .failed { throw Fail(message: reader.error?.localizedDescription ?? "The video stopped reading part-way.") }
        let frames = frame
        guard frames > 10 else { throw Fail(message: "Couldn't read enough of that video.") }
        notifyListeners("progress", data: ["stage": "sort", "p": 0])

        // 2) the pitch, from the people themselves: everyone is about the same height, so how tall someone looks says how far away they are
        let standing = dets.filter { $0.height > 14 && ($0.x2 - $0.x1) < $0.height * 0.75 && $0.y2 < H * 0.97 }
        guard standing.count >= 60 else { throw Fail(message: "Not enough people were found. The camera needs to see the whole pitch, in landscape.") }
        var fitSet = standing
        var slope = 0.0
        var offset = 0.0
        for _ in 0..<3 {
            (slope, offset) = MatchVisionPlugin.line(fitSet.map { ($0.y2, $0.height) })
            let errors = fitSet.map { abs($0.height - (slope * $0.y2 + offset)) }
            let cut = MatchVisionPlugin.percentile(errors, 0.5) * 2.5 + 2
            fitSet = zip(fitSet, errors).filter { $0.1 <= cut }.map { $0.0 }
            if fitSet.count < 30 { break }
        }
        guard slope > 0.05 else { throw Fail(message: "Couldn't work out the pitch. The camera needs to be fixed behind a goal, looking down the pitch.") }
        let horizon = -offset / slope
        let cameraHeight = 1.78 / slope
        let ourFeet = dets.filter { $0.ours && $0.y2 < H * 0.97 }.map { $0.y2 }
        guard ourFeet.count >= 40 else { throw Fail(message: "Couldn't find players in your team colour. Check the team colour in Settings matches your kit.") }
        let farLine = max(horizon + 6, MatchVisionPlugin.percentile(ourFeet, 0.02))
        for index in dets.indices {
            let below = max(3, dets[index].y2 - horizon)
            dets[index].gz = min(pitchLength * 1.15, pitchLength * (farLine - horizon) / below)
            dets[index].gx = ((dets[index].x1 + dets[index].x2) / 2 - W / 2) * cameraHeight / below
        }
        // the camera is taken to be behind the middle of the goal, so the pitch runs half its width either side of the centre line
        let ours = dets.filter { $0.ours && $0.y2 < H * 0.985 && abs($0.gx) < pitchWidth / 2 + 1.5 && $0.gz < pitchLength + 2 }

        // 3) follow each of ours on the pitch, in metres
        var byFrame: [[Det]] = Array(repeating: [], count: frames)
        for det in ours { byFrame[det.frame].append(det) }
        let dt = step
        var tracks: [Track] = []
        for index in 0..<frames {
            let here = byFrame[index]
            var options: [(Double, Int, Int)] = []
            let live = tracks.enumerated().filter { index - $0.element.last <= 20 }
            for (trackIndex, track) in live {
                let lastDet = track.dets[track.dets.count - 1]
                let age = Double(index - track.last)
                let lead = min(age, 5) * dt
                let px = lastDet.gx + track.vx * lead
                let pz = lastDet.gz + track.vz * lead
                for (detIndex, det) in here.enumerated() {
                    let distance = hypot(px - det.gx, pz - det.gz)
                    let gate = 1.6 + 0.5 * age + 0.06 * det.gz // looser far away, where depth is rough
                    if distance < gate { options.append((distance / gate, trackIndex, detIndex)) }
                }
            }
            options.sort { $0.0 < $1.0 }
            var usedTracks = Set<Int>()
            var usedDets = Set<Int>()
            for (_, trackIndex, detIndex) in options where !usedTracks.contains(trackIndex) && !usedDets.contains(detIndex) {
                usedTracks.insert(trackIndex)
                usedDets.insert(detIndex)
                let track = tracks[trackIndex]
                let lastDet = track.dets[track.dets.count - 1]
                let gap = Double(index - track.last) * dt
                let det = here[detIndex]
                track.vx = 0.6 * track.vx + 0.4 * max(-8, min(8, (det.gx - lastDet.gx) / gap))
                track.vz = 0.6 * track.vz + 0.4 * max(-8, min(8, (det.gz - lastDet.gz) / gap))
                track.dets.append(det)
            }
            for (detIndex, det) in here.enumerated() where !usedDets.contains(detIndex) {
                let track = Track()
                track.dets = [det]
                tracks.append(track)
            }
        }
        tracks = tracks.filter { $0.dets.count >= 5 }

        // 4) cut every track wherever two of ours come close: that is where a tracker swaps people
        var cutFrames: [Set<Int>] = Array(repeating: [], count: tracks.count)
        var present: [[(Int, Det)]] = Array(repeating: [], count: frames)
        for (trackIndex, track) in tracks.enumerated() { for det in track.dets { present[det.frame].append((trackIndex, det)) } }
        for list in present where list.count > 1 {
            for first in 0..<list.count {
                for second in (first + 1)..<list.count {
                    let a = list[first].1
                    let b = list[second].1
                    let overlapX = min(a.x2, b.x2) - max(a.x1, b.x1)
                    let overlapY = min(a.y2, b.y2) - max(a.y1, b.y1)
                    if (overlapX > 0 && overlapY > 0) || hypot(a.gx - b.gx, a.gz - b.gz) < 1.2 {
                        cutFrames[list[first].0].insert(a.frame)
                        cutFrames[list[second].0].insert(a.frame)
                    }
                }
            }
        }
        var pieces: [Piece] = []
        for (trackIndex, track) in tracks.enumerated() {
            var current: [Det] = []
            for det in track.dets {
                if cutFrames[trackIndex].contains(det.frame) {
                    if current.count >= 4 { pieces.append(Piece(current)) }
                    current = []
                } else {
                    current.append(det)
                }
            }
            if current.count >= 4 { pieces.append(Piece(current)) }
        }

        for (index, piece) in pieces.enumerated() { piece.id = index }
        return Watched(path: path, numbers: numbers, pidFor: pidFor, pieces: pieces, ours: ours, times: times, dt: dt, duration: end - from, frames: frames,
                       pitchLength: pitchLength, pitchWidth: pitchWidth, cameraHeight: cameraHeight, width: W)
    }

    // MARK: - Who is who

    private func finish(_ watched: Watched) -> [String: Any] {
        let pieces = watched.pieces
        let numbers = watched.numbers
        let dt = watched.dt
        let pitchLength = watched.pitchLength
        let pitchWidth = watched.pitchWidth
        let left = -pitchWidth / 2
        let ours = watched.ours
        let pidFor = watched.pidFor

        // 5) a piece with a number read on it, clearly and more than once, is that player
        var reads: [Int: Int] = [:]
        for piece in pieces {
            piece.who = nil
            piece.read = false
            piece.told = false
            var votes: [Int: Int] = [:]
            for det in piece.dets { if let number = det.number { votes[number, default: 0] += 1; reads[number, default: 0] += 1 } }
            if let said = watched.told[piece.id] {
                piece.who = said
                piece.read = said >= 0
                piece.told = true
                continue
            }
            let ranked = votes.sorted { $0.value > $1.value }
            // a single digit could be half of someone else's number, so it has to be seen twice
            if let top = ranked.first, top.value >= (top.key < 10 ? 2 : 1), ranked.count == 1 || top.value >= 2 * ranked[1].value {
                piece.who = top.key
                piece.read = true
            }
        }
        // two pieces on screen at once can't both be the same player: keep the one with more footage
        for number in numbers {
            let mine = pieces.filter { $0.who == number }.sorted { $0.told != $1.told ? $0.told : $0.dets.count > $1.dets.count }
            var kept: [Piece] = []
            for piece in mine {
                if !piece.told, kept.contains(where: { $0.start <= piece.end && piece.start <= $0.end }) { piece.who = nil; piece.read = false } else { kept.append(piece) }
            }
        }

        // 6) every other piece goes to whoever could have been there, most certain first
        func fit(_ piece: Piece, _ number: Int) -> Double? {
            var best: Double?
            for other in pieces where other.who == number && other !== piece {
                if other.start <= piece.end && piece.start <= other.end { return nil } // already somewhere else
                let before = other.end < piece.start
                let gap = Double(before ? piece.start - other.end : other.start - piece.end) * dt
                let a = before ? other.dets[other.dets.count - 1] : piece.dets[piece.dets.count - 1]
                let b = before ? piece.dets[0] : other.dets[0]
                let distance = hypot(a.gx - b.gx, a.gz - b.gz)
                if distance > 7.5 * gap + 3 { return nil } // nobody runs that fast
                let score = gap < 4 ? distance / (0.4 + gap) : 6 + gap
                best = min(best ?? score, score)
            }
            return best ?? 99
        }
        var changed = true
        while changed {
            changed = false
            var pick: (margin: Double, score: Double, piece: Piece, number: Int)?
            for piece in pieces where piece.who == nil {
                var scored: [(Double, Int)] = []
                for number in numbers { if let score = fit(piece, number) { scored.append((score, number)) } }
                guard !scored.isEmpty else { continue }
                scored.sort { $0.0 < $1.0 }
                let margin = scored.count > 1 ? scored[1].0 - scored[0].0 : 50
                if pick == nil || margin > pick!.margin || (margin == pick!.margin && scored[0].0 < pick!.score) {
                    pick = (margin, scored[0].0, piece, scored[0].1)
                }
            }
            if let pick = pick, pick.margin >= 1.5, pick.score < 20 {
                pick.piece.who = pick.number
                changed = true
            }
        }

        // 7) the results
        let columns = 10
        let rows = 15
        func heat(_ list: [Det]) -> [Int] {
            var grid = Array(repeating: 0, count: columns * rows)
            for det in list {
                let column = min(columns - 1, max(0, Int(((det.gx - left) / pitchWidth * Double(columns)).rounded(.down))))
                let row = min(rows - 1, max(0, Int(det.gz / pitchLength * Double(rows))))
                grid[row * columns + column] += 1
            }
            return grid
        }
        func metres(_ list: [Det]) -> Double {
            guard list.count >= 9 else { return 0 }
            var smooth: [(Double, Double)] = []
            for index in 4..<(list.count - 4) {
                var sx = 0.0
                var sz = 0.0
                for near in (index - 4)...(index + 4) { sx += list[near].gx; sz += list[near].gz }
                smooth.append((sx / 9, sz / 9))
            }
            var sum = 0.0
            for index in 1..<smooth.count {
                let stepLength = hypot(smooth[index].0 - smooth[index - 1].0, smooth[index].1 - smooth[index - 1].1)
                if stepLength < 9.5 * dt * 1.5 { sum += stepLength }
            }
            return sum
        }
        var players: [[String: Any]] = []
        for number in numbers {
            let mine = pieces.filter { $0.who == number }.sorted { $0.start < $1.start }
            let all = mine.flatMap { $0.dets }
            let seconds = Double(mine.reduce(0) { $0 + ($1.end - $1.start) }) * dt
            let readSeconds = Double(mine.filter { $0.read }.reduce(0) { $0 + ($1.end - $1.start) }) * dt
            players.append([
                "pid": pidFor[number] ?? -1, "number": number, "seconds": seconds, "readSeconds": readSeconds, "reads": reads[number] ?? 0,
                "metres": mine.reduce(0.0) { $0 + metres($1.dets) }, "pieces": mine.count, "heat": heat(all)
            ])
        }
        let nameless = pieces.filter { $0.who == nil }
        let unknown = Double(nameless.reduce(0) { $0 + ($1.end - $1.start) }) * dt
        // the longest stretches nobody could be put to, with pictures, so the person using it can say who that is
        var ask: [[String: Any]] = []
        let asset = AVURLAsset(url: URL(fileURLWithPath: watched.path))
        let camera = AVAssetImageGenerator(asset: asset)
        camera.appliesPreferredTransform = true
        camera.requestedTimeToleranceBefore = CMTime(value: 1, timescale: 30)
        camera.requestedTimeToleranceAfter = CMTime(value: 1, timescale: 30)
        for piece in nameless.filter({ Double($0.end - $0.start) * dt >= 1.5 }).sorted(by: { $0.dets.count > $1.dets.count }).prefix(4) {
            var chosen: [Det] = []
            for det in piece.dets.sorted(by: { $0.height > $1.height }) where chosen.count < 3 {
                if chosen.allSatisfy({ Double(abs($0.frame - det.frame)) * dt > 0.8 }) { chosen.append(det) }
            }
            var pictures: [String] = []
            for det in chosen where det.frame < watched.times.count {
                guard let whole = try? camera.copyCGImage(at: CMTime(seconds: watched.times[det.frame], preferredTimescale: 600), actualTime: nil) else { continue }
                let scale = Double(whole.width) / watched.width
                let w = det.x2 - det.x1
                let box = CGRect(x: (det.x1 - w * 0.35) * scale, y: (det.y1 - det.height * 0.12) * scale, width: w * 1.7 * scale, height: det.height * 1.24 * scale)
                    .intersection(CGRect(x: 0, y: 0, width: whole.width, height: whole.height))
                guard box.width > 8, box.height > 8, let cut = whole.cropping(to: box), let jpeg = UIImage(cgImage: cut).jpegData(compressionQuality: 0.85) else { continue }
                pictures.append(jpeg.base64EncodedString())
            }
            if !pictures.isEmpty { ask.append(["piece": piece.id, "seconds": Double(piece.end - piece.start) * dt, "pictures": pictures]) }
        }
        return [
            "duration": watched.duration, "frames": watched.frames, "pitch": ["width": pitchWidth, "length": pitchLength], "cameraHeight": watched.cameraHeight,
            "columns": columns, "rows": rows, "players": players, "team": ["heat": heat(ours)], "ask": ask,
            "pieces": pieces.count, "unknownSeconds": unknown, "numbersRead": reads.values.reduce(0, +)
        ]
    }

    // MARK: - One frame

    private func look(_ buffer: CVPixelBuffer, model: ORTSession, frame: Int, kit: (Double, Double, Double), numbers: [Int], flipped: Bool, readNumbers: Bool) -> [Det] {
        let width = CVPixelBufferGetWidth(buffer)
        let height = CVPixelBufferGetHeight(buffer)
        let H = Double(height)
        CVPixelBufferLockBaseAddress(buffer, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) }
        guard let base = CVPixelBufferGetBaseAddress(buffer), width >= height else { return [] }
        let pixels = base.assumingMemoryBound(to: UInt8.self)
        let stride = CVPixelBufferGetBytesPerRow(buffer)

        // people, from the left square and the right square of the picture
        var boxes: [(Double, Double, Double, Double, Double)] = []
        for x0 in Set([0, width - height]) {
            boxes.append(contentsOf: people(pixels, stride: stride, width: width, height: height, x0: x0, flipped: flipped, model: model))
        }
        boxes.sort { $0.4 > $1.4 }
        var kept: [(Double, Double, Double, Double, Double)] = []
        for box in boxes {
            var clash = false
            for other in kept {
                let ix = max(0, min(box.2, other.2) - max(box.0, other.0))
                let iy = max(0, min(box.3, other.3) - max(box.1, other.1))
                let inter = ix * iy
                let union = (box.2 - box.0) * (box.3 - box.1) + (other.2 - other.0) * (other.3 - other.1) - inter
                if union > 0 && inter / union > 0.5 { clash = true; break }
            }
            if !clash { kept.append(box) }
        }

        var out: [Det] = []
        for box in kept where box.3 - box.1 > 16 {
            var det = Det(frame: frame, x1: box.0, y1: box.1, x2: box.2, y2: box.3, ours: false, number: nil)
            det.ours = MatchVisionPlugin.wearing(kit, in: buffer, det: det, flipped: flipped)
            out.append(det)
        }
        guard readNumbers else { return out }

        // shirt numbers: enlarge each of our players' backs and let Vision read it
        var picture = CIImage(cvPixelBuffer: buffer)
        if flipped { picture = picture.oriented(.down) }
        for index in out.indices where out[index].ours && out[index].height > H * 0.055 {
            let det = out[index]
            let w = det.x2 - det.x1
            let top = det.y1 + det.height * 0.12
            let bottom = det.y1 + det.height * 0.56
            let crop = CGRect(x: det.x1 - w * 0.05, y: H - bottom, width: w * 1.1, height: bottom - top).intersection(picture.extent)
            guard crop.width > 12, crop.height > 12 else { continue }
            let scale = max(2, min(8, 260 / crop.height))
            let enlarged = picture.cropped(to: crop)
                .transformed(by: CGAffineTransform(translationX: -crop.minX, y: -crop.minY))
                .transformed(by: CGAffineTransform(scaleX: scale, y: scale))
            guard let image = imageContext.createCGImage(enlarged, from: enlarged.extent) else { continue }
            let text = VNRecognizeTextRequest()
            text.recognitionLevel = .accurate
            text.usesLanguageCorrection = false
            text.minimumTextHeight = 0.12
            text.customWords = numbers.map { String($0) }
            guard (try? VNImageRequestHandler(cgImage: image, options: [:]).perform([text])) != nil, let lines = text.results else { continue }
            search: for line in lines {
                for candidate in line.topCandidates(3) where candidate.confidence > 0.3 {
                    let plain = candidate.string.filter { !$0.isWhitespace }
                    // only a clean read of one of the numbers we were told about counts
                    if !plain.isEmpty, plain.allSatisfy({ $0.isNumber }), let value = Int(plain), numbers.contains(value) {
                        out[index].number = value
                        break search
                    }
                }
            }
        }
        return out
    }

    /// Runs the detector on one square of the picture and returns people as (x1, y1, x2, y2, score) in picture pixels.
    private func people(_ pixels: UnsafeMutablePointer<UInt8>, stride: Int, width: Int, height: Int, x0: Int, flipped: Bool, model: ORTSession) -> [(Double, Double, Double, Double, Double)] {
        let size = 640
        let side = height
        var input = [Float](repeating: 0, count: 3 * size * size)
        let ratio = Double(side) / Double(size)
        input.withUnsafeMutableBufferPointer { target in
            for y in 0..<size {
                let sy = min(side - 1, Int((Double(y) + 0.5) * ratio))
                let py = flipped ? height - 1 - sy : sy
                for x in 0..<size {
                    let sx = min(side - 1, Int((Double(x) + 0.5) * ratio)) + x0
                    let px = flipped ? width - 1 - sx : sx
                    let offset = py * stride + px * 4
                    let at = y * size + x
                    target[at] = Float(pixels[offset])                      // blue
                    target[size * size + at] = Float(pixels[offset + 1])   // green
                    target[2 * size * size + at] = Float(pixels[offset + 2]) // red
                }
            }
        }
        let data = input.withUnsafeBufferPointer { NSMutableData(bytes: $0.baseAddress, length: $0.count * MemoryLayout<Float>.size) }
        guard let tensor = try? ORTValue(tensorData: data, elementType: ORTTensorElementDataType.float, shape: [1, 3, NSNumber(value: size), NSNumber(value: size)]),
              let result = try? model.run(withInputs: [inputName: tensor], outputNames: [outputName], runOptions: nil),
              let answer = result[outputName], let raw = try? answer.tensorData() else { return [] }
        var found: [(Double, Double, Double, Double, Double)] = []
        let fields = 85
        do {
            let values = UnsafeBufferPointer(start: raw.bytes.assumingMemoryBound(to: Float.self), count: raw.length / MemoryLayout<Float>.size)
            let count = min(grid.count, values.count / fields)
            for index in 0..<count {
                let at = index * fields
                let score = values[at + 4] * values[at + 5]   // "something is here" times "it is a person"
                if score < 0.3 { continue }
                let cell = grid[index]
                let cx = Double((values[at] + cell.0) * cell.2) * ratio + Double(x0)
                let cy = Double((values[at + 1] + cell.1) * cell.2) * ratio
                let w = Double(exp(values[at + 2]) * cell.2) * ratio
                let h = Double(exp(values[at + 3]) * cell.2) * ratio
                found.append((cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2, Double(score)))
            }
        }
        return found
    }

    /// Is this person's shirt the team colour? Looks at the middle of the upper body.
    private static func wearing(_ kit: (Double, Double, Double), in buffer: CVPixelBuffer, det: Det, flipped: Bool) -> Bool {
        guard let base = CVPixelBufferGetBaseAddress(buffer) else { return false }
        let width = CVPixelBufferGetWidth(buffer)
        let height = CVPixelBufferGetHeight(buffer)
        let stride = CVPixelBufferGetBytesPerRow(buffer)
        let pixels = base.assumingMemoryBound(to: UInt8.self)
        let w = det.x2 - det.x1
        let h = det.height
        var x1 = Int(det.x1 + w * 0.28)
        var x2 = Int(det.x2 - w * 0.28)
        var y1 = Int(det.y1 + h * 0.2)
        var y2 = Int(det.y1 + h * 0.48)
        if flipped { // the picture in memory is the other way up from the one Vision described
            (x1, x2) = (width - 1 - x2, width - 1 - x1)
            (y1, y2) = (height - 1 - y2, height - 1 - y1)
        }
        x1 = max(0, x1); y1 = max(0, y1); x2 = min(width - 1, x2); y2 = min(height - 1, y2)
        guard x2 > x1, y2 > y1 else { return false }
        let (kitHue, kitSat, kitVal) = hsv(kit.0, kit.1, kit.2)
        var match = 0
        var count = 0
        let stepX = max(1, (x2 - x1) / 12)
        let stepY = max(1, (y2 - y1) / 12)
        var y = y1
        while y <= y2 {
            var x = x1
            while x <= x2 {
                let offset = y * stride + x * 4
                let (hue, sat, val) = hsv(Double(pixels[offset + 2]) / 255, Double(pixels[offset + 1]) / 255, Double(pixels[offset]) / 255)
                count += 1
                if kitSat < 0.2 { // a white, grey or black kit: go by brightness
                    if sat < 0.25 && abs(val - kitVal) < 0.3 { match += 1 }
                } else {
                    var diff = abs(hue - kitHue)
                    if diff > 180 { diff = 360 - diff }
                    if diff < 24 && sat > 0.22 && val > 0.15 { match += 1 }
                }
                x += stepX
            }
            y += stepY
        }
        return count > 0 && Double(match) / Double(count) > 0.3
    }

    // MARK: - Small maths helpers

    private static func hsv(_ r: Double, _ g: Double, _ b: Double) -> (Double, Double, Double) {
        let high = max(r, g, b)
        let low = min(r, g, b)
        let delta = high - low
        var hue = 0.0
        if delta > 0.0001 {
            if high == r { hue = 60 * ((g - b) / delta).truncatingRemainder(dividingBy: 6) } else if high == g { hue = 60 * ((b - r) / delta + 2) } else { hue = 60 * ((r - g) / delta + 4) }
        }
        if hue < 0 { hue += 360 }
        return (hue, high <= 0 ? 0 : delta / high, high)
    }

    private static func rgb(_ hex: String) -> (Double, Double, Double) {
        var value = hex.trimmingCharacters(in: .whitespaces)
        if value.hasPrefix("#") { value.removeFirst() }
        guard value.count == 6, let number = UInt32(value, radix: 16) else { return (0.12, 0.42, 0.29) }
        return (Double((number >> 16) & 0xFF) / 255, Double((number >> 8) & 0xFF) / 255, Double(number & 0xFF) / 255)
    }

    /// Least-squares straight line through (x, y) points: returns (slope, offset).
    private static func line(_ points: [(Double, Double)]) -> (Double, Double) {
        let n = Double(points.count)
        guard n >= 2 else { return (0, 0) }
        let sx = points.reduce(0) { $0 + $1.0 }
        let sy = points.reduce(0) { $0 + $1.1 }
        let sxx = points.reduce(0) { $0 + $1.0 * $1.0 }
        let sxy = points.reduce(0) { $0 + $1.0 * $1.1 }
        let bottom = n * sxx - sx * sx
        guard abs(bottom) > 0.000001 else { return (0, 0) }
        let slope = (n * sxy - sx * sy) / bottom
        return (slope, (sy - slope * sx) / n)
    }

    private static func percentile(_ values: [Double], _ q: Double) -> Double {
        guard !values.isEmpty else { return 0 }
        let sorted = values.sorted()
        return sorted[min(sorted.count - 1, max(0, Int(Double(sorted.count - 1) * q)))]
    }
}
