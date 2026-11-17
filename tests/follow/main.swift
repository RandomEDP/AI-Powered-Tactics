// Highlights made vertical: where the tall frame sits (FollowPath.swift, the code that ships), checked off the phone.
//   swiftc plugins/reel-cutter/ios/Sources/ReelCutterPlugin/FollowPath.swift tests/follow/main.swift -o followcheck && ./followcheck
// It follows the players and the movement, takes the ball when it's clearly seen, ignores a stray look, pans steadily
// (never a whip), jumps at a cut between clips, keeps the frame inside the picture, and holds the middle when there's
// nothing to go on.
import Foundation

var failures = 0, checks = 0
func check(_ ok: Bool, _ what: String) { checks += 1; if !ok { failures += 1; print("FAIL  " + what) } }
func near(_ a: Double, _ b: Double, _ by: Double = 0.05) -> Bool { abs(a - b) <= by }

let window = FollowPath.window(width: 1920, height: 1080)
check(near(window, 0.316, 0.001), "a 16:9 video cut to 9:16 is about a third of its width wide (\(window))")
check(FollowPath.window(width: 1080, height: 1920) == 1, "a video that's already tall needs no cutting")
check(near(FollowPath.clamp(0, window: window), window / 2, 1e-9) && near(FollowPath.clamp(1, window: window), 1 - window / 2, 1e-9), "the frame never goes past the picture's edges")

/// Motion strips with the movement around `x`.
func moving(_ x: Double, strips: Int = 32, spread: Double = 0.06) -> [Double] {
    (0..<strips).map { i in let mid = (Double(i) + 0.5) / Double(strips); return abs(mid - x) <= spread ? 100 : 1 }
}
func players(_ xs: [Double]) -> [(x: Double, score: Double)] { xs.map { (x: $0, score: 0.8) } }
func look(_ t: Double, _ xs: [Double], move: Double? = nil, ball: Double? = nil, ballScore: Double = 0.7) -> FollowSample {
    var s = FollowSample(t: t)
    s.people = players(xs)
    if let m = move { s.motion = moving(m) }
    if let b = ball { s.balls = [(x: b, score: ballScore)] }
    return s
}
func times(_ from: Double, _ to: Double, _ step: Double = 0.25) -> [Double] { stride(from: from, to: to, by: step).map { $0 } }

// 1. a bunch of players on the right, one on their own on the left: the frame goes to the bunch
do {
    let samples = times(0, 6).map { look($0, [0.05, 0.72, 0.75, 0.78, 0.8], move: 0.76) }
    let path = FollowPath.plan(samples, window: window)
    check(path.count == samples.count, "a point for every look")
    check(path.allSatisfy { near($0.x, 0.76, 0.06) }, "the frame sits on the bunch of players, not the one on their own (\(path.map { $0.x }))")
}

// 2. the play moves from left to right across four seconds: the frame follows it, steadily
do {
    let samples = times(0, 8).map { t -> FollowSample in
        let x = t < 2 ? 0.2 : t > 6 ? 0.8 : 0.2 + 0.6 * (t - 2) / 4
        return look(t, [x - 0.03, x, x + 0.03], move: x)
    }
    let path = FollowPath.plan(samples, window: window)
    check(near(path.first!.x, 0.2, 0.06), "it starts with the play on the left (\(path.first!.x))")
    check(near(path.last!.x, 0.8, 0.06), "it ends with the play on the right (\(path.last!.x))")
    var fastest = 0.0
    for i in 1..<path.count { fastest = max(fastest, abs(path[i].x - path[i - 1].x) / (path[i].t - path[i - 1].t)) }
    check(fastest <= FollowPath.maxSpeed + 1e-9, "never faster than a steady pan (\(fastest) widths a second)")
    var ups = 0
    for i in 1..<path.count where path[i].x < path[i - 1].x - 0.002 { ups += 1 }
    check(ups == 0, "it doesn't wobble back while the play goes one way (\(ups) steps back)")
    // halfway through the move the frame is with the play
    let mid = path.first { $0.t >= 4 }!.x
    check(near(mid, 0.5, 0.08), "halfway through it's with the play (\(mid))")
}

// 3. one stray look (a player walking past the camera) doesn't move the frame
do {
    let samples = times(0, 6).map { t -> FollowSample in
        abs(t - 3) < 0.05 ? look(t, [0.1, 0.12], move: 0.11) : look(t, [0.6, 0.62, 0.65], move: 0.62)
    }
    let path = FollowPath.plan(samples, window: window)
    check(path.allSatisfy { near($0.x, 0.62, 0.05) }, "a single stray look is ignored (\(path.map { $0.x }))")
}

// 4. the ball, when it's clearly seen, beats the players; a doubtful one doesn't
do {
    let sure = times(0, 4).map { look($0, [0.3, 0.32, 0.35, 0.37], move: 0.33, ball: 0.75) }
    let p1 = FollowPath.plan(sure, window: window)
    check(near(p1.last!.x, 0.75, 0.12), "a ball clearly seen pulls the frame to it (\(p1.last!.x))")
    let doubtful = times(0, 4).map { look($0, [0.3, 0.32, 0.35, 0.37], move: 0.33, ball: 0.75, ballScore: 0.3) }
    let p2 = FollowPath.plan(doubtful, window: window)
    check(near(p2.last!.x, 0.33, 0.06), "a ball it isn't sure of is left alone (\(p2.last!.x))")
}

// 5. a cut between two clips: the frame jumps, and doesn't pan across the join
do {
    let samples = times(0, 10).map { t in t < 5 ? look(t, [0.2, 0.22, 0.25], move: 0.22) : look(t, [0.78, 0.8, 0.82], move: 0.8) }
    let path = FollowPath.plan(samples, window: window, cuts: [5])
    let before = path.last { $0.t < 5 }!.x, after = path.first { $0.t >= 5 }!.x
    check(near(before, 0.22, 0.05) && near(after, 0.8, 0.05), "each clip has its own frame, straight away (\(before) then \(after))")
    let justBefore = FollowPath.centre(at: 4.9, in: path, window: window, cuts: [5]), justAfter = FollowPath.centre(at: 5.0, in: path, window: window, cuts: [5])
    check(near(justBefore, 0.22, 0.05) && near(justAfter, 0.8, 0.05), "between looks it jumps at the cut, no pan across it (\(justBefore), \(justAfter))")
    let without = FollowPath.plan(samples, window: window)
    let slow = without.first { $0.t >= 5 }!.x
    check(slow < 0.7, "without the cut it would have panned (which is why cuts are given) (\(slow))")
}

// 6. nothing to go on: the middle
do {
    let samples = times(0, 3).map { FollowSample(t: $0) }
    let path = FollowPath.plan(samples, window: window)
    check(path.allSatisfy { $0.x == 0.5 }, "nothing seen: it holds the middle")
    // something seen part way: it starts there, rather than sliding over from the middle
    let late = times(0, 4).map { t in t < 1 ? FollowSample(t: t) : look(t, [0.8, 0.82, 0.85], move: 0.82) }
    let p = FollowPath.plan(late, window: window)
    check(near(p.first!.x, 0.82, 0.06), "play seen a moment in: the frame is there from the start (\(p.first!.x))")
}

// 7. the play at the very edge: the frame stops at the edge
do {
    let samples = times(0, 3).map { look($0, [0.0, 0.02, 0.04], move: 0.02) }
    let path = FollowPath.plan(samples, window: window)
    check(path.allSatisfy { near($0.x, window / 2, 1e-6) }, "play at the edge: the frame is against the edge, never past it (\(path.map { $0.x }))")
}

// 8. the person's own choice: left, middle or right, whatever's in the picture
do {
    let samples = times(0, 3).map { look($0, [0.8], move: 0.8) }
    check(FollowPath.plan(samples, window: window, aim: .left).allSatisfy { near($0.x, window / 2, 1e-9) }, "Left keeps it on the left")
    check(FollowPath.plan(samples, window: window, aim: .centre).allSatisfy { $0.x == 0.5 }, "Middle keeps it in the middle")
    check(FollowPath.plan(samples, window: window, aim: .right).allSatisfy { near($0.x, 1 - window / 2, 1e-9) }, "Right keeps it on the right")
}

// 9. around the moment, the movement counts for more than players standing about
do {
    // four players standing on the left, one runner and all the movement on the right
    let s = look(5, [0.15, 0.17, 0.19, 0.21], move: 0.8)
    var still = s; still.people.append((x: 0.8, score: 0.8))
    let calm = FollowPath.target(still, window: window, previous: nil, near: false)!
    let moment = FollowPath.target(still, window: window, previous: nil, near: true)!
    check(calm < 0.5, "away from the moment, the bunch of players wins (\(calm))")
    check(moment > 0.5, "just before the goal, the movement wins (\(moment))")
}

// 10. how often it looks
check(FollowPath.step(for: 14) == 0.2, "a clip: five looks a second")
check(FollowPath.step(for: 420) <= 0.5 && 420 / FollowPath.step(for: 420) <= 1500.5, "a whole match's highlights: no more than 1,500 looks")

// 11. between looks, the frame moves smoothly
do {
    let path = [FollowPoint(t: 0, x: 0.3), FollowPoint(t: 0.25, x: 0.34)]
    check(near(FollowPath.centre(at: 0.125, in: path, window: window), 0.32, 1e-9), "halfway between two looks, halfway between their places")
    check(FollowPath.centre(at: 9, in: path, window: window) == 0.34, "after the last look it stays put")
    check(FollowPath.centre(at: 1, in: [], window: window) == 0.5, "no path: the middle")
}

print(failures == 0 ? "vertical highlights: all \(checks) checks passed" : "vertical highlights: \(failures) of \(checks) checks failed")
exit(failures == 0 ? 0 : 1)
