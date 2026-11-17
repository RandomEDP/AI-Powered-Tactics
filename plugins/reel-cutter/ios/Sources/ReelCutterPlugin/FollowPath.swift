import Foundation

/// Where a tall (9:16) frame cut out of a wide video should sit, moment by moment, so it follows the play (Ethan, November
/// 2026: "exporting highlights in vertical phone mode all on device"). Only Foundation here, so it can be checked off the
/// phone (tests/follow/main.swift); what the phone sees in each frame is worked out in VerticalVideo.swift.
///
/// Every position is a fraction of the video's width: 0 is the left edge, 1 the right. `window` is how wide the tall frame
/// is (for a 16:9 video cut to 9:16, about 0.32), and a centre is always kept far enough in that the frame stays inside.

/// What was seen in one frame, a few times a second.
struct FollowSample {
    var t: Double                                   // seconds into the video
    var people: [(x: Double, score: Double)] = []   // the middle of each player found, and how sure the detector was
    var balls: [(x: Double, score: Double)] = []    // the ball, when the detector found one
    var motion: [Double] = []                       // how much the picture changed since the last look, in strips left to right
}

struct FollowPoint: Equatable {
    var t: Double
    var x: Double
}

enum FollowAim: String {
    case auto, left, centre, right
}

enum FollowPath {
    /// A ball only counts when the detector is this sure: on cage footage it's small and blurred, and a wrong one would
    /// drag the frame away from the play.
    static let ballSure = 0.45
    /// How fast the frame may pan, in widths of the video a second (a calm camera operator, not a whip pan).
    static let maxSpeed = 0.45
    /// How much the path is smoothed (seconds), forwards and then backwards, so it moves a little ahead of the play.
    static let ease = 0.55

    static func clamp(_ x: Double, window: Double) -> Double {
        let half = min(0.5, max(0, window / 2))
        return min(1 - half, max(half, x))
    }

    /// How much of the play there is in a frame centred at `c`.
    static func score(_ s: FollowSample, at c: Double, window: Double, near moment: Bool) -> Double {
        let half = window / 2
        var total = 0.0
        // players: everyone inside counts, those nearer the middle a little more (so a bunch isn't left at the edge)
        for p in s.people where abs(p.x - c) <= half {
            let off = (p.x - c) / half
            total += p.score * (1 - 0.35 * off * off)
        }
        // movement: the share of all the movement in the picture that falls inside the frame
        if !s.motion.isEmpty {
            let all = s.motion.reduce(0, +)
            if all > 1e-6 {
                let n = Double(s.motion.count)
                var inside = 0.0
                for (i, m) in s.motion.enumerated() {
                    let mid = (Double(i) + 0.5) / n
                    if abs(mid - c) <= half { inside += m }
                }
                total += (inside / all) * (moment ? 3.0 : 1.5)
            }
        }
        // the ball, when it's clearly seen, wins
        if let ball = s.balls.filter({ $0.score >= ballSure }).max(by: { $0.score < $1.score }), abs(ball.x - c) <= half {
            let off = (ball.x - c) / half
            total += (moment ? 8.0 : 6.0) * (1 - 0.6 * off * off)
        }
        return total
    }

    /// Where the frame wants to be for one look at the picture, or nil if there's nothing to go on.
    static func target(_ s: FollowSample, window: Double, previous: Double?, near moment: Bool) -> Double? {
        let lo = clamp(0, window: window), hi = clamp(1, window: window)
        if hi - lo < 1e-6 { return lo }
        let steps = 48
        var best: (c: Double, v: Double)? = nil
        var anything = 0.0
        for k in 0...steps {
            let c = lo + (hi - lo) * Double(k) / Double(steps)
            var v = score(s, at: c, window: window, near: moment)
            anything = max(anything, v)
            if let prev = previous { v -= 0.25 * abs(c - prev) / max(window, 0.05) } // (staying put wins a close call, so it doesn't flicker)
            if best == nil || v > best!.v + 1e-9 { best = (c: c, v: v) }
        }
        return anything < 0.05 ? nil : best?.c
    }

    /// The whole path: a point for every look at the picture. `cuts` are where one clip ends and the next begins (the frame
    /// jumps there rather than panning across); `moments` are when each goal or highlight happens (the movement and the ball
    /// count for more just before and after them).
    static func plan(_ samples: [FollowSample], window: Double, cuts: [Double] = [], moments: [Double] = [], aim: FollowAim = .auto) -> [FollowPoint] {
        let sorted = samples.sorted { $0.t < $1.t }
        guard !sorted.isEmpty else { return [] }
        switch aim {
        case .left: return sorted.map { FollowPoint(t: $0.t, x: clamp(0, window: window)) }
        case .right: return sorted.map { FollowPoint(t: $0.t, x: clamp(1, window: window)) }
        case .centre: return sorted.map { FollowPoint(t: $0.t, x: 0.5) }
        case .auto: break
        }
        // split into shots at the cuts
        let edges = cuts.sorted()
        func shot(_ t: Double) -> Int { edges.filter { $0 <= t + 1e-6 }.count }
        var groups: [[FollowSample]] = []
        var last = -1
        for s in sorted {
            let g = shot(s.t)
            if g != last { groups.append([]); last = g }
            groups[groups.count - 1].append(s)
        }
        var out: [FollowPoint] = []
        for group in groups { out += follow(group, window: window, moments: moments) }
        return out
    }

    /// One shot: the target at each look, gaps filled, the odd stray look ignored, then smoothed and slowed to a steady pan.
    static func follow(_ group: [FollowSample], window: Double, moments: [Double]) -> [FollowPoint] {
        var raw: [Double?] = []
        var prev: Double? = nil
        for s in group {
            let near = moments.contains { s.t >= $0 - 3 && s.t <= $0 + 1.5 }
            let x = target(s, window: window, previous: prev, near: near)
            raw.append(x)
            if let x = x { prev = x }
        }
        // nothing to go on anywhere in the shot: hold the middle
        guard let firstSeen = raw.firstIndex(where: { $0 != nil }) else { return group.map { FollowPoint(t: $0.t, x: 0.5) } }
        var filled = [Double](repeating: 0, count: raw.count)
        var carry = raw[firstSeen]!
        for i in 0..<raw.count { if let x = raw[i] { carry = x }; filled[i] = i < firstSeen ? raw[firstSeen]! : carry }
        // a median of five looks, so one wrong look (a player near the camera, a flash of the ball) doesn't move the frame
        var steady = filled
        if filled.count >= 3 {
            for i in 0..<filled.count {
                let a = max(0, i - 2), b = min(filled.count - 1, i + 2)
                let near = filled[a...b].sorted()
                steady[i] = near[near.count / 2]
            }
        }
        // smoothed forwards and backwards (no lag: the frame moves a little before the play gets there, as a camera
        // operator's would), then never faster than maxSpeed
        var smooth = steady
        for i in 1..<max(1, smooth.count) {
            let dt = max(0.001, group[i].t - group[i - 1].t), k = 1 - exp(-dt / ease)
            smooth[i] = smooth[i - 1] + (smooth[i] - smooth[i - 1]) * k
        }
        if smooth.count > 1 {
            for i in stride(from: smooth.count - 2, through: 0, by: -1) {
                let dt = max(0.001, group[i + 1].t - group[i].t), k = 1 - exp(-dt / ease)
                smooth[i] = smooth[i + 1] + (smooth[i] - smooth[i + 1]) * k
            }
        }
        var paced = smooth
        for i in 1..<max(1, paced.count) {
            let dt = max(0.001, group[i].t - group[i - 1].t), most = maxSpeed * dt
            paced[i] = paced[i - 1] + min(most, max(-most, smooth[i] - paced[i - 1]))
        }
        return zip(group, paced).map { FollowPoint(t: $0.t, x: clamp($1, window: window)) }
    }

    /// The frame's centre at any time, between the points either side (held at the ends). At a cut it jumps.
    static func centre(at t: Double, in path: [FollowPoint], window: Double, cuts: [Double] = []) -> Double {
        guard let first = path.first, let last = path.last else { return 0.5 }
        if t <= first.t { return clamp(first.x, window: window) }
        if t >= last.t { return clamp(last.x, window: window) }
        var lo = 0, hi = path.count - 1
        while hi - lo > 1 { let mid = (lo + hi) / 2; if path[mid].t <= t { lo = mid } else { hi = mid } }
        let a = path[lo], b = path[hi], span = b.t - a.t
        if span <= 1e-6 { return clamp(b.x, window: window) }
        // two looks either side of a cut belong to different clips: no pan across the join
        if let cut = cuts.first(where: { $0 > a.t && $0 <= b.t }) { return clamp(t < cut ? a.x : b.x, window: window) }
        return clamp(a.x + (b.x - a.x) * (t - a.t) / span, window: window)
    }

    /// How often to look: five times a second, less on a long video, so a whole match's highlights stay quick to analyse.
    static func step(for duration: Double) -> Double {
        guard duration.isFinite, duration > 0 else { return 0.2 }
        return max(0.2, min(0.5, duration / 1500))
    }

    /// How wide a tall frame of `aspect` (width ÷ height, 9/16) is in a video `width` × `height`, as a fraction of its width.
    static func window(width: Double, height: Double, aspect: Double = 9.0 / 16.0) -> Double {
        guard width > 0, height > 0 else { return 1 }
        return min(1, height * aspect / width)
    }
}
