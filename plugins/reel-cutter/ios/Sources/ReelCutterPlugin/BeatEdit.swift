import Foundation

/// A beat edit's plan, as JS worked it out (beatPlan in index.html), and how each frame of it should look. Only Foundation
/// here, so it can be checked off the phone (tests/beat/main.swift); the drawing is in ReelCutterPlugin.beatPass.
struct BeatSeg {
    let i: Int          // which clip
    let t: Double       // where it starts in the edit (seconds, on a beat)
    let out: Double     // how long it lasts in the edit
    let from: Double    // where it starts in the clip
    let len: Double     // how much of the clip it plays (len / out is the speed)
    let mono: Bool      // black and white
    let z0: Double      // how far it's zoomed in at its start and its end
    let z1: Double
}

struct BeatFx {
    let t: Double       // when it starts
    let d: Double       // how long it lasts
    let a: Double       // how strong it is
    let k: String       // flash, punch, shake or blur
}

/// How one frame looks: zoomed in this far, moved this far (in widths of the frame), this much white and blur over it.
struct BeatFrame: Equatable {
    var zoom: Double
    var dx: Double
    var dy: Double
    var flash: Double
    var blur: Double
    var mono: Bool
}

struct BeatPlan {
    let segs: [BeatSeg]
    let fx: [BeatFx]
    let len: Double
    let outroAt: Double

    private static func num(_ value: Any?) -> Double? {
        if let n = value as? NSNumber { return n.doubleValue }
        if let d = value as? Double { return d }
        if let i = value as? Int { return Double(i) }
        return nil
    }

    /// The plan from JS; nil if it's missing anything or its stretches don't follow on from each other.
    static func parse(segs rawSegs: [[String: Any]], fx rawFx: [[String: Any]], len: Double, outroAt: Double) -> BeatPlan? {
        var segs: [BeatSeg] = []
        for raw in rawSegs {
            guard let i = num(raw["i"]), let t = num(raw["t"]), let out = num(raw["out"]), let from = num(raw["from"]), let length = num(raw["len"]),
                  out > 0, length > 0, from >= 0 else { return nil }
            if let last = segs.last, abs(last.t + last.out - t) > 0.01 { return nil }
            let z0 = num(raw["z0"]) ?? 1.3
            segs.append(BeatSeg(i: Int(i), t: t, out: out, from: from, len: length, mono: raw["mono"] as? Bool ?? false, z0: z0, z1: num(raw["z1"]) ?? z0))
        }
        guard !segs.isEmpty, len > 0 else { return nil }
        let fx = rawFx.compactMap { raw -> BeatFx? in
            guard let t = num(raw["t"]), let d = num(raw["d"]), d > 0, let k = raw["k"] as? String else { return nil }
            return BeatFx(t: t, d: d, a: num(raw["a"]) ?? 1, k: k)
        }
        return BeatPlan(segs: segs, fx: fx, len: len, outroAt: min(max(0, outroAt), len))
    }

    /// The stretch playing at `t` seconds into the edit.
    func seg(at t: Double) -> BeatSeg {
        var found = segs[0]
        for seg in segs where seg.t <= t + 1e-6 { found = seg }
        return found
    }

    func frame(at t: Double) -> BeatFrame {
        let seg = self.seg(at: t)
        let p = min(1, max(0, (t - seg.t) / seg.out))
        let eased = p * p * (3 - 2 * p)
        var look = BeatFrame(zoom: seg.z0 + (seg.z1 - seg.z0) * eased, dx: 0, dy: 0, flash: 0, blur: 0, mono: seg.mono)
        for effect in fx where t >= effect.t && t < effect.t + effect.d {
            let u = (t - effect.t) / effect.d, left = 1 - u
            switch effect.k {
            case "punch": look.zoom *= 1 + effect.a * left * left * left   // in hard on the beat, easing back out
            case "shake":
                let amount = effect.a * left * left * 0.025
                look.dx += amount * sin(u * .pi * 2 * 7.0)
                look.dy += amount * cos(u * .pi * 2 * 5.3 + 1.1)
            case "flash": look.flash = max(look.flash, effect.a * left * left)
            case "blur": look.blur = max(look.blur, effect.a * left)
            default: break
            }
        }
        return look
    }
}
